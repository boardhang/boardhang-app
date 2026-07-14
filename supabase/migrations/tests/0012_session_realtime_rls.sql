-- Assertions for 0012_session_realtime.sql. Run after stub_supabase.sql + stub_realtime.sql +
-- the 0002 → 0007 → 0012 chain + the "Supabase default grants" step (see run_rls_test.sh).
-- Two behaviors under test:
--   (A) The ascents trigger fans a content-free 'ascents-changed' broadcast to exactly the
--       author's LIVE sessions on the ascent's board — not expired/deleted/other-board/
--       non-member sessions — and the payload carries no ascent content (R2/R4).
--   (B) The realtime.messages SELECT policy authorizes receive on 'session:<id>' only for
--       current members of that session (R3).
-- Negative cases wrap the denied path in a block and RAISE if wrongly allowed; psql runs with
-- ON_ERROR_STOP so any raise fails the whole run.
\set ON_ERROR_STOP on

-- A = the send author; M = a co-member; OUT = a non-member outsider.
\set A     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set M     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set OUT   'cccccccc-cccc-cccc-cccc-cccccccccccc'

-- Sessions (see comments at the seed insert for which SHOULD/SHOULD NOT be nudged).
\set S_LIVE1   '11111111-1111-1111-1111-111111111111'
\set S_LIVE2   '22222222-2222-2222-2222-222222222222'
\set S_BOARD5  '33333333-3333-3333-3333-333333333333'
\set S_EXPIRED '44444444-4444-4444-4444-444444444444'
\set S_DELETED '55555555-5555-5555-5555-555555555555'
\set S_NOTMINE '66666666-6666-6666-6666-666666666666'

insert into auth.users (id) values (:'A'), (:'M'), (:'OUT');

-- Seed sessions as superuser (bypasses RLS). The owner-seat trigger (0007) auto-seats owner_id
-- as a member, so ownership IS membership: A owns every session it should belong to; OUT owns
-- S_NOTMINE so A is not seated there. M is added to S_LIVE1 only (below).
insert into public.sessions (id, owner_id, name, board_layout_id, expires_at, deleted) values
    (:'S_LIVE1',   :'A',   's-live-1', 7, now() + interval '1 hour',  false),
    (:'S_LIVE2',   :'A',   's-live-2', 7, now() + interval '1 hour',  false),
    (:'S_BOARD5',  :'A',   's-board5', 5, now() + interval '1 hour',  false),
    (:'S_EXPIRED', :'A',   's-expire', 7, now() - interval '1 minute', false),
    (:'S_DELETED', :'A',   's-delete', 7, now() + interval '1 hour',  true),
    (:'S_NOTMINE', :'OUT', 's-notmine',7, now() + interval '1 hour',  false);

-- M is a member of S_LIVE1 ONLY (co-member for the receive-auth test — must NOT reach S_LIVE2).
insert into public.session_members (session_id, user_id) values
    (:'S_LIVE1', :'M')
on conflict do nothing;

-- ── (A) Trigger fan-out on INSERT ─────────────────────────────────────────────
-- A logs a send on board 7. The trigger must nudge S_LIVE1 + S_LIVE2 only.
insert into public.ascents (id, user_id, date, source_catalog_id, sent, board_layout_id)
    values (gen_random_uuid(), :'A', now(), 'prob-1', true, 7);

do $$
declare _topics text[];
begin
    select array_agg(topic order by topic) into _topics
        from realtime.messages where event = 'ascents-changed';
    assert _topics = array['session:11111111-1111-1111-1111-111111111111',
                           'session:22222222-2222-2222-2222-222222222222'],
        'FAIL: insert fanned to wrong sessions: ' || coalesce(_topics::text, '<null>');
    raise notice 'PASS: insert nudged only the author''s live sessions on that board';
end $$;

-- Payload carries NO ascent content — only the author id (R2).
do $$
declare _payload jsonb;
begin
    select payload into _payload from realtime.messages
        where event = 'ascents-changed' limit 1;
    assert _payload = jsonb_build_object('author', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
        'FAIL: broadcast payload leaked content: ' || coalesce(_payload::text, '<null>');
    assert (select bool_and(private) from realtime.messages where event = 'ascents-changed'),
        'FAIL: broadcast was not marked private';
    raise notice 'PASS: payload is content-free ({author}) and private';
end $$;

-- ── (A) board scope: a send on a board no live session covers nudges nobody ────
-- NB: psql :'A' interpolation does NOT reach inside a do$$…$$ block, so the author uuid is
-- written as a literal here (it is the same constant as :A above).
do $$
declare _n int;
begin
    delete from realtime.messages;  -- reset the capture between fan-out cases
    insert into public.ascents (id, user_id, date, source_catalog_id, sent, board_layout_id)
        values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), 'prob-9', true, 5);
    -- board 5: A's only board-5 session is S_BOARD5, live + member → it SHOULD nudge S_BOARD5.
    select count(*) into _n from realtime.messages
        where event = 'ascents-changed' and topic = 'session:33333333-3333-3333-3333-333333333333';
    assert _n = 1, 'FAIL: board-5 send did not nudge the board-5 session (' || _n || ')';
    -- and nothing else (no board-7 session leaked onto a board-5 send).
    select count(*) into _n from realtime.messages where event = 'ascents-changed';
    assert _n = 1, 'FAIL: board-5 send nudged ' || _n || ' sessions (expected 1)';
    raise notice 'PASS: fan-out is board-scoped';
end $$;

-- ── (A) UPDATE (flip sent) and soft-delete both nudge ─────────────────────────
do $$
declare _id uuid := gen_random_uuid(); _n int;
begin
    delete from realtime.messages;
    insert into public.ascents (id, user_id, date, source_catalog_id, sent, board_layout_id)
        values (_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), 'prob-flip', false, 7); -- insert nudges (2)
    delete from realtime.messages;
    update public.ascents set sent = true where id = _id;   -- flip → nudge again
    select count(*) into _n from realtime.messages where event = 'ascents-changed';
    assert _n = 2, 'FAIL: UPDATE(sent) nudged ' || _n || ' (expected 2 live sessions)';

    delete from realtime.messages;
    update public.ascents set deleted = true where id = _id; -- removal → nudge so it disappears
    select count(*) into _n from realtime.messages where event = 'ascents-changed';
    assert _n = 2, 'FAIL: soft-delete nudged ' || _n || ' (expected 2)';
    raise notice 'PASS: UPDATE and soft-delete both fan out';
end $$;

-- ── (B) realtime.messages receive authorization ───────────────────────────────
-- Seed one broadcast row and probe visibility under member vs non-member, per subscribed topic.
delete from realtime.messages;
insert into realtime.messages (topic, event, payload, private, extension)
    values ('session:11111111-1111-1111-1111-111111111111', 'ascents-changed',
            jsonb_build_object('author', :'A'), true, 'broadcast');

-- Member M subscribing to S_LIVE1 → authorized (rows visible).
set role authenticated;
select set_config('test.uid', :'M', false);
select set_config('realtime.topic', 'session:11111111-1111-1111-1111-111111111111', false);
do $$
begin
    assert (select count(*) from realtime.messages) >= 1,
        'FAIL: a member cannot receive on their own session channel';
    raise notice 'PASS: member is authorized to receive on their session channel';
end $$;

-- Non-member OUT subscribing to S_LIVE1 → denied (0 rows).
select set_config('test.uid', :'OUT', false);
do $$
begin
    assert (select count(*) from realtime.messages) = 0,
        'FAIL: a non-member received on a session channel they do not belong to';
    raise notice 'PASS: non-member is denied receive';
end $$;

-- Member M subscribing to a session they are NOT in (S_LIVE2) → denied.
select set_config('test.uid', :'M', false);
select set_config('realtime.topic', 'session:22222222-2222-2222-2222-222222222222', false);
do $$
begin
    assert (select count(*) from realtime.messages) = 0,
        'FAIL: a user received on a session channel they are not a member of';
    raise notice 'PASS: membership is per-channel (not a member of S_LIVE2 → denied)';
end $$;

-- Malformed / hostile topics → denied WITHOUT raising on the uuid cast. A client picks its own
-- channel name, so 'session:' (empty capture) and 'session:garbage' (non-uuid capture) both
-- satisfy a naive like-guard and would throw invalid_text_representation if the cast were
-- reachable; the CASE + full-uuid regex must deny them cleanly. 'lobby' has no session: prefix.
do $$
declare _topic text;
begin
    foreach _topic in array array['lobby', 'session:', 'session:garbage',
                                  'session:11111111-1111-1111-1111-11111111111'] -- 35 hex → not a uuid
    loop
        perform set_config('realtime.topic', _topic, false);
        assert (select count(*) from realtime.messages) = 0,
            'FAIL: hostile topic authorized or raised: ' || _topic;
    end loop;
    raise notice 'PASS: malformed/hostile topics denied without error (no uuid-cast raise)';
end $$;

reset role;
\echo 'ALL 0012 REALTIME ASSERTIONS PASSED'
