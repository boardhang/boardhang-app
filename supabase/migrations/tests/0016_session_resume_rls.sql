-- Assertions for 0016_session_resume.sql. Run after stub_supabase.sql + the 0002 → 0007 → 0016
-- chain + the "Supabase default grants" step (see run_rls_test.sh).
--
-- Behavior under test — list_my_live_sessions() returns the caller's resumable sessions for
-- cross-device resume:
--   (1) Membership + liveness: a caller gets exactly their LIVE sessions — owned AND joined,
--       across boards — and never expired / soft-deleted / not-mine sessions (R2/R6), newest
--       (largest expires_at) first.
--   (2) A caller who is a member of nothing gets zero rows (R6).
--   (3) invite_token is never in the projection (R6 / KTD-7).
--   (4) It is a PURE READ — calling it does not bump any session's expires_at (R4), so the 24h
--       privacy backstop is never revived by merely listing sessions on an idle second device.
-- Assertions use plpgsql ASSERT (assertion_failure); psql runs with ON_ERROR_STOP so any failure
-- fails the whole run. auth.uid() reads the test.uid GUC (stub_supabase.sql), set per acting user.
\set ON_ERROR_STOP on

-- A = the acting user; OTHER = owns the sessions A joins / is excluded from; OUT = member of nothing.
\set A     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set OTHER 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set OUT   'cccccccc-cccc-cccc-cccc-cccccccccccc'

insert into auth.users (id) values (:'A'), (:'OTHER'), (:'OUT');

-- Seed sessions as superuser (bypasses RLS). The 0007 owner-seat trigger auto-seats owner_id as a
-- member, so ownership IS membership. Distinct expires_at so the desc ordering is deterministic:
--   resume-own (+3h) > resume-joined (+2h) > resume-otherbrd (+1h).
--   resume-expired / resume-deleted / resume-notmine must all be absent from A's result.
insert into public.sessions (id, owner_id, name, board_layout_id, expires_at, deleted) values
    (gen_random_uuid(), :'A',     'resume-own',      7, now() + interval '3 hours',  false),
    (gen_random_uuid(), :'OTHER', 'resume-joined',   7, now() + interval '2 hours',  false),
    (gen_random_uuid(), :'A',     'resume-otherbrd', 5, now() + interval '1 hour',   false),
    (gen_random_uuid(), :'A',     'resume-expired',  7, now() - interval '1 minute', false),
    (gen_random_uuid(), :'A',     'resume-deleted',  7, now() + interval '3 hours',  true),
    (gen_random_uuid(), :'OTHER', 'resume-notmine',  7, now() + interval '3 hours',  false);

-- A joins the OTHER-owned live session (member, not owner). A is deliberately NOT added to
-- resume-notmine, so it must be excluded for A.
insert into public.session_members (session_id, user_id)
select id, :'A' from public.sessions where name = 'resume-joined';

set role authenticated;

-- (1) A sees exactly {own, joined, otherbrd} in expires_at-desc order — proving owned+joined+
--     cross-board inclusion and expired/deleted/not-mine exclusion in one assertion.
select set_config('test.uid', :'A', false);
do $$
declare
    ids      uuid[];
    own      uuid;
    joined   uuid;
    otherbrd uuid;
begin
    select id into own      from public.sessions where name = 'resume-own';
    select id into joined   from public.sessions where name = 'resume-joined';
    select id into otherbrd from public.sessions where name = 'resume-otherbrd';
    -- No ORDER BY in array_agg: it must preserve the function's emitted row order, so this
    -- assertion genuinely exercises the RPC's own `order by expires_at desc` (a client-side
    -- re-sort here would make the ordering claim a false positive).
    select array_agg(id) into ids from public.list_my_live_sessions();
    assert ids = array[own, joined, otherbrd],
        'FAIL: A expected [own, joined, otherbrd] (expires_at desc), got ' || coalesce(ids::text, 'NULL');
end $$;

-- (2) OUT is a member of nothing → empty result.
select set_config('test.uid', :'OUT', false);
do $$
declare n int;
begin
    select count(*) into n from public.list_my_live_sessions();
    assert n = 0, 'FAIL: OUT expected 0 sessions, got ' || n;
end $$;

-- (3) invite_token is never in the projection — referencing it must be an undefined-column error.
select set_config('test.uid', :'A', false);
do $$
begin
    begin
        perform invite_token from public.list_my_live_sessions();
        assert false, 'FAIL: list_my_live_sessions exposed invite_token';
    exception
        when undefined_column then null; -- expected: the column is not in the return shape
    end;
end $$;

-- (4) Pure read: calling the RPC does not bump expires_at (R4).
select set_config('test.uid', :'A', false);
do $$
declare before_ts timestamptz; after_ts timestamptz;
begin
    select expires_at into before_ts from public.sessions where name = 'resume-own';
    perform public.list_my_live_sessions();
    select expires_at into after_ts from public.sessions where name = 'resume-own';
    assert before_ts is not distinct from after_ts,
        'FAIL: list_my_live_sessions bumped expires_at (' || before_ts || ' -> ' || after_ts || ')';
end $$;

reset role;

\echo 'ALL 0016 RESUME ASSERTIONS PASSED'
