-- Assertions for 0014_session_end_realtime.sql. Run after stub_supabase.sql + stub_realtime.sql +
-- the 0002 → 0007 → 0014 chain + the "Supabase default grants" step. Verifies the sessions trigger
-- broadcasts session-ended on the deleted false→true edge only. (Receive auth is 0012's policy.)
\set ON_ERROR_STOP on

\set A 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set S '11111111-1111-1111-1111-111111111111'
\set S2 '22222222-2222-2222-2222-222222222222'

insert into auth.users (id) values (:'A');
insert into public.sessions (id, owner_id, board_layout_id, expires_at, deleted) values
    (:'S',  :'A', 7, now() + interval '1 hour', false),
    (:'S2', :'A', 7, now() + interval '1 hour', false);
delete from realtime.messages; -- ignore any owner-seat side effects (no membership trigger here)

-- ── deleted false → true emits session-ended ──────────────────────────────────
update public.sessions set deleted = true where id = :'S';
do $$
declare _topic text; _event text; _payload jsonb; _n int;
begin
    select count(*) into _n from realtime.messages;
    assert _n = 1, 'FAIL: end emitted ' || _n || ' broadcasts (expected 1)';
    select topic, event, payload into _topic, _event, _payload from realtime.messages;
    assert _topic = 'session:11111111-1111-1111-1111-111111111111',
        'FAIL: session-ended went to wrong topic: ' || _topic;
    assert _event = 'session-ended', 'FAIL: wrong event: ' || _event;
    assert _payload = jsonb_build_object('session_id', '11111111-1111-1111-1111-111111111111'),
        'FAIL: wrong payload: ' || _payload::text;
    raise notice 'PASS: soft-delete emits session-ended {session_id} to the session channel';
end $$;

-- ── a second update of an already-ended session does NOT re-broadcast (edge only) ──
delete from realtime.messages;
update public.sessions set name = 'renamed' where id = :'S'; -- deleted already true
do $$
declare _n int;
begin
    select count(*) into _n from realtime.messages;
    assert _n = 0, 'FAIL: re-updating an ended session emitted ' || _n || ' (expected 0)';
    raise notice 'PASS: no re-broadcast on a later update of an already-ended session';
end $$;

-- ── a non-delete update (rename) of a LIVE session does NOT broadcast ──────────
delete from realtime.messages;
update public.sessions set name = 'renamed too' where id = :'S2'; -- deleted stays false
do $$
declare _n int;
begin
    select count(*) into _n from realtime.messages;
    assert _n = 0, 'FAIL: a rename of a live session emitted ' || _n || ' (expected 0)';
    raise notice 'PASS: a non-delete update does not broadcast';
end $$;

\echo 'ALL 0014 SESSION-END REALTIME ASSERTIONS PASSED'
