-- 0016_session_resume.sql
-- Cross-device session resume: enumerate the caller's LIVE collaboration sessions so a second
-- device signed into the same account can DISCOVER and re-adopt a session created or joined
-- elsewhere. The "active session" is otherwise device-local — the pointer lives only in the
-- originating device's localStorage (web/src/sessions/sessionsStore.ts), and the client never
-- enumerates a user's sessions — so a fresh device has no way to find its own live session. This
-- migration adds the single missing read; the client (resumeSession) adopts a returned row as the
-- active session WITHOUT re-joining (the caller is already a member).
--
-- Scope: one SECURITY DEFINER read-only RPC. No new tables, no RLS changes, no new exposure —
-- it returns the same rows a member can already read via the 0007 "Members read their sessions"
-- SELECT policy, packaged server-side as "mine, and live".
--
-- Design (see docs/plans/2026-07-20-001-feat-web-resume-active-session-plan.md):
--   • Membership-scoped — gated on is_session_member(id, auth.uid()); a non-member gets nothing.
--   • Live-only, SERVER-judged — deleted = false AND expires_at > now(). Judging liveness with
--     server now() (not a client clock) keeps the server the liveness authority, matching every
--     other session read; a skewed device clock can neither hide nor surface a session.
--   • PURE READ — never bumps expires_at (mirrors session_member_ascents in 0007). Listing your
--     sessions on an idle second device must NOT revive a dying crew; only explicit intent
--     (create / join / touch_session) bumps the 24h privacy backstop.
--   • No invite_token — returns the client's SESSION_COLUMNS shape only (id, owner_id, name,
--     board_layout_id, expires_at, created_at, updated_at, deleted). The share-link secret never
--     enters the client cache via this path (KTD-7 of 0007). NOTE: this return list is
--     hand-maintained — if a sensitive column is ever added to public.sessions, it is NOT
--     auto-excluded here; the 0016 test's invite_token-exclusion assertion is the guardrail, keep
--     it in lockstep with SESSION_COLUMNS.
--   • Ordered by expires_at DESC — most-recently-active first (each explicit touch pushes
--     expires_at to now()+24h, so the largest expires_at is the freshest session).
--   • SECURITY DEFINER + pinned search_path, execute granted to authenticated, membership
--     re-checked inside the body (defense in depth over RLS) — the same idiom as the four 0007 RPCs.

create or replace function public.list_my_live_sessions()
    returns table (
        id              uuid,
        owner_id        uuid,
        name            text,
        board_layout_id int,
        expires_at      timestamptz,
        created_at      timestamptz,
        updated_at      timestamptz,
        deleted         boolean
    )
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select s.id, s.owner_id, s.name, s.board_layout_id,
           s.expires_at, s.created_at, s.updated_at, s.deleted
    from public.sessions s
    where public.is_session_member(s.id, auth.uid())
      and s.deleted = false
      and s.expires_at > now()
    order by s.expires_at desc;
$$;

revoke all on function public.list_my_live_sessions() from public;
grant execute on function public.list_my_live_sessions() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: no change needed. This is a read-only function over existing tables; the
-- 0001 public.delete_user() and the sessions/session_members ON DELETE CASCADE (0007) already
-- sweep a user's session rows on account deletion.
--
-- Manual step (no SQL equivalent): apply this migration to the Supabase project (SQL Editor →
-- paste + Run, or `supabase db push`). Because this widens the read surface of a cross-user
-- privacy path, verify it — a member sees only their own LIVE sessions, a non-member sees none,
-- invite_token is never returned, and calling it never bumps expires_at — BEFORE deploying the
-- client bundle that calls the RPC. A missing RPC degrades safely (the client's listMyLiveSessions
-- returns [] and the Resume surface simply renders nothing), so applying this first is required
-- for the feature to appear, not to avoid breakage. See docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────
