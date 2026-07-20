-- Assertions for 0017_social_graph.sql. Run after stub_supabase.sql + the 0002 → 0017 chain
-- + the "Supabase default grants" step. Verifies:
--   • the first_sent_at trigger: stamps on sent, never moves once set, ignores client values;
--   • follows/blocks/notifications RLS: self-scoped reads, no direct edge/block/notif INSERT;
--   • the self-follow / duplicate-edge constraints; is_blocked() is bidirectional.
-- Trigger cases run as the default (superuser) role — triggers fire regardless of role, and
-- seeding cross-user fixtures needs to bypass RLS. RLS cases role-switch to `authenticated`
-- and set test.uid per the stub's auth.uid().
\set ON_ERROR_STOP on

\set A   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set B   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set C   'cccccccc-cccc-cccc-cccc-cccccccccccc'
\set OUT 'dddddddd-dddd-dddd-dddd-dddddddddddd'

insert into auth.users (id) values (:'A'), (:'B'), (:'C'), (:'OUT');
insert into public.profiles (id, display_name, is_private) values
    (:'A', 'Ana',  false),
    (:'B', 'Bo',   false),
    (:'C', 'Cy',   true),   -- a private account
    (:'OUT', 'Dev', false);

-- ── first_sent_at trigger ─────────────────────────────────────────────────────
-- The ascent id is a plain uuid PK (no default in 0002); supply it. Only sent + date matter.
\set S1 '11111111-1111-1111-1111-111111111111'
\set S2 '22222222-2222-2222-2222-222222222222'
\set S3 '33333333-3333-3333-3333-333333333333'

-- Insert a SENT row → first_sent_at stamped ~now.
insert into public.ascents (id, user_id, date, sent) values (:'S1', :'A', now(), true);
-- Insert an UNSENT row → first_sent_at null.
insert into public.ascents (id, user_id, date, sent) values (:'S2', :'A', now(), false);
-- Insert a SENT row with a spoofed client first_sent_at → server ignores it.
insert into public.ascents (id, user_id, date, sent, first_sent_at)
    values (:'S3', :'A', now(), true, timestamptz '2000-01-01');

do $$
declare _fs1 timestamptz; _fs2 timestamptz; _fs3 timestamptz; _saved timestamptz;
begin
    select first_sent_at into _fs1 from public.ascents where id = '11111111-1111-1111-1111-111111111111';
    assert _fs1 is not null, 'FAIL: sent insert left first_sent_at null';
    assert _fs1 > now() - interval '1 minute', 'FAIL: sent insert stamp is not ~now';

    select first_sent_at into _fs2 from public.ascents where id = '22222222-2222-2222-2222-222222222222';
    assert _fs2 is null, 'FAIL: unsent insert stamped first_sent_at';

    select first_sent_at into _fs3 from public.ascents where id = '33333333-3333-3333-3333-333333333333';
    assert _fs3 > now() - interval '1 minute', 'FAIL: client-supplied first_sent_at was not overridden (got ' || _fs3 || ')';
    raise notice 'PASS: first_sent_at stamps on sent, stays null while unsent, ignores client value';

    -- false → true transition stamps arrival.
    update public.ascents set sent = true where id = '22222222-2222-2222-2222-222222222222';
    select first_sent_at into _fs2 from public.ascents where id = '22222222-2222-2222-2222-222222222222';
    assert _fs2 is not null and _fs2 > now() - interval '1 minute',
        'FAIL: false→true transition did not stamp first_sent_at';
    raise notice 'PASS: false→true transition stamps first_sent_at';

    -- An edit (re-grade) must NOT move first_sent_at.
    select first_sent_at into _saved from public.ascents where id = '11111111-1111-1111-1111-111111111111';
    perform pg_sleep(0.01);
    update public.ascents set problem_grade = 'V8' where id = '11111111-1111-1111-1111-111111111111';
    select first_sent_at into _fs1 from public.ascents where id = '11111111-1111-1111-1111-111111111111';
    assert _fs1 = _saved, 'FAIL: an edit moved first_sent_at (was ' || _saved || ', now ' || _fs1 || ')';

    -- Un-sending must NOT clear/move it ("never moves once set").
    update public.ascents set sent = false where id = '11111111-1111-1111-1111-111111111111';
    select first_sent_at into _fs1 from public.ascents where id = '11111111-1111-1111-1111-111111111111';
    assert _fs1 = _saved, 'FAIL: un-sending changed first_sent_at';
    raise notice 'PASS: first_sent_at never moves once set (edit + un-send leave it)';
end $$;

-- ── gaming path: an unsent row with a spoofed FUTURE first_sent_at, then flipped sent ──
-- The earlier `if NEW.sent`-only trigger would have let the future stamp survive the flip
-- (coalesce(OLD=future, now()) = future), pinning the send atop every follower's feed.
-- Distinct source_catalog_id so this unsent row does not collide with S1 (un-sent above) on
-- the 0002 (user, source, day) unsent-attempt partial-unique index.
\set G '44444444-4444-4444-4444-444444444444'
insert into public.ascents (id, user_id, date, sent, source_catalog_id, first_sent_at)
    values (:'G', :'A', now(), false, 'game-test', timestamptz '2099-01-01');
do $$
declare _fs timestamptz;
begin
    -- While unsent, the client value must be discarded (NULL), not retained.
    select first_sent_at into _fs from public.ascents where id = '44444444-4444-4444-4444-444444444444';
    assert _fs is null, 'FAIL: unsent row retained a client-supplied first_sent_at (got ' || _fs || ')';

    update public.ascents set sent = true where id = '44444444-4444-4444-4444-444444444444';
    select first_sent_at into _fs from public.ascents where id = '44444444-4444-4444-4444-444444444444';
    assert _fs < now() + interval '1 day',
        'FAIL: spoofed future first_sent_at survived the sent-flip (got ' || _fs || ') — feed-pinning hole';
    assert _fs > now() - interval '1 minute', 'FAIL: sent-flip did not stamp ~now';
    raise notice 'PASS: a spoofed future first_sent_at cannot survive an unsent→sent flip';
end $$;

-- ── follows constraints (self-follow, duplicate edge) ─────────────────────────
do $$
begin
    begin
        insert into public.follows (follower_id, followee_id) values
            ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        assert false, 'FAIL: self-follow was allowed';
    exception when check_violation then
        raise notice 'PASS: self-follow rejected by CHECK';
    end;

    insert into public.follows (follower_id, followee_id) values
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    begin
        insert into public.follows (follower_id, followee_id) values
            ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
        assert false, 'FAIL: duplicate edge was allowed';
    exception when unique_violation then
        raise notice 'PASS: duplicate edge rejected by PK';
    end;

    begin
        insert into public.follows (follower_id, followee_id, status) values
            ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'bogus');
        assert false, 'FAIL: bogus status was allowed';
    exception when check_violation then
        raise notice 'PASS: invalid status rejected by CHECK';
    end;
end $$;

-- Seed a pending request C←B and a block (A blocks OUT) as superuser for the RLS reads below.
insert into public.follows (follower_id, followee_id, status) values (:'B', :'C', 'pending');
insert into public.blocks (blocker_id, blocked_id) values (:'A', :'OUT');
insert into public.notifications (user_id, type, actor_id) values (:'C', 'follow', :'B');

-- ── is_blocked() is bidirectional ─────────────────────────────────────────────
do $$
begin
    assert public.is_blocked('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
        'FAIL: is_blocked(blocker, blocked) false';
    assert public.is_blocked('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
        'FAIL: is_blocked(blocked, blocker) false — not bidirectional';
    assert not public.is_blocked('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
        'FAIL: is_blocked true for an unblocked pair';
    raise notice 'PASS: is_blocked is bidirectional';
end $$;

-- ── follows RLS: self-scoped read, no direct INSERT ───────────────────────────
set role authenticated;

-- As B (the follower on A→B and the requester B→C): sees both edges it is party to.
select set_config('test.uid', :'B', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.follows;
    assert _n = 2, 'FAIL: B should see exactly its 2 edges (A→B, B→C), saw ' || _n;
    raise notice 'PASS: a user reads only edges it is party to';
end $$;

-- As OUT (party to no follow edge): sees none.
select set_config('test.uid', :'OUT', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.follows;
    assert _n = 0, 'FAIL: an unrelated user saw ' || _n || ' follow edges (expected 0)';
    raise notice 'PASS: a non-party user sees no edges';
end $$;

-- Direct INSERT into follows is denied (no INSERT policy → request_follow only).
select set_config('test.uid', :'A', false);
do $$
begin
    begin
        insert into public.follows (follower_id, followee_id) values
            ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
        assert false, 'FAIL: direct client INSERT into follows was allowed';
    exception when insufficient_privilege then
        raise notice 'PASS: direct INSERT into follows denied (RLS, no policy)';
    end;
end $$;

-- A can DELETE its own outgoing edge (unfollow); the followee could delete it too (remove).
do $$
declare _n int;
begin
    delete from public.follows where follower_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        and followee_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    get diagnostics _n = row_count;
    assert _n = 1, 'FAIL: follower could not delete its own edge (unfollow)';
    raise notice 'PASS: a user can unfollow (delete its own edge)';
end $$;

-- ── blocks RLS: read/delete own only, no direct INSERT ────────────────────────
-- A sees its own block; OUT (the blocked party) does not see the block row.
do $$
declare _n int;
begin
    select count(*) into _n from public.blocks;  -- as A
    assert _n = 1, 'FAIL: blocker A should see its 1 block, saw ' || _n;
end $$;
select set_config('test.uid', :'OUT', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.blocks;  -- as OUT
    assert _n = 0, 'FAIL: the blocked party saw the block row (expected 0)';
    raise notice 'PASS: only the blocker reads its block rows';
end $$;
do $$
begin
    begin
        insert into public.blocks (blocker_id, blocked_id) values
            ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        assert false, 'FAIL: direct client INSERT into blocks was allowed';
    exception when insufficient_privilege then
        raise notice 'PASS: direct INSERT into blocks denied (RLS, no policy)';
    end;
end $$;

-- ── notifications RLS: read/mark-read own only, no direct INSERT ───────────────
select set_config('test.uid', :'C', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.notifications;  -- as C (recipient)
    assert _n = 1, 'FAIL: recipient C should see its 1 notification, saw ' || _n;
    update public.notifications set read_at = now() where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    get diagnostics _n = row_count;
    assert _n = 1, 'FAIL: recipient could not mark its notification read';
    raise notice 'PASS: recipient reads + marks-read its own notifications';
end $$;
select set_config('test.uid', :'B', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.notifications;  -- as B (the actor, not the recipient)
    assert _n = 0, 'FAIL: a non-recipient saw the notification (expected 0)';
    begin
        insert into public.notifications (user_id, type, actor_id) values
            ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'follow', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        assert false, 'FAIL: direct client INSERT into notifications was allowed';
    exception when insufficient_privilege then
        raise notice 'PASS: non-recipient sees none; direct INSERT into notifications denied';
    end;
end $$;

reset role;

\echo 'ALL 0017 SOCIAL-GRAPH ASSERTIONS PASSED'
