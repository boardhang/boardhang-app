-- 0002_logbook_sync.sql
-- Cloud logbook sync (Phase 2 of the social arc): per-user cloud copies of the
-- logbook so it converges across a user's devices, offline-first with the cloud as
-- the source of truth.
--
-- Scope: **ascents + user-created problems** only. Catalog problems are NOT synced —
-- they ship as bundled read-only JSON (MoonBoardLED/Resources/*.json), identical on
-- every install, so an ascent's source_catalog_id resolves locally on any device.
-- Favorites and app settings stay device-local (later / never).
--
-- Sync model (see docs/plans/2026-07-03-001-feat-cloud-logbook-sync-plan.md):
--   • Every row carries a server-authoritative `updated_at` (trigger below) and a
--     `deleted` tombstone flag. Devices pull `WHERE updated_at > cursor` and push
--     their dirty rows; conflicts resolve by uniform last-write-wins on updated_at.
--   • Deletes are tombstones (deleted = true), kept indefinitely, so a long-offline
--     device loses to the tombstone instead of resurrecting the row.
--   • Unsent same-day attempt rows use a DETERMINISTIC id (UUIDv5 over
--     user|problem|day|unsent) so two devices converge on one row. The partial
--     unique index below is a defensive backstop for that.
--
-- RLS: strictly owner-scoped (user_id = auth.uid()) — a user only ever sees their own
-- rows. Both tables FK to auth.users ON DELETE CASCADE, so the existing
-- public.delete_user() RPC (0001) sweeps them on account deletion — no RPC change.

-- ─────────────────────────────────────────────────────────────────────────────
-- Server-authoritative updated_at. A BEFORE UPDATE trigger stamps now() on every
-- update regardless of what the client sends; INSERT uses the column default. This
-- is the load-bearing correctness piece behind the high-water-mark sync spine —
-- clients never set updated_at, they read it back (returning=representation) to
-- advance their pull cursor.
create or replace function public.set_updated_at()
    returns trigger
    language plpgsql
    set search_path = ''   -- pin search_path (advisor hardening; now() is in pg_catalog)
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- user_problems: the hold sets a user invents. Synced so a user-problem ascent is
-- openable/climbable on a second device (not just a name), and so friends / shared
-- lists can later point at a real problem record.
create table if not exists public.user_problems (
    id         uuid        primary key,
    user_id    uuid        not null references auth.users (id) on delete cascade,
    name       text        not null default '',
    grade      text        not null default '',
    holds      jsonb       not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted    boolean     not null default false
);

comment on table public.user_problems is
    'User-created boulder problems (name + grade + holds), synced per user. Soft-deleted via `deleted`.';

create index if not exists user_problems_user_updated_idx
    on public.user_problems (user_id, updated_at);

create trigger user_problems_set_updated_at
    before insert or update on public.user_problems
    for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- ascents: one logged tick/attempt. Deliberately DENORMALIZED — keeps a snapshot of
-- name/grade so the logbook row stays meaningful even if the source problem changes
-- or is deleted (mirrors the local SwiftData model; do not "normalize" this).
--
-- Problem linkage: source_catalog_id (catalog problems, resolved from the local
-- bundle) OR user_problem_id (FK to user_problems). Both nullable; a row has at most
-- one. ON DELETE SET NULL so deleting a user problem leaves the ascent as a valid
-- snapshot-only row.
create table if not exists public.ascents (
    id               uuid        primary key,
    user_id          uuid        not null references auth.users (id) on delete cascade,
    date             timestamptz not null,
    source_catalog_id text,
    user_problem_id  uuid        references public.user_problems (id) on delete set null,
    problem_name     text        not null default '',
    problem_grade    text        not null default '',
    voted_grade      text        not null default '',
    tries            int         not null default 1,
    stars            int         not null default 0,
    comment          text        not null default '',
    sent             boolean     not null default true,
    board_layout_id  int         not null default 7,
    updated_at       timestamptz not null default now(),
    deleted          boolean     not null default false
);

comment on table public.ascents is
    'Per-user logged ascents (sends + attempts). Denormalized snapshot; soft-deleted via `deleted`.';

create index if not exists ascents_user_updated_idx
    on public.ascents (user_id, updated_at);

create trigger ascents_set_updated_at
    before insert or update on public.ascents
    for each row execute function public.set_updated_at();

-- Defensive backstop for deterministic attempt ids: at most one live unsent attempt
-- per (user, problem-identity, UTC calendar-day). The client already computes a
-- deterministic id so two devices converge on one row; this guards against a bug or
-- a non-deterministic client. Uses UTC to match the client's day bucket (KTD5 / R-M5).
create unique index if not exists ascents_unsent_attempt_key
    on public.ascents (
        user_id,
        coalesce(source_catalog_id, user_problem_id::text, ''),
        (date_trunc('day', date at time zone 'utc'))
    )
    where sent = false and deleted = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security: owner-only on both tables (mirrors the profiles policy quartet
-- in 0001, but scoped to the owner rather than world-readable — logbooks are private).
alter table public.user_problems enable row level security;
alter table public.ascents        enable row level security;

create policy "Users read their own user_problems"
    on public.user_problems for select to authenticated
    using (user_id = auth.uid());
create policy "Users insert their own user_problems"
    on public.user_problems for insert to authenticated
    with check (user_id = auth.uid());
create policy "Users update their own user_problems"
    on public.user_problems for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete their own user_problems"
    on public.user_problems for delete to authenticated
    using (user_id = auth.uid());

create policy "Users read their own ascents"
    on public.ascents for select to authenticated
    using (user_id = auth.uid());
create policy "Users insert their own ascents"
    on public.ascents for insert to authenticated
    with check (user_id = auth.uid());
create policy "Users update their own ascents"
    on public.ascents for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete their own ascents"
    on public.ascents for delete to authenticated
    using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: no change needed. public.delete_user() (0001) deletes auth.users
-- for the calling user; the ON DELETE CASCADE FKs above sweep their ascents +
-- user_problems automatically.
--
-- Manual step (no SQL equivalent): apply this migration to the Supabase project
-- (SQL Editor → paste + Run, or `supabase db push`). See
-- docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────
