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
    -- A''s data is untouched.
    assert (select count(*) from storage.objects where name like '11111111-1111-1111-1111-111111111111/%') = 1,
        'FAIL: A objects wrongly swept';
    raise notice 'PASS: delete_user swept B storage + cascaded metadata; A untouched';
end $$;

\echo 'ALL RLS ASSERTIONS PASSED'
