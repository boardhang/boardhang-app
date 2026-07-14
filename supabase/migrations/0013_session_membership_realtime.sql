-- 0013_session_membership_realtime.sql
-- Live session ROSTER changes, layered on the realtime substrate from 0012. When someone joins
-- or leaves a session, broadcast a nudge on the same private session:<id> channel so co-members'
-- clients reload the roster (live member avatars) and surface a "joined" toast — no refresh.
--
-- Scope: a reusable membership-emit helper + an AFTER INSERT OR DELETE trigger on
-- session_members. NO new authorization: these events ride the session:<id> channel and are
-- gated by 0012's existing realtime.messages receive policy (members only), so the emit is the
-- only piece needed.
--
-- Design (mirrors 0012's KTD-2/3/4):
--   • Server-side emission from a trigger on session_members — fires for every join path
--     (join_session_by_token, the owner-seat trigger) and every leave path (self-leave, owner
--     removal, account-deletion cascade), independent of which client caused it.
--   • Payload carries only the affected user_id. This is NOT a leak: session membership is
--     already mutually visible to members via the roster (session_members + profiles), and the
--     receive policy delivers only to members. The client uses it (and a roster diff) to label
--     the toast; it never trusts it as authorization.
--   • Liveness-gated: only nudge a session that is still live. This also means a hard-delete
--     CASCADE that removes a session's members (e.g. the session row deleted, or account
--     deletion removing the owner) does NOT emit a member-left storm — the parent session is
--     already gone / not-live when the child DELETE trigger fires, so the guard is false.
--   • Soft-delete / expiry (the app's normal "end session") leaves session_members intact, so
--     ending a session emits nothing — correct, nobody actually left.

-- ─────────────────────────────────────────────────────────────────────────────
-- emit_session_membership_change: broadcast a membership event to a LIVE session's channel.
-- SECURITY DEFINER + pinned search_path (same posture as 0012's emit helper). Only the trigger
-- calls it (never granted to authenticated).
create or replace function public.emit_session_membership_change(
    p_session_id uuid,
    p_user_id    uuid,
    p_event      text
)
    returns void
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if exists (
        select 1 from public.sessions s
        where s.id = p_session_id
          and s.deleted = false
          and s.expires_at > now()
    ) then
        perform realtime.send(
            jsonb_build_object('user_id', p_user_id), -- member id only; membership is mutually visible
            p_event,
            'session:' || p_session_id::text,
            true
        );
    end if;
end;
$$;

revoke all on function public.emit_session_membership_change(uuid, uuid, text) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: a join (INSERT) → 'member-joined', a leave/removal (DELETE) → 'member-left'.
create or replace function public.session_members_emit_membership()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        perform public.emit_session_membership_change(new.session_id, new.user_id, 'member-joined');
    elsif tg_op = 'DELETE' then
        perform public.emit_session_membership_change(old.session_id, old.user_id, 'member-left');
    end if;
    return null;
end;
$$;

create trigger session_members_emit_membership
    after insert or delete on public.session_members
    for each row execute function public.session_members_emit_membership();

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual step: apply to the Supabase project. No new Realtime Authorization needed — these
-- events reuse 0012's session:<id> receive policy. Verify: a co-member sees the roster update
-- (and a "joined" toast) when someone joins, and the avatars shrink when someone leaves — all
-- without a manual refresh. See docs/plans/2026-07-13-002-feat-web-session-realtime-plan.md.
-- ─────────────────────────────────────────────────────────────────────────────
