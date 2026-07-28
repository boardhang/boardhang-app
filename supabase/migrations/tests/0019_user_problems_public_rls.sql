-- RLS assertions for 0019_user_problems_public.sql. Run after stub_supabase.sql + the 0002
-- migration + seed_legacy_user_problems.sql + the 0018 migration + the 0019 migration + the
-- "Supabase default grants" step (see run_rls_test.sh). Every negative test wraps the denied
-- operation in a block and RAISEs if it was wrongly allowed; psql runs with ON_ERROR_STOP so any
-- raise fails the whole run.
--
-- 0019 is the first migration that lets ANY user read another user's user_problems row, so this
-- case pins the whole public path:
--   • The read policy: a LIVE PUBLIC row is readable by anon and by a second signed-in user; a
--     private row, a tombstoned public row, and a retracted row are readable by neither. Writes
--     stay owner-only — the new SELECT policy must not open an UPDATE/DELETE seam.
--   • The public-completeness CHECK: layout/angle/name/holds are only constrained when the row is
--     LIVE PUBLIC. Every one of those shapes stays legal on a private row, so the iOS-era rows in
--     production (empty name, null layout/angle, '[]' holds) survive untouched (R14).
--   • Attribution (KTD7): setter_user_id / setter_handle are server-owned. The client's values are
--     overwritten from the caller's own profile on publish, publishing without a profile handle is
--     refused (the AE3 server backstop), retracting clears them, and a handle rename — including a
--     rename that FREES a handle for someone else to take — re-stamps only the renamer's own live
--     public rows.
--   • The per-user cap on live public problems, including that it fires on the private→public
--     UPDATE (not just INSERT), excludes the row's own id, ignores tombstones, and actually
--     serializes two concurrent publishers of the same user (see "Concurrency" below).
--
-- Concurrency: psql is one session, so the two-publisher assertions shell out to a SECOND psql
-- session with `\!` (both run inside the test container). That second session records its verdict
-- in public.probe_log and commits, so this session — READ COMMITTED, taking a fresh snapshot per
-- statement — can read the verdict while still holding its own transaction open.
--
-- NOTE: psql does not interpolate :'vars' inside dollar-quoted blocks, so the ids below appear as
-- literals inside every do $$ … $$ (same as 0011/0018). The \sets serve the plain-SQL statements,
-- and carry no trailing comment — an apostrophe there would be read as an unterminated quoted
-- string.
\set ON_ERROR_STOP on

-- Users. U is the setter under test; U2 is a second signed-in user who both reads U's public work
-- and publishes their own. UNP has no profile row and UNH has one with no handle — the two shapes
-- the publish gate must refuse. UC exercises the cap, UL/UL2 the concurrency probes.
\set U   '11111111-1111-1111-1111-111111111111'
\set U2  '22222222-2222-2222-2222-222222222222'
\set UNP '33333333-3333-3333-3333-333333333333'
\set UNH '44444444-4444-4444-4444-444444444444'
\set UC  '55555555-5555-5555-5555-555555555555'
\set UL  '66666666-6666-6666-6666-666666666666'
\set UL2 '77777777-7777-7777-7777-777777777777'

-- U's problems: a live public one, one published then retracted, a public tombstone, and two
-- private rows carrying shapes the public branch forbids. P2 is U2's live public problem.
\set PUB   'b0000000-0000-4000-8000-000000000001'
\set PRET  'b0000000-0000-4000-8000-000000000002'
\set PDEL  'b0000000-0000-4000-8000-000000000003'
\set PSTA  'b0000000-0000-4000-8000-000000000004'
\set P2    'b0000000-0000-4000-8000-000000000005'
-- Cap fixtures (PC1 is one of the 50; PCP is the private row flipped at the boundary).
\set PC1   'b0000000-0000-4000-8000-000000000020'
\set PCP   'b0000000-0000-4000-8000-000000000021'
-- Concurrency fixtures.
\set PL1   'b0000000-0000-4000-8000-000000000030'
\set PL2   'b0000000-0000-4000-8000-000000000031'
\set PL3   'b0000000-0000-4000-8000-000000000032'

insert into auth.users (id) values (:'U'), (:'U2'), (:'UNP'), (:'UNH'), (:'UC'), (:'UL'), (:'UL2');
insert into public.profiles (id, handle, display_name) values
    (:'U',   'setter_one', 'Setter One'),
    (:'U2',  'reader_two', 'Reader Two'),
    (:'UNH', null,         'No Handle'),
    (:'UC',  'capper',     'Capper'),
    (:'UL',  'locker_a',   'Locker A'),
    (:'UL2', 'locker_b',   'Locker B');
-- UNP deliberately gets NO profiles row.

-- ── R14: 0019 left the legacy iOS row alone ──────────────────────────────────
-- Superuser (service-role equivalent — bypasses RLS) inspects the row the whole chain was applied
-- on top of. Adding a public read policy, a completeness CHECK and two triggers must not have
-- rewritten, published, or attributed a row that predates all of them.
do $$
declare _r record;
begin
    select * into _r from public.user_problems
        where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    assert _r.id is not null,    'FAIL: the legacy row did not survive 0019';
    assert _r.name = '',         'FAIL: legacy empty name was rewritten';
    assert _r.holds = '[]'::jsonb, 'FAIL: legacy empty holds array was rewritten';
    assert _r.layout_id is null and _r.angle is null,
        'FAIL: legacy row acquired a layout/angle';
    assert _r.visibility = 'private',
        'FAIL: legacy row is ' || _r.visibility || ', not private (retroactive flip — R14)';
    assert _r.setter_user_id is null and _r.setter_handle is null,
        'FAIL: legacy private row was attributed';
    raise notice 'PASS: the legacy iOS row survives 0019 private, unattributed, and unrewritten (R14)';
end $$;

-- ── Every denial below must be RLS, not a missing GRANT ──────────────────────
-- run_rls_test.sh hands anon/authenticated the same table privileges real Supabase does. Assert
-- that here, or "anon sees zero private rows" would be indistinguishable from the harness simply
-- forgetting the grant — and the policies would go untested.
do $$
declare _role text; _priv text;
begin
    foreach _role in array array['anon', 'authenticated'] loop
        foreach _priv in array array['select', 'insert', 'update', 'delete'] loop
            assert has_table_privilege(_role, 'public.user_problems', _priv),
                'FAIL: ' || _role || ' lacks ' || _priv || ' on user_problems — the denials below '
                          || 'would prove a missing grant, not the policy';
        end loop;
    end loop;
    raise notice 'PASS: anon and authenticated hold Supabase-default grants (denials below are RLS)';
end $$;

-- ── Test helpers ─────────────────────────────────────────────────────────────
-- Plain SECURITY INVOKER functions, so a call made while `set role authenticated` genuinely runs
-- under RLS as that role. They exist only to keep the constraint matrix below readable.
create or replace function public.expect_public_rejected(
        _label text, _name text, _layout int, _angle int, _holds jsonb)
    returns void language plpgsql as $$
begin
    begin
        insert into public.user_problems (id, user_id, name, layout_id, angle, holds, visibility)
            values (gen_random_uuid(), auth.uid(), _name, _layout, _angle, _holds, 'public');
        raise exception 'FAIL: a LIVE PUBLIC row was accepted with %', _label;
    exception when check_violation then
        raise notice 'PASS: public rejected — %', _label;
    end;
end $$;

create or replace function public.expect_private_accepted(
        _label text, _name text, _layout int, _angle int, _holds jsonb)
    returns void language plpgsql as $$
begin
    insert into public.user_problems (id, user_id, name, layout_id, angle, holds, visibility)
        values (gen_random_uuid(), auth.uid(), _name, _layout, _angle, _holds, 'private');
    raise notice 'PASS: private accepted — % (R14)', _label;
end $$;

-- Verdict sink for the second-session probes, plus the two probe bodies they run. Kept as
-- functions so the `\!` shell-outs below stay one short line each (a `\!` command cannot span
-- lines).
create table public.probe_log (id serial primary key, label text not null, verdict boolean);

create or replace function public.probe_key_free(_label text, _user_id uuid)
    returns void language plpgsql as $$
begin
    insert into public.probe_log (label, verdict)
        values (_label, pg_try_advisory_xact_lock(public.user_problem_public_cap_lock_key(_user_id)));
end $$;

-- Attempts a real private→public flip as _uid, with a short lock_timeout. Records TRUE when the
-- flip was blocked waiting on a lock (i.e. another publisher for that user is mid-transaction).
create or replace function public.probe_competing_publish(_label text, _uid uuid, _row uuid)
    returns void language plpgsql as $$
declare _blocked boolean := false;
begin
    begin
        set local lock_timeout = '1s';
        execute 'set local role authenticated';
        perform set_config('test.uid', _uid::text, true);
        update public.user_problems set visibility = 'public' where id = _row;
    exception when lock_not_available then
        _blocked := true;
    end;
    execute 'reset role';
    insert into public.probe_log (label, verdict) values (_label, _blocked);
end $$;

-- Preflight: prove the `\!` second-session channel works at all, so a missing verdict row later
-- reads as "the probe never ran", not as a silent pass.
\! psql -U postgres -d app -c "select public.probe_key_free('preflight', '11111111-1111-1111-1111-111111111111')" </dev/null >/dev/null 2>&1
do $$
begin
    assert (select count(*) from public.probe_log where label = 'preflight') = 1,
        'FAIL: could not reach a second psql session — the concurrency assertions cannot run';
    assert (select verdict from public.probe_log where label = 'preflight'),
        'FAIL: the cap lock key was already held before any publish';
    raise notice 'PASS: second session reachable; the cap lock key starts free';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- U publishes. Attribution is server-derived; the client's values are ignored.
-- ═════════════════════════════════════════════════════════════════════════════
set role authenticated;
select set_config('test.uid', :'U', false);

-- The 0002 owner clamp still stands after 0019 — a forged user_id is still denied.
do $$
begin
    begin
        insert into public.user_problems (id, user_id, name)
            values (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'Planted');
        raise exception 'FAIL: inserted a user_problem owned by another user';
    exception when insufficient_privilege then
        raise notice 'PASS: insert with user_id <> auth.uid() still denied (0002 clamp intact)';
    end;
end $$;

-- Publish, sending FORGED attribution. The trigger must overwrite both columns from the caller's
-- own profile — a client that names someone else as the setter changes nothing.
do $$
declare _r record;
begin
    insert into public.user_problems
            (id, user_id, name, grade, holds, layout_id, angle, visibility,
             setter_user_id, setter_handle)
        values ('b0000000-0000-4000-8000-000000000001', auth.uid(), 'Crimp Ladder', '6B+',
                '[{"c":3,"r":5,"t":"start"},{"c":7,"r":17,"t":"end"}]'::jsonb, 7, 40, 'public',
                '22222222-2222-2222-2222-222222222222', 'reader_two')
        returning * into _r;
    assert _r.setter_user_id = '11111111-1111-1111-1111-111111111111',
        'FAIL: setter_user_id is ' || coalesce(_r.setter_user_id::text, '<null>')
        || ' — the client''s forged value was not overwritten';
    assert _r.setter_handle = 'setter_one',
        'FAIL: setter_handle is ' || coalesce(_r.setter_handle, '<null>')
        || ' — not derived from the caller''s own profile';
    assert _r.source_catalog_id = 'user:b0000000-0000-4000-8000-000000000001',
        'FAIL: the 0018 generated id lane broke under 0019';
    raise notice 'PASS: publish stamps setter_user_id/setter_handle from the caller''s profile, '
                 'overwriting forged client values';
end $$;

-- A second live public row, published now and retracted later (R12).
insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
    values (:'PRET', :'U', 'Retract Me',
            '[{"c":1,"r":2,"t":"start"},{"c":9,"r":16,"t":"end"}]'::jsonb, 7, 40, 'public');

-- Tombstoning a published problem must not require re-deriving attribution: a user who deleted
-- their own profiles row must still be able to take their published work down. So the stamp trigger
-- treats "public but deleted" as not-live and CLEARS the columns rather than refusing.
insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
    values (:'PDEL', :'U', 'Deleted Publication',
            '[{"c":2,"r":3,"t":"start"},{"c":8,"r":15,"t":"end"}]'::jsonb, 7, 40, 'public');
update public.user_problems set deleted = true where id = :'PDEL';
do $$
declare _r record;
begin
    select * into _r from public.user_problems
        where id = 'b0000000-0000-4000-8000-000000000003';
    assert _r.deleted and _r.visibility = 'public',
        'FAIL: the tombstoned publication did not keep visibility=public';
    assert _r.setter_user_id is null and _r.setter_handle is null,
        'FAIL: a tombstoned publication kept its attribution (the columns are not server-owned)';
    raise notice 'PASS: tombstoning a publication is allowed and clears the server-owned attribution';
end $$;

-- ── The publish gate is a server backstop, not just a UI gate (AE3) ──────────
-- Both blocks below record whether the publish was ALLOWED in a flag rather than raising on the
-- happy path: the gate refuses with `raise exception` (P0001), so a `raise exception 'FAIL…'`
-- inside the same block would be swallowed by its own handler and reported as the wrong failure.
select set_config('test.uid', :'UNP', false);
do $$
declare _allowed boolean := false;
begin
    begin
        insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
            values (gen_random_uuid(), auth.uid(), 'No Profile',
                    '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40, 'public');
        _allowed := true;
    exception when raise_exception then
        assert sqlerrm like '%handle%',
            'FAIL: publish without a profile was refused, but not by the handle gate: ' || sqlerrm;
    end;
    assert not _allowed,
        'FAIL: a user with NO profile row published a problem (the AE3 server backstop is missing)';
    raise notice 'PASS: publish refused for a user with no profile row (AE3 server backstop)';
end $$;

select set_config('test.uid', :'UNH', false);
do $$
declare _allowed boolean := false;
begin
    begin
        insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
            values (gen_random_uuid(), auth.uid(), 'Blank Handle',
                    '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40, 'public');
        _allowed := true;
    exception when raise_exception then
        null;
    end;
    assert not _allowed, 'FAIL: a user with a profile but NO handle published a problem';
    raise notice 'PASS: publish refused for a profile with no handle';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The completeness CHECK: constrains LIVE PUBLIC rows, and nothing else (R14).
-- ═════════════════════════════════════════════════════════════════════════════
select set_config('test.uid', :'U', false);

-- The valid boundary first, so the rejections below can't be passing for the wrong reason
-- (e.g. a constraint that rejects everything).
do $$
declare _holds jsonb;
begin
    select jsonb_agg(jsonb_build_object('c', i % 11, 'r', i % 18, 't', 'left'))
        into _holds from generate_series(1, 60) i;
    perform public.expect_private_accepted('60-hold, 60-char boundary (sanity)',
        repeat('n', 60), 7, 40, _holds);
    insert into public.user_problems (id, user_id, name, layout_id, angle, holds, visibility)
        values (gen_random_uuid(), auth.uid(), repeat('n', 60), 7, 40, _holds, 'public');
    raise notice 'PASS: a public row at the exact name/holds boundary (60/60) is accepted';
end $$;

-- The rejection matrix. Each shape is refused on a live public row …
do $$
declare _big jsonb;
begin
    select jsonb_agg(jsonb_build_object('c', 1, 'r', 1, 't', 'left'))
        into _big from generate_series(1, 61) i;

    perform public.expect_public_rejected('empty name',
        '', 7, 40, '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb);
    perform public.expect_public_rejected('61-char name',
        repeat('n', 61), 7, 40, '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb);
    perform public.expect_public_rejected('null layout_id',
        'Nameless Board', null, 40, '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb);
    perform public.expect_public_rejected('null angle',
        'Angleless', 7, null, '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb);
    perform public.expect_public_rejected('empty holds array',
        'No Holds', 7, 40, '[]'::jsonb);
    perform public.expect_public_rejected('61 holds', 'Too Many', 7, 40, _big);
    perform public.expect_public_rejected('holds is not an array (object)',
        'Object Holds', 7, 40, '{"c":1,"r":1,"t":"start"}'::jsonb);
    perform public.expect_public_rejected('holds is the json null scalar',
        'Null Holds', 7, 40, 'null'::jsonb);
    perform public.expect_public_rejected('element is not an object',
        'Scalar Element', 7, 40, '[{"c":1,"r":1,"t":"start"}, 7]'::jsonb);
    perform public.expect_public_rejected('element is the json null scalar',
        'Null Element', 7, 40, '[{"c":1,"r":1,"t":"start"}, null]'::jsonb);
    perform public.expect_public_rejected('element missing t',
        'No Role', 7, 40, '[{"c":1,"r":1}]'::jsonb);
    perform public.expect_public_rejected('element carries an extra key',
        'Extra Key', 7, 40, '[{"c":1,"r":1,"t":"start","x":"payload"}]'::jsonb);
    perform public.expect_public_rejected('element has a bogus role',
        'Bad Role', 7, 40, '[{"c":1,"r":1,"t":"dyno"}]'::jsonb);
    perform public.expect_public_rejected('c is a string, not a number',
        'String Coord', 7, 40, '[{"c":"1","r":1,"t":"start"}]'::jsonb);
    perform public.expect_public_rejected('r is a string, not a number',
        'String Row', 7, 40, '[{"c":1,"r":"1","t":"start"}]'::jsonb);
    perform public.expect_public_rejected('t is a number, not a string',
        'Numeric Role', 7, 40, '[{"c":1,"r":1,"t":3}]'::jsonb);
    perform public.expect_public_rejected('negative coordinate',
        'Negative', 7, 40, '[{"c":-1,"r":1,"t":"start"}]'::jsonb);
    perform public.expect_public_rejected('absurd coordinate',
        'Absurd', 7, 40, '[{"c":1,"r":99999,"t":"start"}]'::jsonb);
end $$;

-- … and accepted on a PRIVATE row. This is R14 in test form: the constraint may not narrow what
-- the iOS client (and the web editor's drafts) may already store privately.
do $$
declare _big jsonb;
begin
    select jsonb_agg(jsonb_build_object('c', 1, 'r', 1, 't', 'left'))
        into _big from generate_series(1, 61) i;

    perform public.expect_private_accepted('empty name, null layout/angle, empty holds (legacy shape)',
        '', null, null, '[]'::jsonb);
    perform public.expect_private_accepted('61-char name', repeat('n', 61), 7, 40, '[]'::jsonb);
    perform public.expect_private_accepted('61 holds', 'Too Many', 7, 40, _big);
    perform public.expect_private_accepted('malformed elements',
        'Junk', 7, 40, '[7, null, {"c":"1","r":1,"t":"dyno","x":1}]'::jsonb);
    perform public.expect_private_accepted('holds is not an array',
        'Object Holds', 7, 40, '{"c":1}'::jsonb);
end $$;

-- Publishing is normally an UPDATE, not an INSERT — the constraint has to hold on that path too.
insert into public.user_problems (id, user_id, name, layout_id, angle, holds)
    values (:'PSTA', :'U', '', null, null, '[]'::jsonb);
do $$
begin
    begin
        update public.user_problems set visibility = 'public'
            where id = 'b0000000-0000-4000-8000-000000000004';
        raise exception 'FAIL: an incomplete private row was published by UPDATE';
    exception when check_violation then
        raise notice 'PASS: private→public UPDATE of an incomplete row rejected';
    end;
end $$;
do $$
declare _r record;
begin
    update public.user_problems
        set name = 'Completed Then Published', layout_id = 7, angle = 40,
            holds = '[{"c":4,"r":4,"t":"start"},{"c":5,"r":14,"t":"end"}]'::jsonb,
            visibility = 'public'
        where id = 'b0000000-0000-4000-8000-000000000004'
        returning * into _r;
    assert _r.setter_handle = 'setter_one' and _r.setter_user_id = '11111111-1111-1111-1111-111111111111',
        'FAIL: the private→public UPDATE path did not stamp attribution';
    raise notice 'PASS: private→public UPDATE of a completed row is accepted and stamped';
end $$;

-- U2 publishes their own problem, so the cross-user reads below have a second setter in play.
select set_config('test.uid', :'U2', false);
insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
    values (:'P2', :'U2', 'Not Yours',
            '[{"c":0,"r":1,"t":"start"},{"c":10,"r":18,"t":"end"}]'::jsonb, 7, 40, 'public');

-- ═════════════════════════════════════════════════════════════════════════════
-- Cross-user reads: live public only, for a second signed-in user and for anon.
-- ═════════════════════════════════════════════════════════════════════════════
-- U now owns 4 live public rows (PUB, PRET, PSTA, the 60/60 boundary row), 1 public tombstone
-- (PDEL) and 6 private rows; U2 owns 1 live public row (P2). So both readers below must see
-- exactly 5 rows — anything more is a policy hole, anything less breaks R11/R16.
do $$
declare _n int;
begin
    select count(*) into _n from public.user_problems;
    assert _n = 5, 'FAIL: the second signed-in user sees ' || _n
        || ' rows, expected 5 (their own public row + the 4 live public rows of the other user)';
    assert (select count(*) from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000001'
              and setter_handle = 'setter_one') = 1,
        'FAIL: a second signed-in user cannot read the public row, or its setter attribution';
    assert (select count(*) from public.user_problems where deleted) = 0,
        'FAIL: a public TOMBSTONE is readable cross-user';
    assert (select count(*) from public.user_problems where visibility = 'private'
              and user_id <> '22222222-2222-2222-2222-222222222222') = 0,
        'FAIL: another user''s PRIVATE row is readable';
    assert (select count(*) from public.user_problems
            where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 0,
        'FAIL: the legacy private row leaked to a second user';
    raise notice 'PASS: a second signed-in user reads exactly the live public rows (plus their own)';
end $$;

-- Reading someone else's row must not become a way to WRITE it. UPDATE/DELETE have owner-only
-- policies; the new SELECT policy must not supply a USING clause for them.
do $$
declare _n int;
begin
    update public.user_problems set name = 'hacked'
        where user_id = '11111111-1111-1111-1111-111111111111';
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: a non-owner updated ' || _n || ' public row(s)';
    delete from public.user_problems
        where user_id = '11111111-1111-1111-1111-111111111111';
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: a non-owner deleted ' || _n || ' public row(s)';
    raise notice 'PASS: a non-owner can read a public row but not update or delete it';
end $$;

-- Anon: signed-out browsing sees the same live public set and can write nothing.
reset role;
set role anon;
do $$
declare _n int;
begin
    select count(*) into _n from public.user_problems;
    assert _n = 5, 'FAIL: anon sees ' || _n || ' rows, expected the 5 live public ones';
    assert (select count(*) from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000001'
              and setter_handle = 'setter_one') = 1,
        'FAIL: anon cannot read the public row with its denormalized setter handle — the whole '
        'reason the handle is denormalized is that profiles is `to authenticated` only';
    raise notice 'PASS: anon reads exactly the live public rows, attribution included';
end $$;

do $$
declare _n int;
begin
    begin
        insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
            values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'Anon Wrote This',
                    '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40, 'public');
        raise exception 'FAIL: anon inserted a user_problem';
    exception when insufficient_privilege then
        raise notice 'PASS: anon insert denied';
    end;
    update public.user_problems set name = 'anon edit';
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: anon updated ' || _n || ' row(s)';
    delete from public.user_problems;
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: anon deleted ' || _n || ' row(s)';
    raise notice 'PASS: anon can read public rows but not write any';
end $$;

-- ── Retraction (R12): flipping back to private removes the row from both readers ──
reset role;
set role authenticated;
select set_config('test.uid', :'U', false);
do $$
declare _r record;
begin
    update public.user_problems set visibility = 'private'
        where id = 'b0000000-0000-4000-8000-000000000002' returning * into _r;
    assert _r.setter_user_id is null and _r.setter_handle is null,
        'FAIL: retracting left the attribution behind — the columns are not server-owned';
    raise notice 'PASS: retracting a publication clears its server-owned attribution';
end $$;

select set_config('test.uid', :'U2', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.user_problems;
    assert _n = 4, 'FAIL: after a retraction the second user sees ' || _n || ' rows, expected 4';
    assert (select count(*) from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000002') = 0,
        'FAIL: a retracted row is still readable cross-user (R12)';
    raise notice 'PASS: a retracted row disappears for a second signed-in user (R12)';
end $$;
reset role;
set role anon;
do $$
begin
    assert (select count(*) from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000002') = 0,
        'FAIL: a retracted row is still readable by anon (R12)';
    raise notice 'PASS: a retracted row disappears for anon (R12)';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Handle renames re-stamp the denormalized copy — and only the right rows.
-- ═════════════════════════════════════════════════════════════════════════════
-- Two decoys the re-stamp must skip, planted as the service role. A client can never create these
-- — the stamp trigger clears attribution on any non-live-public write — which is exactly why the
-- re-stamp's `visibility = 'public' and not deleted` filter needs its own test.
--
-- "Service role" here means BOTH halves: superuser (bypasses RLS) AND no auth.uid(). Clearing
-- test.uid is what supplies the second half — the GUC is session-scoped, so dropping back to
-- superuser without clearing it would leave the stamp trigger still seeing a caller, and it would
-- helpfully wipe the very attribution these rows exist to carry.
reset role;
select set_config('test.uid', '', false);
insert into public.user_problems
        (id, user_id, name, holds, layout_id, angle, visibility, deleted, setter_user_id, setter_handle)
    values ('b0000000-0000-4000-8000-000000000040', :'U', 'Decoy Tombstone',
            '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40,
            'public', true, :'U', 'setter_one'),
           ('b0000000-0000-4000-8000-000000000041', :'U', 'Decoy Private',
            '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40,
            'private', false, :'U', 'setter_one');

-- Capture the live public row's updated_at in its own statement: now() is the transaction
-- timestamp, so a capture inside the same transaction as the rename would compare equal.
create table public.probe_scratch (k text primary key, ts timestamptz not null);
insert into public.probe_scratch (k, ts)
    select 'pub_before_rename', updated_at from public.user_problems where id = :'PUB';

set role authenticated;
select set_config('test.uid', :'U', false);
update public.profiles set handle = 'setter_uno' where id = :'U';

reset role;
do $$
declare _r record;
begin
    select * into _r from public.user_problems where id = 'b0000000-0000-4000-8000-000000000001';
    assert _r.setter_handle = 'setter_uno',
        'FAIL: a handle rename did not re-stamp the setter''s live public row (still '
        || coalesce(_r.setter_handle, '<null>') || ')';
    assert _r.updated_at > (select ts from public.probe_scratch where k = 'pub_before_rename'),
        'FAIL: the re-stamp did not bump updated_at — clients would never pull the new handle';

    assert (select setter_handle from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000040') = 'setter_one',
        'FAIL: the re-stamp touched a public TOMBSTONE (churns rows nobody can read)';
    assert (select setter_handle from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000041') = 'setter_one',
        'FAIL: the re-stamp touched a PRIVATE row';
    assert (select setter_handle from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000005') = 'reader_two',
        'FAIL: the re-stamp touched a DIFFERENT setter''s row';
    raise notice 'PASS: a handle rename re-stamps only the renamer''s live public rows';
end $$;

-- Handle recycling: 'setter_one' is now free, and U2 takes it. U's published work must keep
-- showing U's CURRENT handle — a denormalized copy that went stale here would credit U's problems
-- to a completely different person.
set role authenticated;
select set_config('test.uid', :'U2', false);
update public.profiles set handle = 'setter_one' where id = :'U2';
reset role;
do $$
begin
    assert (select setter_handle from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000001') = 'setter_uno',
        'FAIL: recycling a freed handle misattributed the original setter''s work';
    assert (select setter_user_id from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000001')
           = '11111111-1111-1111-1111-111111111111',
        'FAIL: setter_user_id — the authoritative column — moved';
    assert (select setter_handle from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000005') = 'setter_one',
        'FAIL: the new owner of the recycled handle was not re-stamped onto their own rows';
    raise notice 'PASS: handle recycling cannot misattribute — setter_user_id is authoritative '
                 'and each setter''s rows follow their own profile';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The per-user cap on LIVE PUBLIC problems.
-- ═════════════════════════════════════════════════════════════════════════════
set role authenticated;
select set_config('test.uid', :'UC', false);

insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
    values (:'PC1', :'UC', 'Capper 1',
            '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40, 'public');
do $$
declare i int;
begin
    for i in 2..50 loop
        insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
            values (gen_random_uuid(), auth.uid(), 'Capper ' || i,
                    '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40, 'public');
    end loop;
    assert (select count(*) from public.user_problems
            where user_id = '55555555-5555-5555-5555-555555555555'
              and visibility = 'public' and not deleted) = 50,
        'FAIL: the 50 at-cap publications did not all land';
    raise notice 'PASS: 50 live public problems accepted for one user';
end $$;

-- A private row parked at the boundary, for the flip tests below.
insert into public.user_problems (id, user_id, name, holds, layout_id, angle)
    values (:'PCP', :'UC', 'One Too Many',
            '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40);

-- Same flag idiom as the publish-gate blocks above: the cap also refuses with P0001, so the
-- "wrongly allowed" failure has to be reported outside the handler that catches the refusal.
do $$
declare _allowed boolean := false;
begin
    begin
        insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
            values (gen_random_uuid(), auth.uid(), 'Capper 51',
                    '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40, 'public');
        _allowed := true;
    exception when raise_exception then
        assert sqlerrm like '%50%', 'FAIL: the 51st insert failed, but not on the cap: ' || sqlerrm;
    end;
    assert not _allowed,
        'FAIL: a 51st live public problem was accepted (cap not enforced on INSERT)';
    raise notice 'PASS: the 51st live public problem is refused on INSERT';

    -- The path the 0011 template does NOT cover, and the one publishing actually uses.
    _allowed := false;
    begin
        update public.user_problems set visibility = 'public'
            where id = 'b0000000-0000-4000-8000-000000000021';
        _allowed := true;
    exception when raise_exception then
        assert sqlerrm like '%50%', 'FAIL: the flip failed, but not on the cap: ' || sqlerrm;
    end;
    assert not _allowed, 'FAIL: a private→public UPDATE walked past the cap';
    raise notice 'PASS: the cap fires on the private→public UPDATE, not just on INSERT';
end $$;

-- Re-saving a row that is ALREADY public must not fail at the cap: the count excludes the row's
-- own id, or every edit to a published problem would break once a setter filled their quota.
do $$
begin
    begin
        update public.user_problems set name = 'Capper 1 v2', grade = '7A'
            where id = 'b0000000-0000-4000-8000-000000000020';
    exception when raise_exception then
        raise exception 'FAIL: re-saving an ALREADY-public row was refused at the cap — the count '
                        'does not exclude the row''s own id. Underlying error: %', sqlerrm;
    end;
    assert (select name from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000020') = 'Capper 1 v2',
        'FAIL: the re-save of an already-public row did not land';
    raise notice 'PASS: re-saving an already-public row at the cap succeeds (own id excluded)';
end $$;

-- Tombstones are not live, so taking one down frees a slot.
do $$
begin
    update public.user_problems set deleted = true
        where id = 'b0000000-0000-4000-8000-000000000020';
    update public.user_problems set visibility = 'public'
        where id = 'b0000000-0000-4000-8000-000000000021';
    assert (select visibility from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000021') = 'public',
        'FAIL: deleting a published problem did not free a cap slot';
    raise notice 'PASS: deleted publications do not count against the cap';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Concurrency: two publishers for the same user cannot both pass the cap check.
-- ═════════════════════════════════════════════════════════════════════════════
-- WHAT THIS PROVES: while one transaction is mid-publish, a SECOND session attempting a real
-- private→public flip for the SAME user blocks on a lock (its 1s lock_timeout fires) — so the two
-- cap counts cannot interleave and both read a pre-cap total. A flip by a DIFFERENT user in the
-- same window is unaffected, so the serialization is per-user, not a global publish bottleneck.
-- WHAT IT DOES NOT PROVE: the harness never lets both transactions run to completion, so this is
-- a mutual-exclusion proof, not a "51 rows can never exist" proof.
set role authenticated;
select set_config('test.uid', :'UL', false);
insert into public.user_problems (id, user_id, name, holds, layout_id, angle, visibility)
    values (:'PL1', :'UL', 'Locker A Live',
            '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40, 'public');
insert into public.user_problems (id, user_id, name, holds, layout_id, angle)
    values (:'PL2', :'UL', 'Locker A Pending',
            '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40);
select set_config('test.uid', :'UL2', false);
insert into public.user_problems (id, user_id, name, holds, layout_id, angle)
    values (:'PL3', :'UL2', 'Locker B Pending',
            '[{"c":1,"r":1,"t":"start"},{"c":2,"r":2,"t":"end"}]'::jsonb, 7, 40);
reset role;

begin;
set local role authenticated;
select set_config('test.uid', :'UL', true);
-- A publish-path write by UL, left uncommitted: this transaction now holds UL's cap lock.
update public.user_problems set name = 'Locker A Live v2' where id = :'PL1';
reset role;
\! psql -U postgres -d app -c "select public.probe_key_free('lock_held_same_user', '66666666-6666-6666-6666-666666666666')" </dev/null >/dev/null 2>&1
\! psql -U postgres -d app -c "select public.probe_key_free('lock_free_other_user', '77777777-7777-7777-7777-777777777777')" </dev/null >/dev/null 2>&1
\! psql -U postgres -d app -c "select public.probe_competing_publish('flip_same_user', '66666666-6666-6666-6666-666666666666', 'b0000000-0000-4000-8000-000000000031')" </dev/null >/dev/null 2>&1
\! psql -U postgres -d app -c "select public.probe_competing_publish('flip_other_user', '77777777-7777-7777-7777-777777777777', 'b0000000-0000-4000-8000-000000000032')" </dev/null >/dev/null 2>&1
do $$
declare _v boolean;
begin
    select verdict into _v from public.probe_log where label = 'lock_held_same_user';
    assert _v is not null, 'FAIL: the same-user lock probe never ran';
    assert _v = false, 'FAIL: a second session took the cap lock of a user who is mid-publish';

    select verdict into _v from public.probe_log where label = 'lock_free_other_user';
    assert _v is not null, 'FAIL: the other-user lock probe never ran';
    assert _v = true, 'FAIL: one user''s publish holds a lock that blocks a DIFFERENT user';

    select verdict into _v from public.probe_log where label = 'flip_same_user';
    assert _v is not null, 'FAIL: the same-user competing-publish probe never ran';
    assert _v = true,
        'FAIL: a concurrent private→public flip for the same user did NOT block — two publishers '
        'can read the same pre-cap count and both pass';

    select verdict into _v from public.probe_log where label = 'flip_other_user';
    assert _v is not null, 'FAIL: the other-user competing-publish probe never ran';
    assert _v = false,
        'FAIL: a concurrent publish by a DIFFERENT user blocked — the cap lock is global, not per-user';
    raise notice 'PASS: publishing serializes per user (same-user flip blocks, other-user flip does not)';
end $$;
commit;

-- The lock is transaction-scoped, not leaked past commit.
\! psql -U postgres -d app -c "select public.probe_key_free('lock_after_commit', '66666666-6666-6666-6666-666666666666')" </dev/null >/dev/null 2>&1
do $$
begin
    assert (select verdict from public.probe_log where label = 'lock_after_commit') = true,
        'FAIL: the cap lock outlived its transaction';
    assert (select visibility from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000031') = 'private',
        'FAIL: the blocked flip landed anyway';
    assert (select visibility from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000032') = 'public',
        'FAIL: the unblocked flip by the other user did not land';
    raise notice 'PASS: the cap lock is released at commit; the blocked flip rolled back';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 0018 behaviors still intact under 0019.
-- ═════════════════════════════════════════════════════════════════════════════
set role authenticated;
select set_config('test.uid', :'U', false);
do $$
declare _n int;
begin
    -- The owner still reads their OWN private rows and their own tombstones …
    assert (select count(*) from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000002'
              and visibility = 'private') = 1,
        'FAIL: the owner lost read access to their own retracted (private) row';
    assert (select count(*) from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000003' and deleted) = 1,
        'FAIL: the owner lost read access to their own tombstone (sync needs tombstones)';
    -- … and still sees nothing private of anyone else's.
    select count(*) into _n from public.user_problems
        where user_id <> '11111111-1111-1111-1111-111111111111'
          and (visibility = 'private' or deleted);
    assert _n = 0, 'FAIL: the owner sees ' || _n || ' non-public rows belonging to other users';

    -- The generated id lane still refuses a supplied value and still tracks the PK.
    begin
        insert into public.user_problems (id, user_id, source_catalog_id)
            values (gen_random_uuid(), auth.uid(), 'user:forged');
        raise exception 'FAIL: a writer supplied source_catalog_id (column is no longer GENERATED ALWAYS)';
    exception when generated_always then
        null;
    end;
    assert (select source_catalog_id from public.user_problems
            where id = 'b0000000-0000-4000-8000-000000000001')
           = 'user:b0000000-0000-4000-8000-000000000001',
        'FAIL: source_catalog_id drifted from the PK under 0019';
    raise notice 'PASS: the 0018 owner-read, tombstone and generated-id behaviors survive 0019';
end $$;

reset role;
\echo 'ALL 0019 RLS ASSERTIONS PASSED'
