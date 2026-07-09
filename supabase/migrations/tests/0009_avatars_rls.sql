-- RLS assertions for 0009_avatars.sql. Run after stub_supabase.sql + the 0008 → 0009
-- migration chain + the "Supabase default grants" step (see run_rls_test.sh). Every
-- negative test wraps the denied operation in a block and RAISES if it was wrongly
-- allowed; psql runs with ON_ERROR_STOP so any raise fails the whole run.
\set ON_ERROR_STOP on
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
-- A valid in-bucket object path: {uid}/{uuid}.webp (both segments 36 UUID-shaped chars).
\set A_OBJ '11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'
\set B_OBJ '22222222-2222-2222-2222-222222222222/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'

-- Seed two users (as superuser).
insert into auth.users (id) values (:'A'), (:'B');

-- ── User A, acting as themselves ─────────────────────────────────────────────
set role authenticated;
select set_config('test.uid', :'A', false);

-- A uploads their OWN avatar object → allowed.
insert into storage.objects (bucket_id, name, owner)
values ('avatars', :'A_OBJ', :'A');

-- A creates their OWN profile row with a valid in-bucket avatar path → allowed (RLS
-- self-insert + the avatar_url CHECK both pass).
insert into public.profiles (id, display_name, avatar_url)
values (:'A', 'Ada', :'A_OBJ');

do $$
begin
    assert (select count(*) from storage.objects where bucket_id = 'avatars') = 1, 'A sees its 1 avatar object';
    assert (select avatar_url from public.profiles where id = auth.uid()) is not null, 'A avatar_url stored';
    raise notice 'PASS: owner upload + profile write happy path';
end $$;

-- avatar_url CHECK: an external/off-domain URL is rejected (tracking-pixel guard).
do $$
begin
    begin
        update public.profiles set avatar_url = 'https://evil.example/pixel.webp' where id = auth.uid();
        raise exception 'FAIL: external avatar_url accepted';
    exception when check_violation then
        raise notice 'PASS: external avatar_url rejected by CHECK';
    end;
end $$;

-- avatar_url CHECK: a bare filename (no {uid}/ folder) is rejected.
do $$
begin
    begin
        update public.profiles set avatar_url = 'not-a-path.webp' where id = auth.uid();
        raise exception 'FAIL: folderless avatar_url accepted';
    exception when check_violation then
        raise notice 'PASS: folderless avatar_url rejected by CHECK';
    end;
end $$;

-- avatar_url CHECK: NULL (remove photo) is always allowed.
-- (Inside a DO block psql does NOT interpolate :'…' vars — use the literal path.)
do $$
begin
    update public.profiles set avatar_url = null where id = auth.uid();
    update public.profiles
        set avatar_url = '11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'
        where id = auth.uid();  -- restore for later
    raise notice 'PASS: null avatar_url allowed';
end $$;

-- avatar_url CHECK binds the folder to the row owner: A cannot claim B's object path
-- (display-level impersonation guard).
do $$
begin
    begin
        update public.profiles
            set avatar_url = '22222222-2222-2222-2222-222222222222/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'
            where id = auth.uid();
        raise exception 'FAIL: A set avatar_url to B''s object path';
    exception when check_violation then
        raise notice 'PASS: avatar_url folder bound to owner id (no impersonation)';
    end;
end $$;

-- Folder-spoofing: A uploads into B's folder → denied by storage WITH CHECK (key control).
do $$
begin
    begin
        insert into storage.objects (bucket_id, name, owner)
        values ('avatars', '22222222-2222-2222-2222-222222222222/evil.webp', auth.uid());
        raise exception 'FAIL: A wrote into B''s avatar folder';
    exception when insufficient_privilege then
        raise notice 'PASS: avatar folder-spoofing denied';
    end;
end $$;

-- Folderless object name → storage.foldername returns empty, foldername[1] is NULL, matches
-- no user, RLS folder-guard denies.
do $$
begin
    begin
        insert into storage.objects (bucket_id, name, owner)
        values ('avatars', 'nofolder.webp', auth.uid());
        raise exception 'FAIL: folderless avatar object allowed';
    exception when insufficient_privilege then
        raise notice 'PASS: folderless avatar object denied (NULL folder)';
    end;
end $$;

-- ── Seed B's avatar (as superuser) to test cross-user isolation ───────────────
reset role;
insert into storage.objects (bucket_id, name, owner) values ('avatars', :'B_OBJ', :'B');

-- ── User A cannot read/enumerate B's avatar objects (owner-scoped SELECT) ─────
set role authenticated;
select set_config('test.uid', :'A', false);
do $$
begin
    assert (select count(*) from storage.objects
            where bucket_id = 'avatars'
              and name like '22222222-2222-2222-2222-222222222222/%') = 0,
        'FAIL: A can enumerate B avatar objects';
    assert (select count(*) from storage.objects where bucket_id = 'avatars') = 1,
        'FAIL: A sees more than its own avatar object';
    raise notice 'PASS: cross-user avatar read denied (owner-scoped SELECT)';
end $$;

-- Cross-user DELETE affects zero of B's avatar objects.
do $$
declare _n int;
begin
    delete from storage.objects where bucket_id = 'avatars'
        and name like '22222222-2222-2222-2222-222222222222/%';
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: A deleted B avatar objects';
    raise notice 'PASS: cross-user avatar delete affects zero rows';
end $$;

-- ── Anonymous role cannot enumerate the avatars bucket (no anon policy → default-deny) ──
-- The bucket is PUBLIC (object serving via /object/public bypasses RLS), but LISTING via
-- storage.objects must stay closed to anon so uids/photos can't be harvested wholesale.
reset role;
set role anon;
do $$
begin
    assert (select count(*) from storage.objects where bucket_id = 'avatars') = 0,
        'FAIL: anon can enumerate avatars bucket';
    raise notice 'PASS: anon cannot enumerate avatars (default-deny)';
end $$;

-- ── Per-user avatar object cap (max 2) — the BEFORE INSERT trigger ────────────
-- Cap is 2 (headroom for old+new during a replace); the 3rd insert is rejected. Use a
-- fresh user C so A/B object counts don't interfere.
reset role;
insert into auth.users (id) values ('33333333-3333-3333-3333-333333333333');
set role authenticated;
select set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
do $$
declare i int;
begin
    for i in 1..2 loop
        insert into storage.objects (bucket_id, name, owner)
        values ('avatars', '33333333-3333-3333-3333-333333333333/f' || i || '.webp',
                '33333333-3333-3333-3333-333333333333');
    end loop;
    begin
        insert into storage.objects (bucket_id, name, owner)
        values ('avatars', '33333333-3333-3333-3333-333333333333/overflow.webp',
                '33333333-3333-3333-3333-333333333333');
        raise exception 'FAIL: 3rd avatar object allowed past the per-user cap';
    exception when check_violation then
        raise notice 'PASS: per-user avatar object cap (2) enforced by trigger';
    end;
end $$;

-- ── delete_user() sweeps the caller's avatar objects (GDPR erasure) ──────────
-- B has one avatar object + (seed) profile row. After B deletes their account, no
-- avatars/B/* objects remain and the account is gone; A is untouched.
reset role;
insert into public.profiles (id, display_name, avatar_url) values (:'B', 'Bea', :'B_OBJ');

set role authenticated;
select set_config('test.uid', :'B', false);
select public.delete_user();

reset role;  -- back to superuser to inspect ground truth
do $$
begin
    assert (select count(*) from auth.users where id = '22222222-2222-2222-2222-222222222222') = 0,
        'FAIL: B account not deleted';
    assert (select count(*) from storage.objects
            where bucket_id = 'avatars' and name like '22222222-2222-2222-2222-222222222222/%') = 0,
        'FAIL: B avatar objects orphaned (delete_user did not sweep avatars)';
    assert (select count(*) from public.profiles where id = '22222222-2222-2222-2222-222222222222') = 0,
        'FAIL: B profile row orphaned (FK cascade broken)';
    assert (select count(*) from storage.objects
            where bucket_id = 'avatars' and name like '11111111-1111-1111-1111-111111111111/%') = 1,
        'FAIL: A avatar object wrongly swept';
    raise notice 'PASS: delete_user swept B avatars + cascaded profile; A untouched';
end $$;

\echo 'ALL 0009 RLS ASSERTIONS PASSED'
