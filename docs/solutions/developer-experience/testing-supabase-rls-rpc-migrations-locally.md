---
title: Test Supabase RLS + RPC migrations locally with a throwaway Postgres and auth stubs
date: 2026-07-08
category: docs/solutions/developer-experience
module: Supabase migrations / accounts backend
problem_type: developer_experience
component: testing_framework
severity: medium
applies_when:
  - "Writing or changing a supabase/migrations/** file — tables, RLS policies, triggers, or SECURITY DEFINER RPCs"
  - "You need to prove RLS / RPC / cross-user privacy behavior before applying to the hosted Supabase project"
  - "The repo has no local Supabase (no supabase/config.toml, no supabase CLI) so migrations are applied by hand to the dashboard"
related_components:
  - database
  - authentication
tags: [supabase, postgres, rls, rpc, security-definer, migrations, testing, docker]
---

# Test Supabase RLS + RPC migrations locally with a throwaway Postgres and auth stubs

## Context

This repo has **no local Supabase** — there is no `supabase/config.toml` and no `supabase` CLI. Migrations in `supabase/migrations/**` are applied by hand to the hosted project (dashboard SQL editor or `supabase db push`). That leaves no built-in way to verify a migration *before* it hits the real project, which is dangerous for safety-critical changes: RLS policies, `SECURITY DEFINER` RPCs, and any cross-user data path (e.g. the collaboration-sessions `session_member_ascents` projection) are exactly the code where a silent mistake leaks another user's data.

You want a fast, local, throwaway way to (a) confirm the migration *applies cleanly* and (b) assert its *privacy/authorization behavior* — a non-member is refused, a projection returns status-only columns, an ended session refuses, account-deletion cascades — with no risk to production.

## Guidance

Spin up a disposable `postgres:16` Docker container, load **Supabase-shaped auth stubs** plus the prerequisite objects from earlier migrations, apply the new migration, then run behavioral scenarios as SQL assertions. Docker is the only dependency.

**1. Stub the Supabase auth surface** the migration depends on:

```sql
-- auth schema + users table + auth.uid() reading a per-test GUC.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

-- IMPORTANT: name the GUC 'app.uid', NOT 'app.current_user' — current_user is a
-- reserved word and `set app.current_user = '...'` is a syntax error.
create or replace function auth.uid()
  returns uuid language sql stable
as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

-- The role RLS gates on. Grant it table DML; RLS is the real gate.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
end $$;
grant usage on schema public, auth to authenticated;
```

Then load the prerequisite objects the new migration references (e.g. the shared `set_updated_at()` trigger fn and a minimal `ascents` table with its owner-only RLS), and `grant ... to authenticated` on every table the migration touches.

**2. Simulate a specific signed-in user per assertion** with `set role` + the GUC:

```sql
reset role;                                   -- superuser: setup (bypasses RLS)
set role authenticated;                       -- exercise RLS as the app role
set app.uid = '11111111-...';                 -- auth.uid() now returns this user
-- ...statements run as this user, under RLS...
reset role;                                   -- back to superuser
```

`SECURITY DEFINER` functions execute as their owner (the superuser here), which **correctly models Supabase** — the definer bypasses RLS while the caller is `authenticated`. That's what lets you prove "a cross-user projection RPC returns another member's rows *without* relaxing the owner-only policy on the underlying table."

**3. Assert behavior**, including expected-to-raise calls, inside `plpgsql` blocks:

```sql
do $$
declare v_id uuid := current_setting('app.session_id');
begin
  begin
    perform * from public.session_member_ascents(v_id);   -- as a non-member
    raise exception 'FAIL: non-member read did NOT raise';
  exception when others then
    if sqlerrm like '%FAIL%' then raise; end if;           -- re-raise our own assert
    raise notice 'PASS non-member read refused';
  end;
end $$;
```

**4. Run it** by copying stub + migration + tests into the container and piping through `psql -v ON_ERROR_STOP=1`. Recreate the container between runs so state never leaks (a partial run that inserted rows will otherwise trip unique constraints on the next pass).

## Why This Matters

The load-bearing correctness of a social/multi-user Supabase app lives in RLS policies and `SECURITY DEFINER` RPCs, and those are invisible to a `tsc`/lint/unit-test pass — the client tests mock the database. Without a local harness the only "test" is applying to production and hoping. This harness caught nothing wrong on migration `0007` but *proved* all 18 privacy/liveness scenarios (non-member refusal, status-only board-scoped projection with marker rows, ended-session refusal on both live-gated RPCs, pure-read projection, no member-INSERT policy, owner-remove vs self-leave, cascade delete) — turning "I think the RLS is right" into evidence, which is the bar for a cross-user data path.

It also decouples verification from deployment: the migration is applied to the hosted project manually and **must be applied and verified before the client bundle calling its RPCs deploys**. The harness is where that verification happens.

## When to Apply

- Any change under `supabase/migrations/**` that adds/edits RLS policies, triggers, or `SECURITY DEFINER` functions — especially cross-user reads.
- Before opening a PR whose plan is tier "safety-critical" (BLE, board geometry, `supabase/migrations/**` per AGENTS.md).
- Not needed for pure client changes or migrations that only add owner-scoped columns with no policy/RPC logic.

## Examples

Runner shape (recreate container → apply → assert):

```bash
docker rm -f pgtest 2>/dev/null; docker run -d --name pgtest -e POSTGRES_PASSWORD=pw postgres:16
until docker exec pgtest pg_isready -U postgres; do sleep 1; done
docker cp 00_stub.sql pgtest:/tmp/;  docker cp 0007_....sql pgtest:/tmp/;  docker cp 99_tests.sql pgtest:/tmp/
docker exec pgtest psql -U postgres -q -v ON_ERROR_STOP=1 -f /tmp/00_stub.sql
docker exec pgtest psql -U postgres -q -v ON_ERROR_STOP=1 -f /tmp/0007_....sql   # "applies cleanly"
docker exec pgtest psql -U postgres -q -v ON_ERROR_STOP=1 -f /tmp/99_tests.sql   # PASS/FAIL notices
docker rm -f pgtest
```

Gotchas learned the hard way:
- **`current_user` is reserved** — use `app.uid` (or any non-reserved GUC name) for the per-test user.
- **`set role authenticated` is required** to exercise RLS at all — the superuser (the psql login role) bypasses RLS entirely, so setup done as superuser silently ignores policies.
- **`RETURNS TABLE` + `SECURITY DEFINER` plpgsql**: qualify every column reference (`m.user_id`, not `user_id`) and/or add `#variable_conflict use_column` to avoid OUT-parameter/column ambiguity errors.
- **Recreate the container per run** — `ON_ERROR_STOP=1` aborts mid-file on the first error, leaving seeded rows that break the next run's inserts.
- **Grants must mirror Supabase's defaults for the statement under test** (learned on 0017): real
  Supabase grants `authenticated` full table-level DML on `public` tables and lets **RLS** filter
  rows. If the harness only grants SELECT, a "non-owner member cannot UPDATE directly" assertion
  passes for the wrong reason (`insufficient_privilege` from the missing grant), never exercising
  the policy. Grant the verb the negative test needs, then assert the row *didn't change*.

### No Docker? Fallback: a scratch cluster on any local Postgres (verified on PG14)

On WSL, Docker Desktop may simply not be running and can't be started headlessly. The same
chain runs on a vanilla local Postgres with zero superuser access to any existing cluster —
`initdb` your own throwaway one (verified: the 0002→0007→stub_realtime→0017 chain + assertions
behave identically on Postgres 14 and 16):

```bash
PGBIN=/usr/lib/postgresql/14/bin
$PGBIN/initdb -D /tmp/scratch/data -U postgres --auth=trust
# Unix sockets cap the path at ~107 bytes — deep scratch dirs exceed it; use a short -k dir.
SOCK=$(mktemp -d /tmp/pgs.XXXX)
$PGBIN/pg_ctl -D /tmp/scratch/data -o "-p 55432 -k $SOCK -c listen_addresses=''" start
$PGBIN/psql -h "$SOCK" -p 55432 -U postgres -d app ...   # stub → chain → grants → assertions
$PGBIN/pg_ctl -D /tmp/scratch/data stop && rm -rf /tmp/scratch "$SOCK"
```

## Related

- `docs/collaboration-sessions.md` — the subsystem whose migration `0007` this harness verified (the status-only projection RPC + owner-only `ascents` RLS it must not relax).
- `docs/social-accounts-login-SETUP.md` — how migrations are actually applied to the hosted project (and the "apply before client deploy" ordering).
- `docs/solutions/architecture-patterns/offline-first-sync-swiftdata-supabase.md` — related Supabase area (offline sync), different concern.
