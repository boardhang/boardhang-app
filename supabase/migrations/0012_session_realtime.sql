-- 0012_session_realtime.sql
-- Real-time collab-session "sent problem" nudges. Today a member's send lands in `ascents`
-- (0002) and co-members only see it when their client re-runs session_member_ascents() (0007)
-- on activation / foreground / manual refresh. This migration adds a PUSH path: an ascents
-- trigger broadcasts a content-free "changed" nudge to each live session the author is in, on
-- that session's board; the client refetches the same minimal-projection RPC on receipt.
--
-- Scope (this migration = the entire backend substrate for the feature):
--   • public.emit_ascent_activity(user, board) — the reusable fan-out helper.
--   • public.ascents_emit_activity() + trigger on public.ascents — fires the helper.
--   • a realtime.messages SELECT policy — authorizes *receive* on 'session:<id>' channels to
--     current members only.
--
-- Design (see docs/plans/2026-07-13-002-feat-web-session-realtime-plan.md):
--   • Broadcast-as-nudge, NOT postgres_changes on `ascents` (KTD-1). The payload carries NO
--     ascent content — only the author id (R2). `ascents` RLS stays owner-only (0002); the
--     actual sent/tried sets still travel ONLY through session_member_ascents() (0007). A
--     spoofed or malformed nudge can at worst trigger a redundant, still-authorized refetch.
--   • Server-side emission from a DB trigger (KTD-2), so the nudge fires no matter which
--     client wrote the row (web upsert, iOS sync, logbook import) — a client-side broadcast
--     would miss cross-device / import writes and is a dead-end for a future friend Feed.
--   • Board- and liveness-scoped (R4): a send nudges only sessions that are live
--     (deleted = false AND expires_at > now()) AND whose board_layout_id matches the ascent's
--     board. Mirrors the liveness predicate 0007 repeats in every expiry-guarded statement.
--   • Private channels authorized by RLS on realtime.messages (KTD-4). Emission is
--     server-side, so clients only *receive* — a SELECT policy suffices; no INSERT policy,
--     so clients can never publish onto a session channel.
--
-- FEED EXTENSION SEAM (deferred — see plan Scope Boundaries): emit_ascent_activity is the
-- single canonical "a send happened" event source. A future friend-scoped Feed adds ONE more
-- realtime.send(... 'feed:' || p_user_id ...) branch here and one more clause on the
-- realtime.messages policy gated by a friendship predicate — additive, not a rewrite.
--
-- NOTE on statement order: emit_ascent_activity is plpgsql (body resolved at runtime), so it
-- may reference realtime.send before that schema is proven; but the realtime.messages policy
-- needs realtime.messages to exist. On real Supabase it always does. On the throwaway-Postgres
-- test harness, tests/stub_realtime.sql supplies it before this migration is applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- emit_ascent_activity: fan a content-free broadcast out to each LIVE session the author is a
-- member of, on the given board. SECURITY DEFINER so the fan-out query sees session_members
-- and realtime.send runs privileged, regardless of the (authenticated) role that wrote the
-- ascent. Pinned search_path (advisor hardening) → everything is schema-qualified.
create or replace function public.emit_ascent_activity(p_user_id uuid, p_board_layout_id int)
    returns void
    language plpgsql
    security definer
    set search_path = ''
as $$
declare
    r record;
begin
    for r in
        select s.id
        from public.sessions s
        join public.session_members m on m.session_id = s.id
        where m.user_id = p_user_id
          and s.board_layout_id = p_board_layout_id
          and s.deleted = false
          and s.expires_at > now()
    loop
        perform realtime.send(
            -- Content-free (R2): the author id only — never problem/grade/comment/date/tries.
            payload => jsonb_build_object('author', p_user_id),
            event   => 'ascents-changed',
            topic   => 'session:' || r.id::text,
            private => true
        );
    end loop;
end;
$$;

revoke all on function public.emit_ascent_activity(uuid, int) from public;
-- Executed only via the trigger (which runs as row owner) — no direct grant needed. `authenticated`
-- is intentionally NOT granted execute: clients must not be able to fan out arbitrary nudges.

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: every ascents write nudges the author's live sessions. AFTER INSERT OR UPDATE so a
-- new send, a flipped `sent`, an edit, and a soft-delete (deleted = true) all refresh
-- co-members (a removed send must disappear, not linger). Returns null (AFTER trigger).
create or replace function public.ascents_emit_activity()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    perform public.emit_ascent_activity(new.user_id, new.board_layout_id);
    return null;
end;
$$;

create trigger ascents_emit_activity
    after insert or update on public.ascents
    for each row execute function public.ascents_emit_activity();

-- ─────────────────────────────────────────────────────────────────────────────
-- Receive authorization. Realtime Authorization evaluates RLS on realtime.messages with
-- realtime.topic() bound to the channel being subscribed. A member of session <id> may receive
-- broadcasts on 'session:<id>'; everyone else is filtered out. The topic column is not trusted
-- for the check — realtime.topic() is. There is deliberately NO insert policy: clients never
-- publish here (emission is the server-side trigger above).
-- A client fully controls the channel name it subscribes to, so the topic is untrusted input.
-- The uuid cast must be UNREACHABLE for a malformed topic (`session:`, `session:garbage`) — a
-- bare `like 'session:%'` guard would still let `''::uuid` / `'garbage'::uuid` raise, and
-- Postgres does not promise left-to-right short-circuit of AND. A CASE (ordered evaluation is
-- guaranteed) gated by a full-uuid regex casts only a well-formed id, and denies everything else
-- cleanly instead of erroring.
create policy "Members receive session broadcasts"
    on realtime.messages for select to authenticated
    using (
        realtime.messages.extension = 'broadcast'
        and case
            when realtime.topic() ~
                 '^session:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then public.is_session_member(
                substring(realtime.topic() from 'session:(.*)')::uuid,
                (select auth.uid())
            )
            else false
        end
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual step (no SQL equivalent): apply this migration to the Supabase project (SQL Editor →
-- paste + Run, or `supabase db push`) AND enable Realtime Authorization for the project's
-- Broadcast channels. Because this is a cross-user data path, verify it — a member receives a
-- co-member's nudge, a non-member does not — BEFORE deploying the client bundle that subscribes
-- (0012's client counterpart). See docs/social-accounts-login-SETUP.md and
-- docs/plans/2026-07-13-002-feat-web-session-realtime-plan.md.
-- ─────────────────────────────────────────────────────────────────────────────
