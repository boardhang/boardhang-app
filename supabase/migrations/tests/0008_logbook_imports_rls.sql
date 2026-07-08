-- RLS assertions for 0008_logbook_imports.sql. Run after stub_supabase.sql + the
-- migration + the "Supabase default grants" step (see run_rls_test.sh). Every negative
-- test wraps the denied operation in a savepoint-guarded block and RAISES if it was
-- wrongly allowed; psql runs with ON_ERROR_STOP so any raise fails the whole run.
\set ON_ERROR_STOP on
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'

-- Seed two users (as superuser).
insert into auth.users (id) values (:'A'), (:'B');

-- Helper: become an authenticated user with a given uid.
-- (set role + a session GUC that auth.uid() reads.)

-- ── User A, acting as themselves ─────────────────────────────────────────────
set role authenticated;
select set_config('test.uid', :'A', false);

-- A inserts their OWN metadata row → allowed.
insert into public.logbook_imports (user_id, storage_path)
values (:'A', :'A' || '/aaa-file.csv');

-- A inserts their OWN storage object → allowed.
insert into storage.objects (bucket_id, name, owner)
values ('logbook-imports', :'A' || '/aaa-file.csv', :'A');

do $$
begin
    -- A reads back exactly their own rows (RLS scopes select).
    assert (select count(*) from public.logbook_imports) = 1, 'A should see exactly its 1 row';
    assert (select count(*) from public.logbook_imports where user_id = auth.uid()) = 1, 'own row visible';
    assert (select count(*) from storage.objects where bucket_id = 'logbook-imports') = 1, 'A sees its 1 object';
    raise notice 'PASS: owner read/write happy path';
end $$;

-- Cross-user INSERT into the metadata table → denied by WITH CHECK.
do $$
begin
    begin
        insert into public.logbook_imports (user_id, storage_path) values ('22222222-2222-2222-2222-222222222222', 'x');
        raise exception 'FAIL: A inserted a row owned by B';
    exception when insufficient_privilege then
        raise notice 'PASS: cross-user metadata insert denied';
    end;
end $$;

-- Folder-spoofing: A uploads into B''s folder → denied by storage WITH CHECK (the key control).
do $$
begin
    begin
        insert into storage.objects (bucket_id, name, owner)
        values ('logbook-imports', '22222222-2222-2222-2222-222222222222/evil.csv', auth.uid());
        raise exception 'FAIL: A wrote into B''s storage folder';
    exception when insufficient_privilege then
        raise notice 'PASS: storage folder-spoofing denied';
    end;
end $$;

-- A folderless object name (no `{uid}/` prefix) is rejected: storage.foldername returns an
-- empty array, so foldername[1] is NULL and can match no user (RLS folder-guard fails).
-- Also exercises the trigger's NULL-uid branch (coalesce(_uid,'') → no crash) — the RLS
-- check is what denies. (A here has 1 object, so the cap trigger passes and RLS is the gate.)
do $$
begin
    begin
        insert into storage.objects (bucket_id, name, owner)
        values ('logbook-imports', 'nofolder.csv', auth.uid());
        raise exception 'FAIL: folderless object name allowed';
    exception when insufficient_privilege then
        raise notice 'PASS: folderless object name denied (NULL folder)';
    end;
end $$;

-- Coverage note: this single-threaded harness verifies the trigger's count-and-raise and
-- its per-user WHERE scoping, but does NOT exercise the pg_advisory_xact_lock under
-- contention (TOCTOU only manifests across concurrent transactions, which psql can't drive
-- here). If a refactor drops the advisory lock, these assertions stay green — treat the
-- lock as load-bearing and re-verify concurrency behavior against real Supabase.

-- ── Seed B''s data (as superuser) to test cross-user READ ─────────────────────
reset role;
insert into public.logbook_imports (user_id, storage_path) values (:'B', :'B' || '/bbb.csv');
insert into storage.objects (bucket_id, name, owner) values ('logbook-imports', :'B' || '/bbb.csv', :'B');

-- ── User A cannot see B''s rows/objects ──────────────────────────────────────
set role authenticated;
select set_config('test.uid', :'A', false);
do $$
begin
    assert (select count(*) from public.logbook_imports where user_id = '22222222-2222-2222-2222-222222222222') = 0,
        'FAIL: A can read B metadata rows';
    assert (select count(*) from storage.objects where name like '22222222-2222-2222-2222-222222222222/%') = 0,
        'FAIL: A can read B storage objects';
    raise notice 'PASS: cross-user read denied (RLS filters to zero)';
end $$;

-- Cross-user DELETE affects zero of B''s rows.
do $$
declare _n int;
begin
    delete from public.logbook_imports where user_id = '22222222-2222-2222-2222-222222222222';
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: A deleted B rows';
    raise notice 'PASS: cross-user delete affects zero rows';
end $$;

-- ── Per-user object cap: the 2-file limit is enforced by the BEFORE INSERT trigger ──
-- Act as a fresh user C so A''s single object doesn''t skew the count. The trigger raises
-- check_violation (not the RLS insufficient_privilege) when the cap is hit.
reset role;
insert into auth.users (id) values ('33333333-3333-3333-3333-333333333333');
set role authenticated;
select set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
do $$
declare i int;
begin
    -- Fill to the cap (2 objects), then the 3rd must be rejected by the trigger.
    for i in 1..2 loop
        insert into storage.objects (bucket_id, name, owner)
        values ('logbook-imports', '33333333-3333-3333-3333-333333333333/f' || i || '.csv',
                '33333333-3333-3333-3333-333333333333');
    end loop;
    begin
        insert into storage.objects (bucket_id, name, owner)
        values ('logbook-imports', '33333333-3333-3333-3333-333333333333/overflow.csv',
                '33333333-3333-3333-3333-333333333333');
        raise exception 'FAIL: 3rd object allowed past the per-user cap';
    exception when check_violation then
        raise notice 'PASS: per-user object cap (2) enforced by trigger';
    end;
end $$;

-- The cap is per-user: a different user (A) is unaffected by C filling their own folder.
reset role;
set role authenticated;
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
do $$
begin
    -- A already has 1 object; a 2nd is still allowed (their own count, not C''s).
    insert into storage.objects (bucket_id, name, owner)
    values ('logbook-imports', '11111111-1111-1111-1111-111111111111/second.csv',
            '11111111-1111-1111-1111-111111111111');
    raise notice 'PASS: cap is per-user (A unaffected by C)';
end $$;

-- ── Anonymous role is default-denied (has grants, but no policy) ──────────────
reset role;
set role anon;
do $$
begin
    assert (select count(*) from public.logbook_imports) = 0, 'FAIL: anon can read logbook_imports';
    assert (select count(*) from storage.objects) = 0, 'FAIL: anon can read storage.objects';
    raise notice 'PASS: anon sees nothing (default-deny)';
end $$;

-- ── delete_user() sweeps the caller''s storage objects + cascades metadata ────
reset role;
set role authenticated;
select set_config('test.uid', :'B', false);
select public.delete_user();

reset role;  -- back to superuser to inspect ground truth
do $$
begin
    assert (select count(*) from auth.users where id = '22222222-2222-2222-2222-222222222222') = 0,
        'FAIL: B account not deleted';
    assert (select count(*) from public.logbook_imports where user_id = '22222222-2222-2222-2222-222222222222') = 0,
        'FAIL: B metadata rows orphaned (FK cascade broken)';
    assert (select count(*) from storage.objects where name like '22222222-2222-2222-2222-222222222222/%') = 0,
        'FAIL: B storage objects orphaned (delete_user did not sweep the bucket)';
    -- A''s data is untouched (A has 2 objects: the happy-path file + the per-user-cap file).
    assert (select count(*) from storage.objects where name like '11111111-1111-1111-1111-111111111111/%') = 2,
        'FAIL: A objects wrongly swept';
    raise notice 'PASS: delete_user swept B storage + cascaded metadata; A untouched';
end $$;

\echo 'ALL RLS ASSERTIONS PASSED'
