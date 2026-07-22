-- Assertions for 0017_session_lit_problem.sql. Run after stub_supabase.sql + the 0002 → 0007
-- chain + stub_realtime.sql + 0017 + the "Supabase default grants" step (see run_rls_test.sh).
-- Behaviors under test:
--   (A) A member (non-owner) sets the lit problem via the RPC; attribution is pinned to the
--       caller (lit_by = auth.uid(), lit_at set) — the client never supplies it (R4).
--   (B) Passing null clears all three columns (overwrite/clear semantics, R1).
--   (C) The RPC does NOT bump expires_at (plan R7 / KTD-6 discipline).
--   (D) A non-member can neither read the lit columns nor call the RPC (AE5).
--   (E) A non-owner member still cannot UPDATE sessions directly (owner-only policy intact) —
--       the RPC is the only member write path.
--   (F) A dead (expired) session refuses the write ("session is not live").
--   (G) The lit-changed trigger emits exactly one broadcast per lit change on the session's
--       own session:<id> channel, and an unrelated sessions UPDATE (rename) emits none.
-- Negative cases wrap the denied path and RAISE if wrongly allowed; psql runs with
-- ON_ERROR_STOP so any raise fails the whole run.
\set ON_ERROR_STOP on

-- A owns session SA; M is a co-member of SA; OUT is a non-member. SX is A's expired session.
\set A   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set M   'dddddddd-dddd-dddd-dddd-dddddddddddd'
\set OUT 'cccccccc-cccc-cccc-cccc-cccccccccccc'

\set SA '11111111-1111-1111-1111-111111111111'
\set SX '33333333-3333-3333-3333-333333333333'

insert into auth.users (id) values (:'A'), (:'M'), (:'OUT');

-- Seed as superuser (bypasses RLS). The owner-seat trigger (0007) seats A in both sessions.
insert into public.sessions (id, owner_id, name, board_layout_id, expires_at, deleted) values
    (:'SA', :'A', 's-live',    7, now() + interval '1 hour', false),
    (:'SX', :'A', 's-expired', 7, now() - interval '1 hour', false);
insert into public.session_members (session_id, user_id) values (:'SA', :'M') on conflict do nothing;

-- ── (A) Member sets via the RPC; attribution pinned ──────────────────────────────
set role authenticated;
select set_config('test.uid', :'M', false);
select public.set_session_lit_problem(:'SA', 'prob-lit-1');
do $$
declare r record;
begin
    select lit_problem_id, lit_by, lit_at into r
    from public.sessions where id = '11111111-1111-1111-1111-111111111111';
    assert r.lit_problem_id = 'prob-lit-1', 'FAIL: lit_problem_id not set by member RPC';
    assert r.lit_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        'FAIL: lit_by not pinned to the calling member';
    assert r.lit_at is not null, 'FAIL: lit_at not set';
    raise notice 'PASS: member sets the lit problem; attribution pinned to the caller';
end $$;

-- Overwrite by the owner: pointer and attribution both move (R1).
select set_config('test.uid', :'A', false);
select public.set_session_lit_problem(:'SA', 'prob-lit-2');
do $$
declare r record;
begin
    select lit_problem_id, lit_by into r
    from public.sessions where id = '11111111-1111-1111-1111-111111111111';
    assert r.lit_problem_id = 'prob-lit-2' and r.lit_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'FAIL: overwrite did not move the pointer + attribution';
    raise notice 'PASS: the next light-up overwrites the pointer';
end $$;

-- ── (C) No expiry bump ────────────────────────────────────────────────────────────
-- (Checked before B so the clear below leaves A/B state independent.) The two RPC calls above
-- must not have moved expires_at from the seeded now()+1h.
do $$
declare exp timestamptz;
begin
    select expires_at into exp
    from public.sessions where id = '11111111-1111-1111-1111-111111111111';
    assert exp <= now() + interval '1 hour',
        'FAIL: set_session_lit_problem bumped expires_at (must stay explicit-intent-only)';
    raise notice 'PASS: the RPC never bumps expires_at';
end $$;

-- ── (B) Null clears ───────────────────────────────────────────────────────────────
select public.set_session_lit_problem(:'SA', null);
do $$
declare r record;
begin
    select lit_problem_id, lit_by, lit_at into r
    from public.sessions where id = '11111111-1111-1111-1111-111111111111';
    assert r.lit_problem_id is null and r.lit_by is null and r.lit_at is null,
        'FAIL: null did not clear all three lit columns';
    raise notice 'PASS: passing null clears the pointer';
end $$;

-- Re-set so the read-boundary + direct-UPDATE cases below have a value to protect.
select public.set_session_lit_problem(:'SA', 'prob-lit-3');

-- ── (D) Non-member: no read, no RPC ───────────────────────────────────────────────
select set_config('test.uid', :'OUT', false);
do $$
begin
    assert (select count(*) from public.sessions
            where id = '11111111-1111-1111-1111-111111111111') = 0,
        'FAIL: a non-member can read the session row (lit columns leak)';
    begin
        perform public.set_session_lit_problem('11111111-1111-1111-1111-111111111111', 'prob-evil');
        raise exception 'FAIL: a non-member set the lit problem';
    exception when others then
        if sqlerrm like 'FAIL:%' then raise; end if;
        if sqlerrm not like '%not a session member%' then raise; end if;
    end;
    raise notice 'PASS: non-member can neither read nor set the lit problem';
end $$;

-- ── (E) Direct UPDATE stays owner-only ────────────────────────────────────────────
-- M is a member but not the owner: a direct UPDATE matches zero rows under 0007's owner-only
-- policy, so the value M set via… anything other than the RPC cannot move. Verified as
-- superuser afterwards (M can read the row, but the point is the write path).
select set_config('test.uid', :'M', false);
update public.sessions set lit_problem_id = 'prob-forged'
    where id = '11111111-1111-1111-1111-111111111111';
reset role;
do $$
begin
    assert (select lit_problem_id from public.sessions
            where id = '11111111-1111-1111-1111-111111111111') = 'prob-lit-3',
        'FAIL: a non-owner member updated sessions.lit_problem_id directly';
    raise notice 'PASS: direct member UPDATE is still owner-only; the RPC is the member path';
end $$;

-- ── (F) Dead session refuses the write ────────────────────────────────────────────
set role authenticated;
select set_config('test.uid', :'A', false);
do $$
begin
    begin
        perform public.set_session_lit_problem('33333333-3333-3333-3333-333333333333', 'prob-late');
        raise exception 'FAIL: an expired session accepted a lit problem';
    exception when others then
        if sqlerrm like 'FAIL:%' then raise; end if;
        if sqlerrm not like '%session is not live%' then raise; end if;
    end;
    raise notice 'PASS: a dead session refuses the write';
end $$;

-- ── (G) lit-changed trigger emission (and silence on unrelated updates) ───────────
reset role;
delete from realtime.messages;
set role authenticated;
select set_config('test.uid', :'A', false);
select public.set_session_lit_problem(:'SA', 'prob-emit');
reset role;
do $$
declare _n int; _topic text; _event text;
begin
    select count(*), max(topic), max(event) into _n, _topic, _event from realtime.messages;
    assert _n = 1, format('FAIL: expected exactly 1 lit-changed broadcast, got %s', _n);
    assert _topic = 'session:11111111-1111-1111-1111-111111111111',
        format('FAIL: broadcast on wrong topic %s', _topic);
    assert _event = 'lit-changed', format('FAIL: broadcast with wrong event %s', _event);
    raise notice 'PASS: a lit change emits one lit-changed broadcast on session:<id>';
end $$;

-- An unrelated sessions UPDATE (owner rename) must NOT emit lit-changed (the WHEN clause).
delete from realtime.messages;
set role authenticated;
select set_config('test.uid', :'A', false);
update public.sessions set name = 'renamed'
    where id = '11111111-1111-1111-1111-111111111111';
reset role;
do $$
begin
    assert (select count(*) from realtime.messages where event = 'lit-changed') = 0,
        'FAIL: a rename emitted lit-changed';
    raise notice 'PASS: unrelated sessions updates stay silent on lit-changed';
end $$;

do $$ begin raise notice '0017 lit-problem RLS assertions: ALL PASSED'; end $$;
