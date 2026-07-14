-- RLS assertions for 0011_beta_user_submissions.sql. Run after stub_supabase.sql + the 0010
-- migration + the 0011 migration + the "Supabase default grants" step (see run_rls_test.sh:
-- the 0011 case applies the 0010 → 0011 chain). Every negative test wraps the denied operation
-- in a block and RAISEs if it was wrongly allowed; psql runs with ON_ERROR_STOP so any raise
-- fails the whole run.
--
-- Phase 2 opens the one write seam 0010 left closed: a signed-in user may INSERT a *pending
-- user* row and nothing else. This case proves the WITH CHECK clamp pins every field the client
-- must leave to the server (status/source/provider/added_by/deleted AND all metadata), the
-- video_id format CHECK, the per-user pending-submission cap, and that the source-filtered
-- notification trigger fires on a user insert but NOT on a seed insert.
\set ON_ERROR_STOP on
\set U  '11111111-1111-1111-1111-111111111111'
\set U2 '22222222-2222-2222-2222-222222222222'

insert into auth.users (id) values (:'U'), (:'U2');

-- An approved seed row (service-role equivalent — superuser bypasses RLS) so the read-gate and
-- authenticated update/delete-affect-zero assertions have a live row to (fail to) touch.
insert into public.problem_beta_videos (source_catalog_id, video_id, source, status)
    values ('prob-A', 'AAAAAAAAAAA', 'seed', 'approved');

-- ── Anonymous still cannot write (no anon insert policy) ──────────────────────
set role anon;
do $$
begin
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by)
        values ('prob-A', 'dQw4w9WgXcQ', 'user', 'pending', null);
        raise exception 'FAIL: anon inserted a beta submission';
    exception when insufficient_privilege then
        raise notice 'PASS: anon insert denied';
    end;
end $$;

-- ── Authenticated user submits a VALID pending user row → succeeds ────────────
-- Configure the notification webhook in the LOCKED config table as the service-role equivalent
-- (superuser). The trigger reads it via SECURITY DEFINER; the stub net.http_post logs the url it
-- was called with into net._test_calls, so we can assert both that it fired and WHICH url it hit.
reset role;
update public.beta_notify_config set webhook_url = 'https://example.test/beta-hook' where id = 1;

set role authenticated;
select set_config('test.uid', :'U', false);
-- SSRF guard (P1): a signed-in user can still SET the old custom GUC in their own session, but the
-- trigger no longer reads it — so it must have NO effect on where the POST goes.
select set_config('app.beta_webhook_url', 'http://169.254.169.254/latest/meta-data/', false);

do $$
declare _before int; _after int; _url text;
begin
    select count(*) into _before from net._test_calls;
    insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by)
        values ('prob-A', 'dQw4w9WgXcQ', 'user', 'pending', auth.uid());
    select count(*) into _after from net._test_calls;
    assert _after = _before + 1,
        'FAIL: user insert did not fire the notification trigger exactly once';
    select url into _url from net._test_calls order by id desc limit 1;
    assert _url = 'https://example.test/beta-hook',
        'FAIL: notification POSTed to ' || coalesce(_url, '<null>')
        || ' — a user-set GUC redirected it (SSRF regression)';
    raise notice 'PASS: valid pending submission fires notification to the LOCKED config url (session GUC ignored — no SSRF)';
end $$;

-- The pending row is invisible to the submitter's own reads (approved-only gate from 0010).
do $$
begin
    assert (select count(*) from public.problem_beta_videos
            where source_catalog_id = 'prob-A' and video_id = 'dQw4w9WgXcQ') = 0,
        'FAIL: pending user row leaked to an authenticated read';
    raise notice 'PASS: pending user row invisible to reads (approved-only gate holds)';
end $$;

-- ── Clamp: every field the client must NOT set is rejected ────────────────────
-- Each case is an otherwise-valid pending user insert with exactly ONE forbidden field, and
-- must be denied by the RLS WITH CHECK (insufficient_privilege / 42501). The base valid row is
-- (source='user', status='pending', provider='youtube', added_by=auth.uid(), deleted=false,
-- title='', channel='', views=0, is_short=false, duration_s=null).
do $$
begin
    -- self-approve
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by)
        values ('prob-clamp', 'ClampTest01', 'user', 'approved', auth.uid());
        raise exception 'FAIL: clamp allowed self-approve (status=approved)';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects self-approve'; end;

    -- impersonate added_by
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by)
        values ('prob-clamp', 'ClampTest01', 'user', 'pending', '22222222-2222-2222-2222-222222222222');
        raise exception 'FAIL: clamp allowed added_by impersonation';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects added_by impersonation'; end;

    -- forge seed source
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by)
        values ('prob-clamp', 'ClampTest01', 'seed', 'pending', auth.uid());
        raise exception 'FAIL: clamp allowed source=seed';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects forged seed source'; end;

    -- smuggle instagram provider
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, provider, added_by)
        values ('prob-clamp', 'ClampTest01', 'user', 'pending', 'instagram', auth.uid());
        raise exception 'FAIL: clamp allowed provider=instagram';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects instagram provider'; end;

    -- pre-tombstone (deleted=true)
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by, deleted)
        values ('prob-clamp', 'ClampTest01', 'user', 'pending', auth.uid(), true);
        raise exception 'FAIL: clamp allowed deleted=true';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects pre-tombstone'; end;

    -- forge channel
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by, channel)
        values ('prob-clamp', 'ClampTest01', 'user', 'pending', auth.uid(), 'Faker');
        raise exception 'FAIL: clamp allowed a forged channel';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects forged channel'; end;

    -- forge title
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by, title)
        values ('prob-clamp', 'ClampTest01', 'user', 'pending', auth.uid(), 'Fake');
        raise exception 'FAIL: clamp allowed a forged title';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects forged title'; end;

    -- forge views
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by, views)
        values ('prob-clamp', 'ClampTest01', 'user', 'pending', auth.uid(), 999999);
        raise exception 'FAIL: clamp allowed forged views';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects forged views'; end;

    -- forge is_short
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by, is_short)
        values ('prob-clamp', 'ClampTest01', 'user', 'pending', auth.uid(), true);
        raise exception 'FAIL: clamp allowed forged is_short';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects forged is_short'; end;

    -- forge duration_s
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by, duration_s)
        values ('prob-clamp', 'ClampTest01', 'user', 'pending', auth.uid(), 42);
        raise exception 'FAIL: clamp allowed forged duration_s';
    exception when insufficient_privilege then raise notice 'PASS: clamp rejects forged duration_s'; end;
end $$;

-- ── video_id format CHECK: malformed id rejected even with everything else valid ──
do $$
begin
    begin
        insert into public.problem_beta_videos
            (source_catalog_id, video_id, source, status, added_by)
        values ('prob-fmt', 'not-11-chars-long', 'user', 'pending', auth.uid());
        raise exception 'FAIL: malformed video_id accepted';
    exception when check_violation then
        raise notice 'PASS: malformed video_id rejected by CHECK';
    end;
end $$;

-- ── Authenticated UPDATE/DELETE still affect ZERO rows (no write policy; 0010 property) ──
do $$
declare _n int;
begin
    update public.problem_beta_videos set title = 'hacked' where source_catalog_id = 'prob-A';
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: authenticated updated ' || _n || ' row(s)';
    delete from public.problem_beta_videos where source_catalog_id = 'prob-A';
    get diagnostics _n = row_count;
    assert _n = 0, 'FAIL: authenticated deleted ' || _n || ' row(s)';
    raise notice 'PASS: authenticated update/delete affect zero rows (no write policy)';
end $$;

-- ── Dedupe: a duplicate LIVE clip on the user path raises 23505 ───────────────
do $$
begin
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by)
        values ('prob-A', 'dQw4w9WgXcQ', 'user', 'pending', auth.uid());  -- dup of the pending row
        raise exception 'FAIL: duplicate live clip allowed on user path';
    exception when unique_violation then
        raise notice 'PASS: partial dedupe index blocks a duplicate live clip (user path)';
    end;
end $$;

-- ── Notification does NOT fire on a seed insert (source-filtered trigger) ──────
reset role;  -- superuser (service-role equivalent) for the seed insert
do $$
declare _before int; _after int;
begin
    select count(*) into _before from net._test_calls;
    insert into public.problem_beta_videos (source_catalog_id, video_id, source, status)
        values ('prob-A', 'BBBBBBBBBBB', 'seed', 'approved');
    select count(*) into _after from net._test_calls;
    assert _after = _before,
        'FAIL: notification trigger fired on a seed insert (WHEN source=user filter broken)';
    raise notice 'PASS: notification trigger does not fire on a seed insert';
end $$;

-- ── Reject invariant: a rejected row MUST be soft-deleted (CHECK, not just runbook) ──
-- Superuser (service-role equivalent) performs moderation. A status-only reject would strand the
-- `where not deleted` dedupe tuple, so the CHECK must forbid it; reject WITH deleted=true is fine.
do $$
begin
    begin
        update public.problem_beta_videos set status = 'rejected'
            where source_catalog_id = 'prob-A' and video_id = 'BBBBBBBBBBB';  -- deleted stays false
        raise exception 'FAIL: status-only reject allowed (would strand the dedupe tuple)';
    exception when check_violation then
        raise notice 'PASS: status-only reject blocked by CHECK (must soft-delete)';
    end;
    update public.problem_beta_videos set status = 'rejected', deleted = true
        where source_catalog_id = 'prob-A' and video_id = 'BBBBBBBBBBB';
    raise notice 'PASS: reject WITH deleted=true is allowed';
end $$;

-- Reset the notification target so the cap test below doesn't spam the stub log.
update public.beta_notify_config set webhook_url = '' where id = 1;

-- ── Rate limit: 10 pending per user, 11th denied, freed by moderation ─────────
set role authenticated;
select set_config('test.uid', :'U2', false);
do $$
declare i int;
begin
    for i in 0 .. 9 loop
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by)
            values ('prob-cap', 'aaaaaaaaaa' || i, 'user', 'pending', auth.uid());
    end loop;
    raise notice 'PASS: 10 pending submissions accepted for one user';
end $$;

do $$
begin
    begin
        insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by)
            values ('prob-cap', 'bbbbbbbbbb0', 'user', 'pending', auth.uid());
        raise exception 'FAIL: 11th pending submission accepted (cap not enforced)';
    exception when raise_exception then
        raise notice 'PASS: 11th pending submission denied (per-user cap = 10)';
    end;
end $$;

-- Moderating one pending row (superuser approves) frees a slot → next insert succeeds.
reset role;
update public.problem_beta_videos set status = 'approved'
    where source_catalog_id = 'prob-cap' and video_id = 'aaaaaaaaaa0';
set role authenticated;
select set_config('test.uid', :'U2', false);
do $$
begin
    insert into public.problem_beta_videos (source_catalog_id, video_id, source, status, added_by)
        values ('prob-cap', 'bbbbbbbbbb0', 'user', 'pending', auth.uid());
    raise notice 'PASS: a freed slot (one approved) lets a new pending submission through';
end $$;

reset role;
\echo 'ALL 0011 RLS ASSERTIONS PASSED'
