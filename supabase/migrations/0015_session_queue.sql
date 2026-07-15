-- 0015_session_queue.sql
-- Session playlist queue: a shared, ordered list of problems a crew wants to try, living inside
-- a collaboration session (0007). Any member adds, reorders, checks off, and removes; changes
-- push to co-members over the session's existing private Broadcast channel. The queue is the
-- crew's short-term memory for "what's next" — it does not replace the session's record of what
-- got sent (ascents / session_member_ascents stay untouched).
--
-- Scope (this migration = the entire backend substrate): one table — session_queue — plus its
-- membership RLS, an attribution-pinning trigger, the session-scoped reorder RPC, and the
-- queue-changed broadcast trigger.
--
-- Design (see docs/plans/2026-07-15-001-feat-web-session-queue-plan.md):
--   • Modeled on list_problems (0003): same problem-reference shape (source_catalog_id,
--     board_layout_id, added_by SET NULL, deleted soft-delete, no DELETE policy) plus a
--     session_id FK, an integer `position`, and lifecycle columns done_at / done_by (KTD1).
--   • Item lifecycle = active (done_at null) / done (done_at set, kept in a "Done" group) /
--     removed (deleted). The partial unique index is scoped to ACTIVE rows only, so a
--     checked-off problem can be re-added as a fresh active item (KTD2 / AE5).
--   • Ordering is `position` among active rows; a reorder is one session-scoped SECURITY DEFINER
--     RPC. Because a DEFINER RPC bypasses RLS, the position rewrite is constrained to
--     session_id = p_session_id — checking only the caller's membership would let a member of
--     one session scramble another session's order (KTD3 / KTD3a).
--   • Attribution (added_by / done_by) is server-authoritative (KTD1): added_by is set on INSERT
--     (RLS WITH CHECK), immutable on UPDATE, and done_by is pinned to auth.uid() at check-off —
--     a member cannot spoof who added or checked off an item. Enforced by a BEFORE UPDATE
--     trigger (RLS WITH CHECK cannot see OLD).
--   • Realtime = a data-free 'queue-changed' broadcast on the row's own session:<id> channel
--     (KTD4). Unlike 0012's ascents fan-out, each queue row carries its session_id, so the
--     trigger emits directly with no live-session loop. It REUSES 0012's realtime.messages
--     receive policy unchanged — a member of the session is already authorized to receive on
--     that channel; no new receive policy here.
--
-- RLS: a member may read + edit their session's queue; a non-member sees nothing. session_id FKs
-- sessions ON DELETE CASCADE, so the existing account-deletion sweep (0001 delete_user → cascade)
-- reaches queue rows with no RPC change. Cascade never fires in normal operation (sessions are
-- only ever soft-deleted); a future hard-delete sweep of expired sessions must preserve queue
-- rows first, or the planned sessions logbook loses its history.
--
-- NOTE on statement order: table → attribution trigger → reorder RPC → RLS → emit trigger.
-- is_session_member (0007) and set_updated_at (0002) must already exist (they do — this migration
-- applies after both).

-- ─────────────────────────────────────────────────────────────────────────────
-- session_queue: the shared queue rows. One row per queued problem occurrence. `position` orders
-- ACTIVE rows (done rows render separately, ordered by done_at). added_by / done_by are
-- attribution only (SET NULL on user delete, like list_problems.added_by).
create table if not exists public.session_queue (
    id                uuid        primary key default gen_random_uuid(),
    session_id        uuid        not null references public.sessions (id) on delete cascade,
    source_catalog_id text        not null,
    board_layout_id   int         not null default 7,
    added_by          uuid        references auth.users (id) on delete set null,
    position          int         not null default 0,
    done_at           timestamptz,
    done_by           uuid        references auth.users (id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    deleted           boolean     not null default false
);

comment on table public.session_queue is
    'Shared, ordered queue of problems inside a collaboration session. Any member adds/reorders/checks off/removes. Lifecycle: active (done_at null) / done (done_at set) / removed (deleted). Ordering via `position` among active rows.';

create index if not exists session_queue_session_idx on public.session_queue (session_id);

-- A problem is ACTIVE at most once per session; a done or removed row does not block re-adding it.
create unique index if not exists session_queue_active_catalog_key
    on public.session_queue (session_id, source_catalog_id)
    where deleted = false and done_at is null;

create trigger session_queue_set_updated_at
    before insert or update on public.session_queue
    for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Attribution pinning. RLS WITH CHECK validates only the NEW row and cannot compare against OLD,
-- so immutability of added_by / created_at and the pin of done_by are enforced here. Runs as the
-- invoking role (not DEFINER) — it only rewrites NEW; auth.uid() reads the caller's id.
create or replace function public.session_queue_pin_attribution()
    returns trigger
    language plpgsql
    set search_path = ''
as $$
begin
    new.added_by   := old.added_by;    -- who added is immutable
    new.created_at := old.created_at;  -- created_at is immutable
    if new.done_at is not null and old.done_at is null then
        new.done_by := auth.uid();     -- pin the checker at check-off
    elsif new.done_at is null then
        new.done_by := null;           -- un-check clears the checker
    else
        new.done_by := old.done_by;    -- unchanged while it stays done
    end if;
    return new;
end;
$$;

create trigger session_queue_pin_attribution
    before update on public.session_queue
    for each row execute function public.session_queue_pin_attribution();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security. Membership (via is_session_member, 0007) is the gate; a non-member sees
-- zero rows. Mirrors the list_problems policy shape (0003): any member reads and edits; INSERT is
-- attributed to the caller; removal is a soft-delete via UPDATE (no DELETE policy).
alter table public.session_queue enable row level security;

create policy "Members read the queue"
    on public.session_queue for select to authenticated
    using (public.is_session_member(session_id, auth.uid()));
-- A queue item is always created ACTIVE and attributed to the caller: `added_by = auth.uid()`,
-- and `done_at`/`done_by` must be null on insert. Without the done-column clause a member could
-- INSERT a row with a forged `done_by` (the attribution trigger below pins it only on UPDATE),
-- spoofing who checked an item off. Check-off happens through UPDATE, where the trigger pins it.
create policy "Members add to the queue"
    on public.session_queue for insert to authenticated
    with check (
        public.is_session_member(session_id, auth.uid())
        and added_by = auth.uid()
        and done_at is null
        and done_by is null
    );
create policy "Members edit the queue"
    on public.session_queue for update to authenticated
    using (public.is_session_member(session_id, auth.uid()))
    with check (public.is_session_member(session_id, auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- reorder_session_queue: rewrite active-row positions to the caller-supplied order, atomically.
-- SECURITY DEFINER (a single transaction so concurrent readers only see the committed order) —
-- which means it BYPASSES RLS, so two guards are load-bearing (KTD3a): (1) the caller must be a
-- member of p_session_id, and (2) the UPDATE is constrained to session_id = p_session_id, so ids
-- belonging to another session are ignored, never written. Pinned search_path (advisor hardening).
create or replace function public.reorder_session_queue(p_session_id uuid, p_ordered_ids uuid[])
    returns void
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if not public.is_session_member(p_session_id, auth.uid()) then
        raise exception 'not a session member';
    end if;

    update public.session_queue q
    set position = ord.idx
    from unnest(p_ordered_ids) with ordinality as ord(id, idx)
    where q.id         = ord.id
      and q.session_id = p_session_id   -- KTD3a: cross-session scoping is the security boundary
      and q.deleted    = false
      and q.done_at    is null;
end;
$$;

revoke all on function public.reorder_session_queue(uuid, uuid[]) from public;
grant execute on function public.reorder_session_queue(uuid, uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Broadcast trigger: every queue write pushes a data-free 'queue-changed' nudge on the row's own
-- session:<id> channel; co-members' clients debounce-refetch the queue (the payload carries no
-- queue content). AFTER INSERT OR UPDATE so add / reorder / check-off / soft-remove all refresh
-- co-members. SECURITY DEFINER so realtime.send runs privileged regardless of the writer's role.
-- Reuses 0012's realtime.messages receive policy (a member of session <id> is already authorized
-- to receive on 'session:<id>') — no new receive policy here.
create or replace function public.session_queue_emit_changed()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    perform realtime.send(
        payload => jsonb_build_object('session', new.session_id),
        event   => 'queue-changed',
        topic   => 'session:' || new.session_id::text,
        private => true
    );
    return null;
end;
$$;

create trigger session_queue_emit_changed
    after insert or update on public.session_queue
    for each row execute function public.session_queue_emit_changed();

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: no change needed. public.delete_user() (0001) deletes auth.users for the
-- caller; session_id → sessions ON DELETE CASCADE sweeps queue rows when a session is hard-deleted
-- (owner deletion cascade), and added_by / done_by are SET NULL so a row survives its author's
-- deletion as an attribution-less entry.
--
-- Follow-up (deferred, per plan KTD8): a future scheduled hard-delete sweep of expired sessions
-- must preserve or relocate session_queue rows first, or the planned sessions logbook loses
-- history — the ON DELETE CASCADE would otherwise remove them.
--
-- Manual step (no SQL equivalent): apply this migration to the Supabase project (SQL Editor →
-- paste + Run, or `supabase db push`). Because this is a cross-user data path, verify it — a
-- member can read/add/reorder, a non-member cannot, and a queue write nudges the session channel —
-- BEFORE deploying the client bundle that calls its table/RPC. Realtime Authorization for the
-- project's Broadcast channels is already enabled (0012). See docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────
