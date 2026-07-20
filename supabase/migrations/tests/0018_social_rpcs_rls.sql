-- Assertions for 0018_social_rpcs.sql. Run after stub_supabase.sql + the
-- 0002 → 0003 → 0007 → 0017 → 0018 chain + the "Supabase default grants" step. Verifies the
-- follow/block/search/discovery RPCs and — the load-bearing part — that the block + effective-
-- private gates hold across card/sends/lists/notifications, and that the projection core
-- is unreachable by a client.
-- Seeds run as the default (superuser) role (bypassing RLS); each assertion role-switches to
-- `authenticated` and sets test.uid per the stub's auth.uid().
\set ON_ERROR_STOP on

\set A   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set B   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set C   'cccccccc-cccc-cccc-cccc-cccccccccccc'
\set E   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
\set OUT 'dddddddd-dddd-dddd-dddd-dddddddddddd'

insert into auth.users (id) values (:'A'), (:'B'), (:'C'), (:'E'), (:'OUT');
-- A,B,OUT public+chosen; C private+chosen; E existing+UNchosen (privacy_choice_at null →
-- effectively private per KTD9a).
insert into public.profiles (id, handle, display_name, is_private, privacy_choice_at) values
    (:'A',   'anna',  'Anna',  false, now()),
    (:'B',   'bruno', 'Bruno', false, now()),
    (:'C',   'cy',    'Cy',    true,  now()),
    (:'E',   'ellis', 'Ellis', false, null),
    (:'OUT', 'dev',   'Dev',   false, now());

-- B has three sent ascents (distinct first_sent_at via the 0017 trigger + tiny sleeps), one
-- unsent attempt, and one soft-deleted send — only the three live sends may surface.
\set SB1 '10000000-0000-0000-0000-000000000001'
\set SB2 '10000000-0000-0000-0000-000000000002'
\set SB3 '10000000-0000-0000-0000-000000000003'
insert into public.ascents (id, user_id, date, sent, source_catalog_id, problem_name) values
    (:'SB1', :'B', now(), true, 'p1', 'Prob One');
select pg_sleep(0.01);
insert into public.ascents (id, user_id, date, sent, source_catalog_id, problem_name) values
    (:'SB2', :'B', now(), true, 'p2', 'Prob Two');
select pg_sleep(0.01);
insert into public.ascents (id, user_id, date, sent, source_catalog_id, problem_name) values
    (:'SB3', :'B', now(), true, 'p3', 'Prob Three');
insert into public.ascents (id, user_id, date, sent, source_catalog_id, problem_name) values
    ('10000000-0000-0000-0000-000000000004', :'B', now(), false, 'p4', 'Attempt'),   -- unsent
    ('10000000-0000-0000-0000-000000000005', :'B', now(), true,  'p5', 'Deleted');    -- will delete
update public.ascents set deleted = true where id = '10000000-0000-0000-0000-000000000005';
-- C (private) has one sent ascent; E (unchosen) has one sent ascent.
insert into public.ascents (id, user_id, date, sent, source_catalog_id, problem_name) values
    ('20000000-0000-0000-0000-000000000001', :'C', now(), true, 'pc', 'C Send'),
    ('30000000-0000-0000-0000-000000000001', :'E', now(), true, 'pe', 'E Send');

-- A shared collaborative list (0003) seats A and OUT together → co-member suggestion.
\set L '99999999-9999-9999-9999-999999999999'
insert into public.lists (id, owner_id, name) values (:'L', :'A', 'Crew');
insert into public.list_members (list_id, user_id) values (:'L', :'A'), (:'L', :'OUT')
    on conflict do nothing;

set role authenticated;

-- ── request_follow: public target → active + a `follow` notification ──────────
select set_config('test.uid', :'A', false);
do $$
declare _status text; _n int;
begin
    _status := (public.request_follow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')).status;
    assert _status = 'active', 'FAIL: following a public account did not land active (got ' || _status || ')';
    -- idempotent: a second request returns the existing active edge, no duplicate/second notif.
    _status := (public.request_follow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')).status;
    assert _status = 'active', 'FAIL: idempotent re-request did not return active';
    select count(*) into _n from public.follows
        where follower_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and followee_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    assert _n = 1, 'FAIL: duplicate edge created (got ' || _n || ')';
    raise notice 'PASS: follow public → active, idempotent, one edge';
end $$;

-- B sees exactly one `follow` notification from A.
select set_config('test.uid', :'B', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.get_notifications();
    assert _n = 1, 'FAIL: B expected 1 follow notification, saw ' || _n;
    raise notice 'PASS: an active follow lands one notification for the followee';
end $$;

-- ── request_follow: private target → pending, sends invisible until accepted ───
select set_config('test.uid', :'A', false);
do $$
declare _status text; _n int;
begin
    _status := (public.request_follow('cccccccc-cccc-cccc-cccc-cccccccccccc')).status;
    assert _status = 'pending', 'FAIL: following a private account did not land pending (got ' || _status || ')';
    select count(*) into _n from public.get_user_sends('cccccccc-cccc-cccc-cccc-cccccccccccc');
    assert _n = 0, 'FAIL: a pending (not active) follower saw private sends (' || _n || ')';
    raise notice 'PASS: follow private → pending, sends still gated';
end $$;

-- C sees A's pending request in the request inbox (sourced from follows, not notifications).
select set_config('test.uid', :'C', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.get_follow_requests()
        where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    assert _n = 1, 'FAIL: C did not see A''s pending request in get_follow_requests';
    raise notice 'PASS: get_follow_requests surfaces a pending request';
end $$;
select set_config('test.uid', :'A', false);

-- C accepts → A becomes active follower → C's send is now visible; A gets follow_accepted.
select set_config('test.uid', :'C', false);
select public.respond_to_follow('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select set_config('test.uid', :'A', false);
do $$
declare _sends int; _acc int;
begin
    select count(*) into _sends from public.get_user_sends('cccccccc-cccc-cccc-cccc-cccccccccccc');
    assert _sends = 1, 'FAIL: after accept, active follower cannot see private sends (' || _sends || ')';
    select count(*) into _acc from public.get_notifications() where type = 'follow_accepted';
    assert _acc = 1, 'FAIL: requester did not get a follow_accepted notification';
    raise notice 'PASS: accept flips to active; private sends visible; requester notified';
end $$;

-- ── self-follow + blocked-follow rejected ─────────────────────────────────────
do $$
begin
    begin
        perform public.request_follow('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        assert false, 'FAIL: self-follow via RPC allowed';
    exception when others then raise notice 'PASS: self-follow rejected';
    end;
end $$;

-- ── private-until-chosen: E is public (is_private=false) but unchosen → gated ──
do $$
declare _status text; _sends int;
begin
    _status := (public.request_follow('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')).status;
    assert _status = 'pending', 'FAIL: an unchosen (privacy_choice_at null) account was followable as public (got ' || _status || ')';
    select count(*) into _sends from public.get_user_sends('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
    assert _sends = 0, 'FAIL: unchosen account exposed sends to a non-active follower';
    raise notice 'PASS: private-until-chosen (privacy_choice_at null treated private)';
end $$;

-- ── profile sends: one actor's live sends, ordered, keyset, no attempts/tombstones ──
-- A actively follows B (public). get_user_sends(B) should show B's 3 live sends, newest-first.
do $$
declare _n int; _first uuid; _cursor_fs timestamptz; _cursor_id uuid; _page2 int;
begin
    select count(*) into _n from public.get_user_sends('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    assert _n = 3, 'FAIL: B''s profile expected 3 live sends, saw ' || _n;

    -- newest first: SB3 (last of the three seeded) has the most recent arrival → top.
    select ascent_id into _first from public.get_user_sends('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') limit 1;
    assert _first = '10000000-0000-0000-0000-000000000003',
        'FAIL: profile sends not ordered newest-first (top was ' || _first || ')';

    -- and SB3 (last) precedes SB1 (first) across the whole set.
    if (select array_position(
            array_agg(ascent_id order by first_sent_at desc, ascent_id desc),
            '10000000-0000-0000-0000-000000000003'::uuid)
        > array_position(
            array_agg(ascent_id order by first_sent_at desc, ascent_id desc),
            '10000000-0000-0000-0000-000000000001'::uuid)
        from public.get_user_sends('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')) then
        raise exception 'FAIL: within-actor order wrong (SB3 should precede SB1)';
    end if;

    -- keyset: page after the first row returns the rest without overlap.
    select first_sent_at, ascent_id into _cursor_fs, _cursor_id
        from public.get_user_sends('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') limit 1;
    select count(*) into _page2
        from public.get_user_sends('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 30, _cursor_fs, _cursor_id);
    assert _page2 = 2, 'FAIL: keyset page 2 expected 2, saw ' || _page2;
    raise notice 'PASS: profile sends = live sends, newest-first, keyset paginates';
end $$;

-- ── projection core is unreachable directly (execute revoked) ─────────────────
do $$
begin
    begin
        perform * from public._sends_for_actors(
            array['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid], 30, null, null);
        assert false, 'FAIL: a client called _sends_for_actors directly (gate bypass!)';
    exception when insufficient_privilege then
        raise notice 'PASS: _sends_for_actors is not executable by a client (gate cannot be bypassed)';
    end;
end $$;

-- ── search_profiles: prefix, min length, self/block excluded, edge status ─────
do $$
declare _n int; _edge text;
begin
    select count(*) into _n from public.search_profiles('br');   -- matches 'bruno'
    assert _n = 1, 'FAIL: prefix search for br expected 1, got ' || _n;
    select count(*) into _n from public.search_profiles('a');    -- below min length
    assert _n = 0, 'FAIL: a 1-char query returned rows (' || _n || ')';
    -- A follows B (active) → edge status surfaces for the button.
    select edge_status into _edge from public.search_profiles('bruno');
    assert _edge = 'active', 'FAIL: search did not surface the caller edge status (got ' || coalesce(_edge,'null') || ')';
    -- self excluded: searching own handle returns nothing.
    select count(*) into _n from public.search_profiles('anna');
    assert _n = 0, 'FAIL: search returned the caller themselves';
    raise notice 'PASS: search prefix-matches, enforces min length, excludes self, returns edge status';
end $$;

-- ── suggest_co_members: shared-list member, minus already-followed/self ───────
do $$
declare _n int;
begin
    -- A shares list L with OUT and does not follow OUT → OUT suggested.
    select count(*) into _n from public.suggest_co_members() where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    assert _n = 1, 'FAIL: co-member OUT not suggested (' || _n || ')';
    -- B is already followed → not suggested.
    select count(*) into _n from public.suggest_co_members() where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    assert _n = 0, 'FAIL: an already-followed user was suggested';
    raise notice 'PASS: co-member suggestion = shared graph minus followed/self';
end $$;

-- ── get_profile_card: visible (case-insensitive) for a normal viewer ──────────
do $$
declare _id uuid;
begin
    select id into _id from public.get_profile_card('BRUNO');  -- case-insensitive handle
    assert _id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'FAIL: get_profile_card did not resolve a visible handle';
    raise notice 'PASS: get_profile_card resolves a handle (case-insensitive) for a normal viewer';
end $$;

-- ── notification de-dup: a follow → unfollow → re-follow loop can't spam ──────
-- A already follows B (active) with an unread 'follow' notif to B. Unfollow + re-follow must
-- NOT create a second unread notification (and leaves the edge active for the tests below).
select public.unfollow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
do $$ begin perform public.request_follow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'); end $$;
select set_config('test.uid', :'B', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.notifications
        where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
          and actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and type = 'follow';
    assert _n = 1, 'FAIL: follow/unfollow/re-follow spammed notifications (got ' || _n || ', expected 1)';
    raise notice 'PASS: re-follow loop does not spam follow notifications (unread dedup)';
end $$;
select set_config('test.uid', :'A', false);

-- ── get_follow_counts / get_follow_list gated by can_view_social_graph ────────
-- As A (follows B active + C active — E is only pending, not counted): own counts + list.
do $$
declare _cf bigint; _n int;
begin
    select following into _cf from public.get_follow_counts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    assert _cf = 2, 'FAIL: A following-count expected 2 (B,C active), got ' || coalesce(_cf::text, 'null');
    select count(*) into _n from public.get_follow_list('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'following');
    assert _n = 2, 'FAIL: A following-list expected 2, got ' || _n;
    raise notice 'PASS: own follower/following counts + list';
end $$;
-- Private gate: OUT is not an active follower of private C → no counts, no follower list.
select set_config('test.uid', :'OUT', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.get_follow_counts('cccccccc-cccc-cccc-cccc-cccccccccccc');
    assert _n = 0, 'FAIL: a non-follower got private C''s follow counts';
    select count(*) into _n from public.get_follow_list('cccccccc-cccc-cccc-cccc-cccccccccccc', 'followers');
    assert _n = 0, 'FAIL: a non-follower got private C''s follower list';
    raise notice 'PASS: follow counts + list gated for a private non-follower';
end $$;
select set_config('test.uid', :'A', false);

-- ── block: tears down edges both ways, gates every read, purges notifications ──
-- A blocks B. Their active edge + A's follow-notification-from-B-side and B's notif must go.
select public.block_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
do $$
declare _n int;
begin
    select count(*) into _n from public.follows
        where (follower_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and followee_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
           or (follower_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and followee_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    assert _n = 0, 'FAIL: block did not delete the follow edge (' || _n || ')';

    -- A cannot see B's card, sends, or find B in search; re-follow is rejected.
    select count(*) into _n from public.get_profile_card('bruno');
    assert _n = 0, 'FAIL: blocked user''s profile card still visible';
    select count(*) into _n from public.get_user_sends('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    assert _n = 0, 'FAIL: blocked user''s sends still visible';
    select count(*) into _n from public.search_profiles('bruno');
    assert _n = 0, 'FAIL: blocked user still appears in search';
    begin
        perform public.request_follow('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
        assert false, 'FAIL: could re-follow a blocked user';
    exception when others then null;
    end;
    raise notice 'PASS: block severs edges + gates card/sends/search + blocks re-follow';
end $$;

-- Block is bidirectional: B cannot see A's card either, AND the cross-pair notification was
-- purged from the raw table (not merely filtered on read) — A's 'follow' notif to B is gone.
select set_config('test.uid', :'B', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.get_profile_card('anna');
    assert _n = 0, 'FAIL: block not bidirectional — B still sees A''s card';
    select count(*) into _n from public.notifications
        where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    assert _n = 0, 'FAIL: block_user did not purge the cross-pair notification (B still has A''s follow row)';
    raise notice 'PASS: block is bidirectional + purges cross-pair notifications';
end $$;

reset role;

\echo 'ALL 0018 SOCIAL-RPCS ASSERTIONS PASSED'
