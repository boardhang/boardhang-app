-- Assertions for 0013_session_membership_realtime.sql. Run after stub_supabase.sql +
-- stub_realtime.sql + the 0002 → 0007 → 0013 chain + the "Supabase default grants" step.
-- Verifies the session_members trigger broadcasts member-joined on INSERT and member-left on
-- DELETE to the session:<id> channel, liveness-gated. (Receive authorization is 0012's policy,
-- already covered by the 0012 case.)
\set ON_ERROR_STOP on

-- A owns the live session; B joins/leaves it; X owns an expired session.
\set A 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set B 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set X 'cccccccc-cccc-cccc-cccc-cccccccccccc'
\set S '11111111-1111-1111-1111-111111111111'
\set E '22222222-2222-2222-2222-222222222222'

insert into auth.users (id) values (:'A'), (:'B'), (:'X');

-- Live session owned by A. The owner-seat trigger seats A → emits a member-joined we discard.
insert into public.sessions (id, owner_id, board_layout_id, expires_at, deleted)
    values (:'S', :'A', 7, now() + interval '1 hour', false);
delete from realtime.messages; -- start the join assertion from a clean capture

-- ── INSERT → member-joined ────────────────────────────────────────────────────
insert into public.session_members (session_id, user_id) values (:'S', :'B');
do $$
declare _topic text; _event text; _payload jsonb; _n int;
begin
    select count(*) into _n from realtime.messages;
    assert _n = 1, 'FAIL: join emitted ' || _n || ' broadcasts (expected 1)';
    select topic, event, payload into _topic, _event, _payload from realtime.messages;
    assert _topic = 'session:11111111-1111-1111-1111-111111111111',
        'FAIL: join went to wrong topic: ' || _topic;
    assert _event = 'member-joined', 'FAIL: wrong event: ' || _event;
    assert _payload = jsonb_build_object('user_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
        'FAIL: wrong/leaky payload: ' || _payload::text;
    raise notice 'PASS: join emits member-joined {user_id} to the session channel';
end $$;

-- ── DELETE → member-left ──────────────────────────────────────────────────────
delete from realtime.messages;
delete from public.session_members where session_id = :'S' and user_id = :'B';
do $$
declare _event text; _payload jsonb; _n int;
begin
    select count(*) into _n from realtime.messages;
    assert _n = 1, 'FAIL: leave emitted ' || _n || ' broadcasts (expected 1)';
    select event, payload into _event, _payload from realtime.messages;
    assert _event = 'member-left', 'FAIL: wrong event: ' || _event;
    assert _payload = jsonb_build_object('user_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
        'FAIL: wrong payload on leave: ' || _payload::text;
    raise notice 'PASS: leave emits member-left {user_id}';
end $$;

-- ── Liveness gate: a non-live session emits nothing on membership change ───────
delete from realtime.messages;
-- Expired session: the owner-seat insert AND an explicit join must both be gated off.
insert into public.sessions (id, owner_id, board_layout_id, expires_at, deleted)
    values (:'E', :'X', 7, now() - interval '1 minute', false);
insert into public.session_members (session_id, user_id) values (:'E', :'B');
do $$
declare _n int;
begin
    select count(*) into _n from realtime.messages;
    assert _n = 0, 'FAIL: expired session emitted ' || _n || ' membership broadcasts (expected 0)';
    raise notice 'PASS: membership changes on a non-live session emit nothing (liveness gate)';
end $$;

\echo 'ALL 0013 MEMBERSHIP-REALTIME ASSERTIONS PASSED'
