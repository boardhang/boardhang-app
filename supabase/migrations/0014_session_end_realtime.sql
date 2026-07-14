-- 0014_session_end_realtime.sql
-- Live session END, layered on the realtime substrate from 0012/0013. When an owner ends a
-- session (soft-delete: sessions.deleted false → true), broadcast a session-ended nudge on the
-- private session:<id> channel so every member's client retires the session at once — no waiting
-- for the passive expiry/reconcile backstop.
--
-- Scope: one AFTER UPDATE trigger on sessions. NO new authorization — session-ended rides the
-- session:<id> channel gated by 0012's receive policy. The soft-delete leaves session_members
-- intact, so is_session_member() is still true at delivery time and members still receive it.
--
-- Design (mirrors 0012/0013):
--   • Fire only on the false → true edge, so a later no-op update (or a rename) of an already-
--     ended session never re-broadcasts.
--   • NOT liveness-gated (unlike the membership emit): the point is to fire precisely as the
--     session becomes not-live.
--   • Payload carries only the session id (which the client already knows from the channel) —
--     no member data.

create or replace function public.sessions_emit_ended()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if new.deleted and not old.deleted then
        perform realtime.send(
            jsonb_build_object('session_id', new.id),
            'session-ended',
            'session:' || new.id::text,
            true
        );
    end if;
    return null;
end;
$$;

create trigger sessions_emit_ended
    after update on public.sessions
    for each row execute function public.sessions_emit_ended();

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual step: apply to the Supabase project. No new Realtime Authorization needed — reuses
-- 0012's session:<id> receive policy. Verify: when the owner ends a session, every other
-- member's session bar disappears (and they get an "ended" toast) without a manual refresh.
-- See docs/plans/2026-07-13-002-feat-web-session-realtime-plan.md.
-- ─────────────────────────────────────────────────────────────────────────────
