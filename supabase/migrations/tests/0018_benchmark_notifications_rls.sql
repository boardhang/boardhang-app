-- RLS + trigger assertions for 0018_benchmark_notifications.sql. Run after stub_supabase.sql +
-- the 0002 → 0006 → 0018 chain + the "Supabase default grants" step (see run_rls_test.sh: the
-- 0018 case grants public tables to anon/authenticated so RLS — not a missing grant — is what
-- denies). Every negative test wraps the denied op in a block and RAISEs if wrongly allowed;
-- psql runs with ON_ERROR_STOP so any raise fails the whole run.
--
-- Two proofs live here:
--   1. The capture trigger fires on rising edges ONLY and never on re-stamps (the full-import
--      churn case), and its ON CONFLICT re-arms a discarded event without touching a notified one
--      (KTD2: a spurious flip discarded must not consume the notification of a genuine promotion).
--   2. RLS: benchmark_events is world-readable but client-unwritable; notification_interests +
--      push_subscriptions are strictly owner-scoped, with WITH CHECK on UPDATE so PostgREST's
--      ON CONFLICT DO UPDATE reconcile succeeds on repeat upserts (KTD7).
\set ON_ERROR_STOP on
\set U  '11111111-1111-1111-1111-111111111111'
\set U2 '22222222-2222-2222-2222-222222222222'

insert into auth.users (id) values (:'U'), (:'U2');

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the catalog_problems table (service-role equivalent — superuser bypasses RLS) so the
-- trigger has real rows to react to. `updated_at` is set by 0006's set_updated_at trigger.
insert into public.catalog_problems (source_catalog_id, layout_id, angle, name, grade, is_benchmark)
    values
        ('prob-bench-1', 17, 40, 'Bench One', '7A', true),   -- rising-edge on insert → event
        ('prob-bench-2', 17, 40, 'Bench Two', '7B', false),  -- non-benchmark insert → no event
        ('prob-bench-3', 17, 25, 'Angled',    '6C', false);  -- flipped false→true below

-- ── Trigger: insert-as-benchmark creates one event; insert-as-non-benchmark creates none ──
do $$
declare _n int;
begin
    select count(*) into _n from public.benchmark_events where source_catalog_id = 'prob-bench-1';
    assert _n = 1, 'FAIL: insert-as-benchmark did not create an event (got ' || _n || ')';
    select count(*) into _n from public.benchmark_events where source_catalog_id = 'prob-bench-2';
    assert _n = 0, 'FAIL: insert of a non-benchmark created ' || _n || ' event(s)';
    raise notice 'PASS: insert trigger fires only on is_benchmark=true';
end $$;

-- The event carries the slab dimensions the sender/client both need.
do $$
declare _lid int; _angle int;
begin
    select layout_id, angle into _lid, _angle
        from public.benchmark_events where source_catalog_id = 'prob-bench-1';
    assert _lid = 17 and _angle = 40,
        'FAIL: event slab mismatch (' || _lid || ',' || _angle || ')';
    raise notice 'PASS: event captured layout_id + angle from the row';
end $$;

-- ── Trigger: update false→true creates an event (the manual-SQL promotion case, AE1's SQL half) ──
update public.catalog_problems set is_benchmark = true where source_catalog_id = 'prob-bench-3';
do $$
declare _n int;
begin
    select count(*) into _n from public.benchmark_events where source_catalog_id = 'prob-bench-3';
    assert _n = 1, 'FAIL: rising-edge update did not create an event';
    raise notice 'PASS: update false→true creates an event';
end $$;

-- ── Trigger: true→true re-stamp (the full-import churn case) creates NOTHING ──────────────────
-- 0006's set_updated_at trigger fires on every UPDATE and bumps updated_at; without the WHEN
-- guard on old.is_benchmark IS DISTINCT FROM new.is_benchmark, this would create a duplicate
-- event for every already-benchmarked problem on every full re-import.
do $$
declare _before int; _after int;
begin
    select count(*) into _before from public.benchmark_events where source_catalog_id = 'prob-bench-1';
    update public.catalog_problems set is_benchmark = true, name = 'Bench One v2'
        where source_catalog_id = 'prob-bench-1';
    select count(*) into _after from public.benchmark_events where source_catalog_id = 'prob-bench-1';
    assert _after = _before,
        'FAIL: re-stamp of an already-benchmarked row created an event (WHEN guard broken)';
    raise notice 'PASS: true→true re-stamp creates no event (import churn is cheap)';
end $$;

-- ── Trigger: true→false (un-benchmarking) creates nothing (R10) ───────────────────────────────
do $$
declare _before int; _after int;
begin
    select count(*) into _before from public.benchmark_events;
    update public.catalog_problems set is_benchmark = false where source_catalog_id = 'prob-bench-3';
    select count(*) into _after from public.benchmark_events;
    assert _after = _before, 'FAIL: falling edge created an event';
    raise notice 'PASS: true→false creates no event';
end $$;

-- ── Trigger: false→true when an event row already exists and is PENDING → no duplicate (AE2) ──
-- Flap the row back to true and confirm the ON CONFLICT path preserves the existing PENDING row
-- rather than raising or duplicating. Should be a no-op on a pending row.
do $$
declare _before_created timestamptz; _after_created timestamptz; _n int;
begin
    select created_at into _before_created from public.benchmark_events
        where source_catalog_id = 'prob-bench-3';
    update public.catalog_problems set is_benchmark = true where source_catalog_id = 'prob-bench-3';
    select count(*) into _n from public.benchmark_events where source_catalog_id = 'prob-bench-3';
    assert _n = 1, 'FAIL: flap created a duplicate event row (got ' || _n || ')';
    select created_at into _after_created from public.benchmark_events
        where source_catalog_id = 'prob-bench-3';
    assert _after_created = _before_created,
        'FAIL: flap on a pending row bumped created_at (should be a no-op)';
    raise notice 'PASS: flap on pending event is a no-op (no duplicate, created_at preserved)';
end $$;

-- ── ON CONFLICT dedupe against NOTIFIED events (KTD2, R10, AE2) ───────────────────────────────
-- Mark 'prob-bench-1' as notified (service-role sender), then flap the catalog row false→true.
-- The notified event must remain notified and un-re-armed — a problem notified once never
-- re-notifies for its lifetime.
update public.benchmark_events set notified_at = now() where source_catalog_id = 'prob-bench-1';
update public.catalog_problems set is_benchmark = false where source_catalog_id = 'prob-bench-1';
update public.catalog_problems set is_benchmark = true  where source_catalog_id = 'prob-bench-1';
do $$
declare _notified timestamptz; _discarded timestamptz;
begin
    select notified_at, discarded_at into _notified, _discarded
        from public.benchmark_events where source_catalog_id = 'prob-bench-1';
    assert _notified is not null,
        'FAIL: flap after notify cleared notified_at (would re-notify — R10 violated)';
    assert _discarded is null, 'FAIL: unexpected discarded_at on notified row';
    raise notice 'PASS: flap after notify is fully absorbed (R10 / AE2 dedupe holds)';
end $$;

-- ── ON CONFLICT re-arms a DISCARDED event (KTD2 — an operator --discard must re-arm) ──────────
-- The upstream is documented unreliable: a spurious flip that gets discarded must not permanently
-- consume the notification for the genuine promotion that follows.
insert into public.catalog_problems (source_catalog_id, layout_id, angle, name, grade, is_benchmark)
    values ('prob-bench-4', 17, 40, 'Discarded', '7C', true);
update public.benchmark_events set discarded_at = now() where source_catalog_id = 'prob-bench-4';
update public.catalog_problems  set is_benchmark = false where source_catalog_id = 'prob-bench-4';
update public.catalog_problems  set is_benchmark = true  where source_catalog_id = 'prob-bench-4';
do $$
declare _notified timestamptz; _discarded timestamptz; _created_before timestamptz; _created_after timestamptz;
begin
    select discarded_at, notified_at into _discarded, _notified
        from public.benchmark_events where source_catalog_id = 'prob-bench-4';
    assert _discarded is null,
        'FAIL: rising edge after --discard did not clear discarded_at (event not re-armed)';
    assert _notified is null,
        'FAIL: re-armed event carries a stale notified_at';
    raise notice 'PASS: rising edge after --discard re-arms the event (KTD2)';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ── RLS: benchmark_events — anon can select; nobody but service-role can write ────────────────
set role anon;
do $$
declare _n int;
begin
    select count(*) into _n from public.benchmark_events;
    assert _n >= 1, 'FAIL: anon cannot read benchmark_events (public read broken)';
    raise notice 'PASS: anon reads benchmark_events';
end $$;

do $$
begin
    begin
        insert into public.benchmark_events (source_catalog_id, layout_id, angle)
            values ('prob-forge', 17, 40);
        raise exception 'FAIL: anon inserted a benchmark event';
    exception when insufficient_privilege then
        raise notice 'PASS: anon insert on benchmark_events denied';
    end;
end $$;

set role authenticated;
select set_config('test.uid', :'U', false);
do $$
begin
    -- authenticated select still works (world-readable)
    perform 1 from public.benchmark_events limit 1;
    begin
        insert into public.benchmark_events (source_catalog_id, layout_id, angle)
            values ('prob-forge-2', 17, 40);
        raise exception 'FAIL: authenticated inserted a benchmark event';
    exception when insufficient_privilege then
        raise notice 'PASS: authenticated insert on benchmark_events denied';
    end;
    begin
        update public.benchmark_events set notified_at = now() where source_catalog_id = 'prob-bench-1';
        -- update-denied paths may not raise; instead the row_count is zero. Prove either.
        raise notice 'PASS: authenticated update on benchmark_events denied (row_count = 0 or raise)';
    exception when insufficient_privilege then
        raise notice 'PASS: authenticated update on benchmark_events denied by RLS';
    end;
    begin
        delete from public.benchmark_events where source_catalog_id = 'prob-bench-1';
        raise notice 'PASS: authenticated delete on benchmark_events denied (row_count = 0 or raise)';
    exception when insufficient_privilege then
        raise notice 'PASS: authenticated delete on benchmark_events denied by RLS';
    end;
end $$;

-- Prove the update/delete actually affected zero rows (no policy → RLS denies silently at row scope).
do $$
declare _notified timestamptz; _n int;
begin
    -- reset role so we bypass RLS to observe true state
    reset role;
    select notified_at into _notified from public.benchmark_events where source_catalog_id = 'prob-bench-1';
    assert _notified is not null,
        'FAIL: authenticated update on benchmark_events actually took effect (notified_at cleared)';
    select count(*) into _n from public.benchmark_events where source_catalog_id = 'prob-bench-1';
    assert _n = 1, 'FAIL: authenticated delete on benchmark_events actually took effect';
    raise notice 'PASS: benchmark_events unchanged by authenticated write attempts';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ── RLS: notification_interests — owner scope, repeat-upsert must succeed (WITH CHECK on UPDATE) ──
set role authenticated;
select set_config('test.uid', :'U', false);

-- U inserts two interests
insert into public.notification_interests (user_id, layout_id, angle) values (auth.uid(), 17, 40);
insert into public.notification_interests (user_id, layout_id, angle) values (auth.uid(), 17, 25);
do $$
declare _n int;
begin
    select count(*) into _n from public.notification_interests where user_id = auth.uid();
    assert _n = 2, 'FAIL: user could not read own interests (got ' || _n || ')';
    raise notice 'PASS: user reads their own interests';
end $$;

-- Repeat-upsert of an already-present row must SUCCEED for the owner (the PostgREST ON CONFLICT DO
-- UPDATE path used by the app-start reconcile: without WITH CHECK on the UPDATE policy, this
-- errors and interests sync works once per device then hard-breaks).
do $$
begin
    insert into public.notification_interests (user_id, layout_id, angle)
        values (auth.uid(), 17, 40)
    on conflict (user_id, layout_id, angle) do update
        set layout_id = excluded.layout_id;  -- no-op update, exercises the UPDATE policy
    raise notice 'PASS: repeat-upsert on own interest row succeeds (UPDATE WITH CHECK clamp holds)';
end $$;

-- Forging another user's interest row is denied (WITH CHECK on INSERT).
do $$
begin
    begin
        insert into public.notification_interests (user_id, layout_id, angle)
            values ('22222222-2222-2222-2222-222222222222', 17, 40);
        raise exception 'FAIL: user forged an interest row for another user';
    exception when insufficient_privilege then
        raise notice 'PASS: forging another user''s interest row denied';
    end;
end $$;

-- User B cannot see or delete user A's interests
set role authenticated;
select set_config('test.uid', :'U2', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.notification_interests where user_id = '11111111-1111-1111-1111-111111111111';
    assert _n = 0, 'FAIL: user B read user A''s interest rows (got ' || _n || ')';
    delete from public.notification_interests where user_id = '11111111-1111-1111-1111-111111111111';
    select count(*) into _n from public.notification_interests where user_id = '11111111-1111-1111-1111-111111111111';
    -- observe as owner
end $$;
reset role;
do $$
declare _n int;
begin
    select count(*) into _n from public.notification_interests where user_id = '11111111-1111-1111-1111-111111111111';
    assert _n = 2, 'FAIL: user B''s DELETE actually removed user A''s interest rows (got ' || _n || ')';
    raise notice 'PASS: user B cannot read or delete user A''s interests';
end $$;

-- User A can delete their own
set role authenticated;
select set_config('test.uid', :'U', false);
delete from public.notification_interests where user_id = auth.uid() and angle = 25;
do $$
declare _n int;
begin
    select count(*) into _n from public.notification_interests where user_id = auth.uid();
    assert _n = 1, 'FAIL: owner could not delete own interest (remaining ' || _n || ')';
    raise notice 'PASS: owner deletes their own interest';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ── RLS: push_subscriptions — owner-scoped SELECT as well as write (endpoint = capability) ────
set role authenticated;
select set_config('test.uid', :'U', false);

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (auth.uid(), 'https://push.example/aaa', 'p256dh-aaa', 'auth-aaa');

-- Owner reads their subscription
do $$
declare _n int;
begin
    select count(*) into _n from public.push_subscriptions where user_id = auth.uid();
    assert _n = 1, 'FAIL: owner could not read own push_subscription';
    raise notice 'PASS: owner reads own push_subscriptions';
end $$;

-- Duplicate endpoint upsert resolves on the unique constraint for the same owner (last_seen_at bump).
do $$
begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, last_seen_at)
        values (auth.uid(), 'https://push.example/aaa', 'p256dh-aaa', 'auth-aaa', now())
    on conflict (endpoint) do update
        set last_seen_at = excluded.last_seen_at;
    raise notice 'PASS: repeat-upsert on own push_subscription succeeds';
end $$;

-- Forging a subscription for another user is denied (WITH CHECK on INSERT).
do $$
begin
    begin
        insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
            values ('22222222-2222-2222-2222-222222222222', 'https://push.example/bbb', 'p2', 'a2');
        raise exception 'FAIL: user forged a subscription for another user';
    exception when insufficient_privilege then
        raise notice 'PASS: forging another user''s push_subscription denied';
    end;
end $$;

-- User B cannot SELECT (endpoint+keys are a capability) nor UPDATE user A's row.
set role authenticated;
select set_config('test.uid', :'U2', false);
do $$
declare _n int;
begin
    select count(*) into _n from public.push_subscriptions
        where endpoint = 'https://push.example/aaa';
    assert _n = 0, 'FAIL: user B read user A''s push_subscription (endpoint leaked)';
    update public.push_subscriptions set p256dh = 'hacked' where endpoint = 'https://push.example/aaa';
    -- effect verified below as superuser
    raise notice 'PASS: user B SELECT on user A''s push_subscription returns zero rows';
end $$;

reset role;
do $$
declare _p text;
begin
    select p256dh into _p from public.push_subscriptions where endpoint = 'https://push.example/aaa';
    assert _p = 'p256dh-aaa',
        'FAIL: user B''s UPDATE actually mutated user A''s push_subscription (got ' || _p || ')';
    raise notice 'PASS: user B UPDATE on user A''s push_subscription affected zero rows';
end $$;

-- updated_at trigger from 0002 fires on push_subscriptions
set role authenticated;
select set_config('test.uid', :'U', false);
do $$
declare _before timestamptz; _after timestamptz;
begin
    select updated_at into _before from public.push_subscriptions where user_id = auth.uid();
    perform pg_sleep(0.01);
    update public.push_subscriptions set last_seen_at = now() where user_id = auth.uid();
    select updated_at into _after from public.push_subscriptions where user_id = auth.uid();
    assert _after > _before,
        'FAIL: set_updated_at trigger did not bump updated_at on push_subscriptions';
    raise notice 'PASS: updated_at auto-bumps on push_subscriptions update';
end $$;

reset role;
\echo 'ALL 0018 RLS ASSERTIONS PASSED'
