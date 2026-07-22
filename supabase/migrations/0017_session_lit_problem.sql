-- 0017_session_lit_problem.sql
-- Session "now on the wall": store which catalog problem was last lit on the board inside the
-- collaboration session (0007), so every member can answer "which one is active?" without asking
-- the person holding the phone (issue #97). A successful BLE light-up in a session records the
-- problem; the next light-up overwrites it. One physical board has one lit problem, so this is
-- three columns on `sessions` — not a table.
--
-- Scope (this migration = the entire backend substrate): the three `sessions` columns, the
-- member-gated setter RPC (set_session_lit_problem), and the lit-changed broadcast trigger.
--
-- Design (see docs/plans/2026-07-21-001-feat-web-session-lit-problem-plan.md):
--   • Columns on `sessions` (KTD1): lit_problem_id / lit_by / lit_at. Cardinality is one per
--     session; a table would re-implement the queue (0015). Length-capped server-side because
--     any member can write it.
--   • Member-gated SECURITY DEFINER RPC (KTD2): `sessions` UPDATE RLS stays OWNER-only
--     (rename/end — 0007), so members set the lit problem through this RPC, exactly like
--     touch_session. Attribution is pinned inside (lit_by := auth.uid(), lit_at := now()) —
--     not spoofable; a null p_problem_id clears all three columns.
--   • NO expiry bump (plan R7): lighting problems all evening must not keep the 24h privacy
--     backstop from firing — expires_at bumps stay explicit-intent-only (create/join/rename/
--     manual refresh, KTD-6 of 0007). The liveness predicate in the UPDATE's WHERE means a dead
--     session refuses the write (and cannot be revived by it).
--   • Realtime = a data-free 'lit-changed' broadcast on the session's own private
--     session:<id> channel (KTD3), from an AFTER UPDATE trigger gated by a WHEN clause on the
--     lit columns — a rename/touch/end never emits it. REUSES 0012's realtime.messages receive
--     policy unchanged (members of the session are already authorized to receive on that
--     channel). Clients refetch the lit columns through their own RLS select; the payload is
--     never trusted as data (KTD-5).
--
-- RLS: unchanged. Members already read `sessions` rows (0007 "Members read their sessions"),
-- which now carry the lit columns — visible to members only, consistent with the session's
-- sharing model. Non-members see nothing; non-owner members still cannot UPDATE directly.
--
-- NOTE on statement order: columns → RPC → trigger. is_session_member (0007) and
-- realtime.send (Supabase; stubbed in tests) must already exist.

-- ─────────────────────────────────────────────────────────────────────────────
-- The lit-problem pointer. lit_by is attribution only (SET NULL on user delete, like
-- session_queue.added_by); lit_at orders/ages the pointer. All three are null until the first
-- light-up and null again after a clear.
alter table public.sessions add column if not exists lit_problem_id text;
alter table public.sessions add column if not exists lit_by uuid references auth.users (id) on delete set null;
alter table public.sessions add column if not exists lit_at timestamptz;

-- Server-authoritative cap (any member can write this via the RPC). Catalog ids are short
-- (`source_catalog_id` strings); 64 is generous headroom, garbage-stuffing is not.
alter table public.sessions drop constraint if exists session_lit_problem_len;
alter table public.sessions add constraint session_lit_problem_len
    check (lit_problem_id is null or char_length(lit_problem_id) <= 64);

comment on column public.sessions.lit_problem_id is
    'source_catalog_id of the problem last lit on the board during this session ("now on the wall", issue #97). Null = nothing recorded. Overwritten by each successful light-up; set only via set_session_lit_problem().';

-- ─────────────────────────────────────────────────────────────────────────────
-- set_session_lit_problem: the ONLY sanctioned write path for the lit columns. SECURITY DEFINER
-- (bypasses the owner-only sessions UPDATE policy) so two guards are load-bearing: (1) the
-- caller must be a member of p_session_id, and (2) the UPDATE's WHERE repeats the liveness
-- predicate, so a dead session refuses the write instead of being revived. Attribution is
-- pinned to auth.uid()/now() here — the client never supplies lit_by/lit_at. Passing null
-- clears the pointer. Deliberately NO expires_at bump (plan R7). Pinned search_path
-- (advisor hardening).
create or replace function public.set_session_lit_problem(p_session_id uuid, p_problem_id text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if not public.is_session_member(p_session_id, auth.uid()) then
        raise exception 'not a session member';
    end if;

    update public.sessions s
    set lit_problem_id = p_problem_id,
        lit_by         = case when p_problem_id is null then null else auth.uid() end,
        lit_at         = case when p_problem_id is null then null else now() end
    where s.id = p_session_id
      and s.deleted = false
      and s.expires_at > now();

    if not found then
        raise exception 'session is not live';
    end if;
end;
$$;

revoke all on function public.set_session_lit_problem(uuid, text) from public;
grant execute on function public.set_session_lit_problem(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Broadcast trigger: a lit-column change pushes a data-free 'lit-changed' nudge on the
-- session's own private channel; co-members' clients refetch the lit columns via RLS
-- (sessionRealtime → refreshLitProblem). The WHEN clause keeps every other sessions UPDATE
-- (rename, touch_session's expiry bump, soft-delete end) silent on this event — those have
-- their own signals (0013/0014). SECURITY DEFINER so realtime.send runs privileged regardless
-- of the writer's role. Reuses 0012's receive policy; no new realtime.messages policy here.
create or replace function public.sessions_emit_lit_changed()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    perform realtime.send(
        payload => jsonb_build_object('session', new.id),
        event   => 'lit-changed',
        topic   => 'session:' || new.id::text,
        private => true
    );
    return null;
end;
$$;

create trigger sessions_emit_lit_changed
    after update on public.sessions
    for each row
    when (old.lit_problem_id is distinct from new.lit_problem_id
          or old.lit_at is distinct from new.lit_at)
    execute function public.sessions_emit_lit_changed();

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: no change needed. lit_by is SET NULL on user delete (the pointer survives
-- its lighter's deletion as an attribution-less value); owned sessions cascade as before (0007).
--
-- Manual step (no SQL equivalent): apply this migration to the Supabase project (SQL Editor →
-- paste + Run, or `supabase db push`). Because this is a cross-user data path, verify it — a
-- member can set/clear via the RPC and co-members receive 'lit-changed'; a non-member can do
-- neither — BEFORE deploying the client bundle that calls the RPC. Realtime Authorization for
-- Broadcast is already enabled (0012). See docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────
