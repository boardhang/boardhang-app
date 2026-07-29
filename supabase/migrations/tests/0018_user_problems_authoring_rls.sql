-- RLS assertions for 0018_user_problems_authoring.sql. Run after stub_supabase.sql + the 0002
-- migration + seed_legacy_user_problems.sql + the 0018 migration + the "Supabase default grants"
-- step (see run_rls_test.sh: the 0018 case applies the 0002 → legacy-seed → 0018 chain). Every
-- negative test wraps the denied operation in a block and RAISEs if it was wrongly allowed; psql
-- runs with ON_ERROR_STOP so any raise fails the whole run.
--
-- This is the first test coverage public.user_problems has ever had, so it pins BOTH sides:
--   • The pre-existing owner-only RLS quartet from 0002. 0018 changes no policy — the public read
--     path is deliberately deferred to 0019 — so "owner-only" must still hold afterwards, INCLUDING
--     for a row the owner marked visibility='public'. That row is the canary: 0018 accepts the
--     VALUE (the CHECK allows it) while granting it no reader, and this case fails the moment a
--     stray policy makes it visible early.
--   • The new authoring columns: layout_id / angle, the visibility CHECK + private default, and the
--     generated source_catalog_id identity lane ('user:' || id) that every downstream text-id
--     surface will resolve through — including that it BACKFILLED the pre-existing legacy row and
--     is read-only to writers (no write path may round-trip it — KTD2).
--
-- NOTE: psql does not interpolate :'vars' inside dollar-quoted blocks, so the ids below appear as
-- literals inside every do $$ … $$ (same as 0011). The \sets serve the plain-SQL statements, and
-- carry no trailing comment — an apostrophe there would be read as an unterminated quoted string.
--
-- Ids: U / U2 the two signed-in users. P the owner's authored web problem (layout + angle),
-- PD their tombstone, PP their visibility='public' canary, PN their legacy-shaped post-migration
-- write. P2 belongs to U2; LP is the legacy row from seed_legacy_user_problems.sql.
\set ON_ERROR_STOP on
\set U  '11111111-1111-1111-1111-111111111111'
\set U2 '22222222-2222-2222-2222-222222222222'
\set P  '33333333-3333-3333-3333-333333333333'
\set PD '44444444-4444-4444-4444-444444444444'
\set PP '55555555-5555-5555-5555-555555555555'
\set P2 '77777777-7777-7777-7777-777777777777'
\set LP 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

-- Two signed-in users (the legacy row's owner already exists from the seed file).
insert into auth.users (id) values (:'U'), (:'U2');

-- ── R14: the legacy row survived the migration, and got the generated id ──────
-- Superuser (service-role equivalent — bypasses RLS) inspects the row 0018 was applied ON TOP of.
do $$
declare _r record;
begin
    select * into _r from public.user_problems
        where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    assert _r.id is not null,    'FAIL: the legacy row did not survive 0018';
    assert _r.name = '',         'FAIL: legacy empty name was rewritten';
    assert _r.layout_id is null, 'FAIL: legacy row got a layout_id';
    assert _r.angle is null,     'FAIL: legacy row got an angle';
    assert _r.visibility = 'private',
        'FAIL: legacy row is ' || _r.visibility || ', not private (retroactive flip — R14)';
    assert _r.source_catalog_id = 'user:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'FAIL: generated source_catalog_id did not backfill the legacy row (got '
        || coalesce(_r.source_catalog_id, '<null>') || ')';
    raise notice 'PASS: legacy iOS row survives 0018 untouched, private, with a backfilled source_catalog_id';
end $$;

-- ── The identity lane: unique, and read-only to every writer ─────────────────
do $$
declare _n int;
begin
    select count(*) into _n
    from pg_index i
    join pg_class     c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public' and c.relname = 'user_problems'
      and a.attname = 'source_catalog_id'
      and i.indisunique and i.indnatts = 1;
    assert _n = 1, 'FAIL: no single-column UNIQUE index on user_problems.source_catalog_id';
    raise notice 'PASS: source_catalog_id carries a unique index';
end $$;

-- Generated ALWAYS: even the service role cannot supply the value, so no client or server write
-- path can round-trip it into drift (KTD2).
do $$
begin
    begin
        insert into public.user_problems (id, user_id, source_catalog_id)
            values ('88888888-8888-8888-8888-888888888888',
                    '11111111-1111-1111-1111-111111111111', 'user:forged');
        raise exception 'FAIL: a writer supplied source_catalog_id (column is not GENERATED ALWAYS)';
    exception when generated_always then
        raise notice 'PASS: source_catalog_id rejects a supplied value (generated always)';
    end;
end $$;

-- ── Every denial below must be RLS, not a missing GRANT ──────────────────────
-- run_rls_test.sh hands anon/authenticated the same table privileges real Supabase does. Assert
-- that here, or an anon "sees zero rows" / "insert denied" result would be indistinguishable from
-- the harness simply forgetting the grant — and the owner-only policies would go untested.
do $$
declare _role text; _priv text;
begin
    foreach _role in array array['anon', 'authenticated'] loop
        foreach _priv in array array['select', 'insert', 'update', 'delete'] loop
            assert has_table_privilege(_role, 'public.user_problems', _priv),
                'FAIL: ' || _role || ' lacks ' || _priv || ' on user_problems — the denials below '
                          || 'would prove a missing grant, not the owner-only policy';
        end loop;
    end loop;
    raise notice 'PASS: anon and authenticated hold Supabase-default grants (denials below are RLS)';
end $$;

-- Seed the other user's row + the owner's tombstone as superuser, so the cross-user reads below
-- have something they must NOT see and the owner has a deleted row they MUST see.
insert into public.user_problems (id, user_id, name, deleted)
    values (:'PD', :'U', 'Deleted draft', true);
insert into public.user_problems (id, user_id, name, layout_id, angle)
    values (:'P2', :'U2', 'Not yours', 7, 40);

-- ── Owner writes through RLS ──────────────────────────────────────────────────
set role authenticated;
select set_config('test.uid', :'U', false);

-- Insert clamped to the caller: a forged user_id is denied by the 0002 WITH CHECK.
do $$
begin
    begin
        insert into public.user_problems (id, user_id, name)
            values ('99999999-0000-4000-8000-000000000001',
                    '22222222-2222-2222-2222-222222222222', 'Planted');
        raise exception 'FAIL: inserted a user_problem owned by another user';
    exception when insufficient_privilege then
        raise notice 'PASS: insert with user_id <> auth.uid() denied';
    end;
end $$;

-- The authoring insert the web editor will make: board-scoped (layout + angle), name + holds,
-- visibility left to the server default.
do $$
declare _r record;
begin
    insert into public.user_problems (id, user_id, name, grade, holds, layout_id, angle)
        values ('33333333-3333-3333-3333-333333333333', auth.uid(), 'Crimp Ladder', '6B+',
                '[{"c":3,"r":5,"t":"start"},{"c":7,"r":17,"t":"end"}]'::jsonb, 7, 40)
        returning * into _r;
    assert _r.layout_id = 7 and _r.angle = 40, 'FAIL: layout_id/angle did not land';
    assert _r.visibility = 'private',
        'FAIL: visibility defaulted to ' || _r.visibility || ', not private (R10/R14)';
    assert _r.source_catalog_id = 'user:33333333-3333-3333-3333-333333333333',
        'FAIL: source_catalog_id is ' || coalesce(_r.source_catalog_id, '<null>')
        || ', expected user:<id>';
    raise notice 'PASS: owner insert lands layout/angle, defaults to private, and generates user:<id>';
end $$;

-- A legacy-shaped write (empty name, no layout/angle) is still accepted AFTER the migration —
-- 0018 adds no name/holds constraint, so the iOS client's existing writes keep working (R14).
do $$
begin
    insert into public.user_problems (id, user_id)
        values ('66666666-6666-6666-6666-666666666666', auth.uid());
    raise notice 'PASS: a legacy-shaped insert (empty name, null layout/angle) violates no constraint';
end $$;

-- visibility is a closed set.
do $$
begin
    begin
        insert into public.user_problems (id, user_id, visibility)
            values ('99999999-0000-4000-8000-000000000002', auth.uid(), 'unlisted');
        raise exception 'FAIL: visibility accepted a value outside (private, public)';
    exception when check_violation then
        raise notice 'PASS: visibility CHECK rejects a value outside (private, public)';
    end;
end $$;

-- 0018 accepts visibility='public' as a VALUE but ships no public reader — the canary for the
-- cross-user reads below.
insert into public.user_problems (id, user_id, name, layout_id, angle, visibility)
    values (:'PP', :'U', 'Published early', 7, 40, 'public');

-- The generated id does not drift when the row is edited.
do $$
declare _sc text;
begin
    update public.user_problems set name = 'Crimp Ladder v2'
        where id = '33333333-3333-3333-3333-333333333333';
    select source_catalog_id into _sc from public.user_problems
        where id = '33333333-3333-3333-3333-333333333333';
    assert _sc = 'user:33333333-3333-3333-3333-333333333333',
        'FAIL: source_catalog_id drifted on update (now ' || coalesce(_sc, '<null>') || ')';
    raise notice 'PASS: source_catalog_id is stable across an edit';
end $$;

-- ── Owner reads: own rows only, tombstones included ──────────────────────────
do $$
declare _n int;
begin
    select count(*) into _n from public.user_problems;
    assert _n = 4, 'FAIL: owner sees ' || _n || ' rows, expected their own 4';
    assert (select count(*) from public.user_problems
            where id = '44444444-4444-4444-4444-444444444444' and deleted) = 1,
        'FAIL: owner cannot read their own soft-deleted row (sync needs tombstones)';
    assert (select count(*) from public.user_problems
            where id in ('77777777-7777-7777-7777-777777777777',
                         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')) = 0,
        'FAIL: another user''s rows leaked into an owner read';
    raise notice 'PASS: owner reads own rows incl. tombstones, and nobody else''s';
end $$;

-- ── A second signed-in user sees nothing of the first — including the public row ──
select set_config('test.uid', :'U2', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.user_problems;
    assert _n = 1, 'FAIL: second user sees ' || _n || ' rows, expected only their own 1';
    assert (select count(*) from public.user_problems
            where id = '55555555-5555-5555-5555-555555555555') = 0,
        'FAIL: a visibility=public row is readable cross-user — 0018 must ship NO public read policy (that is 0019)';

    update public.user_problems set name = 'hacked'
        where user_id = '11111111-1111-1111-1111-111111111111';
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: second user updated ' || _n || ' of the owner''s row(s)';
    delete from public.user_problems
        where user_id = '11111111-1111-1111-1111-111111111111';
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: second user deleted ' || _n || ' of the owner''s row(s)';
    raise notice 'PASS: second user reads/updates/deletes none of the owner''s rows (public row included)';
end $$;

-- ── Anonymous: no policy at all on user_problems (all four are `to authenticated`) ──
reset role;
set role anon;
do $$
declare _n int;
begin
    select count(*) into _n from public.user_problems;
    assert _n = 0, 'FAIL: anon sees ' || _n || ' user_problems rows';
    raise notice 'PASS: anon reads zero user_problems rows (public row included)';
end $$;

do $$
begin
    begin
        insert into public.user_problems (id, user_id)
            values ('99999999-0000-4000-8000-000000000003',
                    '11111111-1111-1111-1111-111111111111');
        raise exception 'FAIL: anon inserted a user_problem';
    exception when insufficient_privilege then
        raise notice 'PASS: anon insert denied';
    end;
end $$;

reset role;
\echo 'ALL 0018 RLS ASSERTIONS PASSED'
