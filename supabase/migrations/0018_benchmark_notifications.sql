-- 0018_benchmark_notifications.sql
-- Server foundation for the New-Benchmark Notifications feature
-- (see docs/plans/2026-07-28-001-feat-web-benchmark-notifications-plan.md, U1).
--
-- Three tables + one trigger, funneling every catalog-write path (import_catalog.py, hand-run
-- SQL, restore) into a single events stream that two consumers read: the client (public read,
-- powers banner / dot / deep-link) and the server-side drain script (aggregates and pushes).
--
--   • benchmark_events           — SINGLE SOURCE OF TRUTH for all four surfaces (KTD1). One row
--                                   per problem, ever. Public read; service-role/trigger write.
--   • notification_interests     — signed-in user × (layout_id, angle) target set the drain
--                                   joins against. Owner-scoped; reconciled declaratively (KTD7).
--   • push_subscriptions         — VAPID endpoint + keys per opted-in device. Owner-scoped for
--                                   SELECT as well as write — endpoint+keys are a capability to
--                                   push to that device, not mere private data.
--
-- The capture is TWO TRIGGERS sharing ONE FUNCTION (a single combined trigger is invalid SQL —
-- `tg_op` is unavailable in a WHEN clause, and an INSERT trigger's WHEN may not reference OLD).
-- Both triggers fire on rising edges ONLY (KTD2): a routine full re-import re-stamps every row
-- via 0006's set_updated_at trigger — without the WHEN guards, every already-benchmarked problem
-- would insert an event on every full import.
--
-- Lifetime dedupe against NOTIFIED events (KTD2 / R10 / AE2): a problem notified once will never
-- re-notify. But a rising edge after an operator --discard re-arms the event (clears
-- discarded_at, refreshes created_at) — the upstream benchmark flag is documented unreliable
-- (docs/catalog-data-pipeline.md), so a spurious flip discarded must not permanently consume the
-- notification for the genuine promotion that follows.
--
-- Reuses public.set_updated_at() from 0002 (do NOT redefine it here).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. benchmark_events — one row per problem, ever. Public read; no client write policy.
--
-- PK on source_catalog_id (the same natural key catalog_problems uses) means the ON CONFLICT
-- clause in the capture function is the mechanism that enforces "a problem notified once will
-- never re-notify" (R10) — a second rising edge simply DOes UPDATE with a predicate that touches
-- nothing on a notified row.
--
-- notified_at + discarded_at are drain state on the event row (KTD3). Null-both = pending. The
-- drain claims by setting notified_at where it is still null; the operator retracts by setting
-- discarded_at. Both are OWNED by service-role writers; there is no client write policy.
create table if not exists public.benchmark_events (
    source_catalog_id text        primary key,
    layout_id         int         not null,
    angle             int         not null,
    created_at        timestamptz not null default now(),
    notified_at       timestamptz,
    discarded_at      timestamptz
);

comment on table public.benchmark_events is
    'Rising-edge benchmark promotions on catalog_problems. Public-read event stream powering the '
    'in-app banner/dot/deep-link and the aggregated-push drain. One row per problem for its lifetime '
    'once promoted (see 0018 header + KTD1/KTD2).';

-- The drain (import-end + 6h cron) fetches pending events grouped by slab and ordered by time;
-- the client queries `created_at > watermark and discarded_at is null` per slab (KTD1).
create index if not exists benchmark_events_slab_created_idx
    on public.benchmark_events (layout_id, angle, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Capture function — shared by the INSERT and UPDATE triggers below (KTD2).
--
-- The ON CONFLICT contract:
--   • Pending row present  → DO UPDATE with a WHERE that matches nothing → effective no-op
--     (preserves created_at, no duplicate row, no error). Covered by the "flap on pending event"
--     assertion in the RLS tests.
--   • Notified row present → same WHERE excludes it → no re-arm, no re-notify (R10 / AE2).
--   • Discarded row present → WHERE matches → clears discarded_at + refreshes created_at, so the
--     event is fully re-armed for the next drain (KTD2). The client's `discarded_at is null`
--     filter (KTD1) turns the retraction into a banner appearance/disappearance in one place.
--
-- SECURITY DEFINER isn't needed: the function is INSERT into a table the service-role/trigger
-- context can write to; the trigger owns the row it's writing on behalf of. search_path is
-- pinned per the advisor hardening in 0002/0011.
create or replace function public.capture_benchmark_event()
    returns trigger
    language plpgsql
    set search_path = ''
as $$
begin
    insert into public.benchmark_events (source_catalog_id, layout_id, angle)
        values (new.source_catalog_id, new.layout_id, new.angle)
    on conflict (source_catalog_id) do update
        set discarded_at = null,
            created_at   = now()
        where public.benchmark_events.notified_at is null
          and public.benchmark_events.discarded_at is not null;
    return null;  -- AFTER trigger; return value ignored
end;
$$;

-- 2a. INSERT trigger: fires on insert-as-benchmark. WHEN may not reference OLD here; the guard
--     is `new.is_benchmark` alone.
drop trigger if exists catalog_problems_capture_benchmark_ins on public.catalog_problems;
create trigger catalog_problems_capture_benchmark_ins
    after insert on public.catalog_problems
    for each row when (new.is_benchmark)
    execute function public.capture_benchmark_event();

-- 2b. UPDATE trigger: rising edge only — the WHEN guard suppresses the re-stamp path so a full
--     re-import (which touches every row via set_updated_at) does not create events for the ~2,900
--     already-benchmarked problems each time.
drop trigger if exists catalog_problems_capture_benchmark_upd on public.catalog_problems;
create trigger catalog_problems_capture_benchmark_upd
    after update on public.catalog_problems
    for each row when (new.is_benchmark and old.is_benchmark is distinct from new.is_benchmark)
    execute function public.capture_benchmark_event();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS: benchmark_events is world-readable, client-unwritable. Every other table in this
--    migration is strict owner-scope.
alter table public.benchmark_events enable row level security;

create policy "Anyone reads benchmark events"
    on public.benchmark_events for select to anon, authenticated
    using (true);
-- No insert/update/delete policy: clients are denied by default; the trigger and drain use the
-- service-role key (bypasses RLS) or run inside the trigger context.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. notification_interests — (user, layout, angle) target set the drain joins against.
--
-- Composite PK is deliberate: at most one row per user × slab; the client reconcile (KTD7) is
-- a diff-and-upsert against the desired set, so the ON CONFLICT path is the app-start hot path
-- and must not fail. Hence the FULL WITH CHECK clamp on UPDATE (mirrors the 0011 pattern).
create table if not exists public.notification_interests (
    user_id    uuid        not null references auth.users (id) on delete cascade,
    layout_id  int         not null,
    angle      int         not null,
    created_at timestamptz not null default now(),
    primary key (user_id, layout_id, angle)
);

comment on table public.notification_interests is
    'Signed-in user × (layout_id, angle) targets for aggregated benchmark-notification pushes. '
    'Reconciled declaratively by the client (see KTD7); owner-scoped RLS.';

alter table public.notification_interests enable row level security;

create policy "Users read their own notification interests"
    on public.notification_interests for select to authenticated
    using (user_id = auth.uid());
create policy "Users insert their own notification interests"
    on public.notification_interests for insert to authenticated
    with check (user_id = auth.uid());
-- UPDATE policy needs BOTH `using` and `with check` because PostgREST upserts compile to
-- ON CONFLICT DO UPDATE and the reconcile re-upserts existing rows on every app start; without
-- WITH CHECK, interests sync would work once per device and then hard-error (see plan U1
-- approach note + AE5 acceptance).
create policy "Users update their own notification interests"
    on public.notification_interests for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete their own notification interests"
    on public.notification_interests for delete to authenticated
    using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. push_subscriptions — one row per opted-in device (endpoint is unique).
--
-- endpoint + p256dh + auth are the capability to push to that device. Owner-scoped for SELECT
-- as well as write (unlike collaborative reads elsewhere) — leaking another user's endpoint
-- would let anyone with the VAPID keys forge pushes to their device.
create table if not exists public.push_subscriptions (
    id           uuid        primary key default gen_random_uuid(),
    user_id      uuid        not null references auth.users (id) on delete cascade,
    endpoint     text        not null unique,
    p256dh       text        not null,
    auth         text        not null,
    created_at   timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

comment on table public.push_subscriptions is
    'VAPID push endpoint + keys per opted-in signed-in device. Owner-scoped for SELECT + write '
    '(endpoint is a push capability, not merely private data). Reconciled on app start + toggle '
    '(see KTD8).';

create index if not exists push_subscriptions_user_idx
    on public.push_subscriptions (user_id);

-- Reuse the server-authoritative updated_at trigger from 0002. Clients bump last_seen_at on
-- reconcile; updated_at auto-bumps so future observability can page on stale rows.
create trigger push_subscriptions_set_updated_at
    before insert or update on public.push_subscriptions
    for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

create policy "Users read their own push subscriptions"
    on public.push_subscriptions for select to authenticated
    using (user_id = auth.uid());
create policy "Users insert their own push subscriptions"
    on public.push_subscriptions for insert to authenticated
    with check (user_id = auth.uid());
create policy "Users update their own push subscriptions"
    on public.push_subscriptions for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete their own push subscriptions"
    on public.push_subscriptions for delete to authenticated
    using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual steps (no SQL equivalent):
--   1. Apply this migration to the Supabase project (SQL Editor → paste + Run, or
--      `supabase db push`). See docs/catalog-data-pipeline.md.
--   2. Verify the trigger from the SQL editor:
--        update public.catalog_problems set is_benchmark = true
--          where source_catalog_id = '<a-known-non-benchmark>' returning source_catalog_id;
--        select * from public.benchmark_events where source_catalog_id = '<same>';
--      Then revert:
--        update public.catalog_problems set is_benchmark = false where source_catalog_id = '<same>';
--        delete from public.benchmark_events where source_catalog_id = '<same>';
--      (This is AE1's SQL half.)
--   3. VAPID keys are generated once (see docs/catalog-data-pipeline.md → VAPID key runbook, U4).
-- ─────────────────────────────────────────────────────────────────────────────
