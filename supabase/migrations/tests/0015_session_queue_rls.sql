-- Assertions for 0015_session_queue.sql. Run after stub_supabase.sql + the 0002 → 0007 chain +
-- stub_realtime.sql + 0015 + the "Supabase default grants" step (see run_rls_test.sh).
-- Behaviors under test:
--   (A) Membership RLS: a member of a session can add / read / edit its queue; a non-member is
--       denied all of INSERT/SELECT/UPDATE (R11).
--   (B) Active-only partial unique: a problem may be active at most once, but a checked-off
--       (done) or removed row does not block re-adding it (R5 / AE5).
--   (C) Attribution pinning: added_by is immutable on UPDATE and done_by is pinned to the
--       checker at check-off — a member cannot spoof who added or checked off an item (KTD1).
--   (D) reorder_session_queue is session-scoped: a member of session A passing session B's ids
--       cannot mutate B's order, and a non-member is refused outright (R3 / KTD3a).
--   (E) The queue-changed trigger emits one broadcast on the row's session:<id> channel (R10).
-- Negative cases wrap the denied path in a block and RAISE if wrongly allowed; psql runs with
-- ON_ERROR_STOP so any raise fails the whole run.
\set ON_ERROR_STOP on

-- A owns session SA; B owns session SB; M is a co-member of SA; OUT is a non-member.
\set A   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set B   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set M   'dddddddd-dddd-dddd-dddd-dddddddddddd'
\set OUT 'cccccccc-cccc-cccc-cccc-cccccccccccc'

\set SA '11111111-1111-1111-1111-111111111111'
\set SB '22222222-2222-2222-2222-222222222222'

-- Fixed queue-row ids so the cross-session reorder case can address rows by id inside do-blocks
-- (psql :'var' interpolation does not reach inside do $$ … $$).
\set QA1 'a0000000-0000-0000-0000-000000000001'
\set QA2 'a0000000-0000-0000-0000-000000000002'
\set QB1 'b0000000-0000-0000-0000-000000000001'
\set QB2 'b0000000-0000-0000-0000-000000000002'

insert into auth.users (id) values (:'A'), (:'B'), (:'M'), (:'OUT');

-- Seed sessions as superuser (bypasses RLS). The owner-seat trigger (0007) seats each owner as a
-- member: A ∈ SA, B ∈ SB. M is added to SA below; OUT is left a non-member of both.
insert into public.sessions (id, owner_id, name, board_layout_id, expires_at, deleted) values
    (:'SA', :'A', 's-a', 7, now() + interval '1 hour', false),
    (:'SB', :'B', 's-b', 7, now() + interval '1 hour', false);
insert into public.session_members (session_id, user_id) values (:'SA', :'M') on conflict do nothing;

-- ── (A) Membership RLS ─────────────────────────────────────────────────────────
-- Member A adds a problem to SA and can read it back.
set role authenticated;
select set_config('test.uid', :'A', false);
insert into public.session_queue (session_id, source_catalog_id, board_layout_id, added_by, position)
    values (:'SA', 'prob-1', 7, :'A', 1);
do $$
begin
    assert (select count(*) from public.session_queue where source_catalog_id = 'prob-1') = 1,
        'FAIL: member A cannot read a row it added';
    raise notice 'PASS: member can add and read its session queue';
end $$;

-- Non-member OUT sees nothing and cannot insert.
select set_config('test.uid', :'OUT', false);
do $$
begin
    assert (select count(*) from public.session_queue) = 0,
        'FAIL: a non-member can read a session queue';
    begin
        insert into public.session_queue (session_id, source_catalog_id, added_by, position)
            values ('11111111-1111-1111-1111-111111111111', 'prob-x',
                    'cccccccc-cccc-cccc-cccc-cccccccccccc', 1);
        raise exception 'FAIL: a non-member inserted into a session queue';
    exception when insufficient_privilege then
        raise notice 'PASS: non-member SELECT sees nothing and INSERT is denied';
    end;
end $$;

-- ── (B) Active-only partial unique + re-add after done (AE5) ─────────────────────
select set_config('test.uid', :'A', false);
do $$
begin
    begin
        insert into public.session_queue (session_id, source_catalog_id, added_by, position)
            values ('11111111-1111-1111-1111-111111111111', 'prob-1',
                    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2);
        raise exception 'FAIL: a second active row for the same problem was allowed';
    exception when unique_violation then
        raise notice 'PASS: active-only partial unique blocks a duplicate active row';
    end;
end $$;

-- Check the active prob-1 off, then re-add it: now allowed (the done row does not block).
update public.session_queue set done_at = now() where source_catalog_id = 'prob-1' and done_at is null;
insert into public.session_queue (session_id, source_catalog_id, added_by, position)
    values (:'SA', 'prob-1', :'A', 3);
do $$
begin
    assert (select count(*) from public.session_queue
            where source_catalog_id = 'prob-1' and deleted = false) = 2,
        'FAIL: re-add after check-off did not create a second (active) row';
    raise notice 'PASS: a checked-off problem can be re-added (AE5)';
end $$;

-- ── (C) Attribution pinning ──────────────────────────────────────────────────────
-- A adds prob-attr; M (a co-member) then tries to steal added_by and later checks it off.
insert into public.session_queue (session_id, source_catalog_id, added_by, position)
    values (:'SA', 'prob-attr', :'A', 4);
select set_config('test.uid', :'M', false);
update public.session_queue set added_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    where source_catalog_id = 'prob-attr';
do $$
begin
    assert (select added_by from public.session_queue where source_catalog_id = 'prob-attr')
           = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'FAIL: added_by was mutated on UPDATE (attribution spoof)';
    raise notice 'PASS: added_by is immutable on UPDATE';
end $$;
update public.session_queue set done_at = now() where source_catalog_id = 'prob-attr';
do $$
begin
    assert (select done_by from public.session_queue where source_catalog_id = 'prob-attr')
           = 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        'FAIL: done_by was not pinned to the member who checked it off';
    raise notice 'PASS: done_by is pinned to auth.uid() at check-off';
end $$;

-- INSERT-time forge: a member cannot create a row pre-marked done or attributed to someone else.
-- The INSERT policy requires done_at IS NULL AND done_by IS NULL — check-off happens only via
-- UPDATE, where the attribution trigger pins done_by to the caller.
select set_config('test.uid', :'A', false);
do $$
begin
    begin
        insert into public.session_queue
            (session_id, source_catalog_id, added_by, position, done_at, done_by)
        values ('11111111-1111-1111-1111-111111111111', 'prob-forge',
                'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 5, now(),
                'dddddddd-dddd-dddd-dddd-dddddddddddd');
        raise exception 'FAIL: a member inserted a row with a forged done_at/done_by';
    exception when insufficient_privilege then
        raise notice 'PASS: INSERT with a non-null done_at/done_by is denied (no attribution forge)';
    end;
end $$;

-- ── (D) reorder_session_queue is session-scoped (KTD3a) ──────────────────────────
reset role;
insert into public.session_queue (id, session_id, source_catalog_id, added_by, position) values
    (:'QA1', :'SA', 'qa-1', :'A', 1),
    (:'QA2', :'SA', 'qa-2', :'A', 2),
    (:'QB1', :'SB', 'qb-1', :'B', 1),
    (:'QB2', :'SB', 'qb-2', :'B', 2);

set role authenticated;
select set_config('test.uid', :'A', false);
-- A reorders its own session (swap qa-1 / qa-2).
select public.reorder_session_queue(:'SA', array[:'QA2', :'QA1']::uuid[]);
do $$
begin
    assert (select position from public.session_queue where id = 'a0000000-0000-0000-0000-000000000002') = 1
       and (select position from public.session_queue where id = 'a0000000-0000-0000-0000-000000000001') = 2,
        'FAIL: reorder did not apply within the caller''s own session';
    raise notice 'PASS: a member reorders its own session';
end $$;

-- A (a member of SA only) passes SB's ids under p_session_id = SA: SB must be untouched. Observe
-- SB as superuser — A cannot SELECT SB's rows through RLS, so a member-role read would see NULL
-- (a false pass) rather than SB's true positions.
select public.reorder_session_queue(:'SA', array[:'QB2', :'QB1']::uuid[]);
reset role;
do $$
begin
    assert (select position from public.session_queue where id = 'b0000000-0000-0000-0000-000000000001') = 1
       and (select position from public.session_queue where id = 'b0000000-0000-0000-0000-000000000002') = 2,
        'FAIL: cross-session reorder mutated another session (KTD3a hole)';
    raise notice 'PASS: reorder ignores ids outside p_session_id';
end $$;

-- A non-member is refused outright.
set role authenticated;
select set_config('test.uid', :'OUT', false);
do $$
begin
    begin
        perform public.reorder_session_queue('11111111-1111-1111-1111-111111111111',
            array['a0000000-0000-0000-0000-000000000001']::uuid[]);
        raise exception 'FAIL: a non-member reordered a session';
    exception when others then
        if sqlerrm like '%not a session member%' then
            raise notice 'PASS: non-member reorder is refused';
        else
            raise;
        end if;
    end;
end $$;

-- ── (E) queue-changed trigger emission ───────────────────────────────────────────
reset role;
delete from realtime.messages;
set role authenticated;
select set_config('test.uid', :'A', false);
insert into public.session_queue (session_id, source_catalog_id, added_by, position)
    values (:'SA', 'prob-emit', :'A', 9);
reset role;   -- realtime.messages has no member SELECT policy in this chain (that lives in 0012)
do $$
declare _n int; _topic text;
begin
    select count(*), max(topic) into _n, _topic
        from realtime.messages where event = 'queue-changed';
    assert _n >= 1, 'FAIL: a queue write emitted no queue-changed broadcast';
    assert _topic = 'session:11111111-1111-1111-1111-111111111111',
        'FAIL: queue-changed emitted on the wrong topic: ' || coalesce(_topic, '<null>');
    assert (select bool_and(private) from realtime.messages where event = 'queue-changed'),
        'FAIL: queue-changed broadcast was not marked private';
    raise notice 'PASS: a queue write emits a private queue-changed nudge on the session channel';
end $$;

\echo 'ALL 0015 SESSION_QUEUE ASSERTIONS PASSED'
