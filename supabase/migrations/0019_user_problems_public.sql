-- 0019_user_problems_public.sql
-- Problem authoring, Phase B — the public path. 0018 gave public.user_problems the authoring
-- columns (layout_id/angle/visibility, the generated 'user:<id>' identity lane) but deliberately
-- shipped NO public read policy: everything authored so far is owner-only. This migration opens
-- that seam, and it is the first time in this schema that one user's row becomes readable by
-- another user — so the read policy arrives together with every guard that has to hold the moment
-- it does. See docs/plans/2026-07-28-001-feat-web-problem-authoring-plan.md (KTD6/KTD7, R11–R14).
--
-- Five pieces, in the order they must be created:
--   1. Attribution columns (setter_user_id + denormalized setter_handle). Server-owned; see 3.
--   2. A retraction sweep of any pre-0019 visibility='public' row, then the public-completeness
--      CHECK. 0018 accepted 'public' as a VALUE while granting it no reader, so rows may already
--      carry the intent without ever having passed a completeness or attribution check. Flipping
--      them back to private is the conservative reading of R14: the read policy at the bottom of
--      this file must not silently publish a row that was never checked.
--   3. A SECURITY DEFINER BEFORE INSERT OR UPDATE trigger that OWNS the two attribution columns.
--      On a live-public write it stamps setter_user_id = auth.uid() and setter_handle from the
--      caller's own profile, REFUSING the write when that profile (or its handle) is missing — the
--      server-side backstop for AE3, so the client's "pick a handle first" prompt is a convenience,
--      not the enforcement. On any other write it CLEARS both columns. Overwrite rather than a
--      WITH CHECK pin, following 0011's clamp philosophy: a client that sends a forged setter is
--      corrected, not rejected, and there is no shape of client write that can leave a false
--      attribution on a readable row.
--   4. A per-user cap on LIVE PUBLIC problems, as a SECURITY DEFINER trigger taking a per-user
--      transaction advisory lock. Unlike 0011's INSERT-only cap this fires on INSERT **or**
--      UPDATE — publishing here is normally a private→public UPDATE, and an INSERT-only cap is
--      trivially bypassed by bulk-flipping. The row's own id is excluded from the count, so
--      re-saving an already-published problem at the cap cannot fail.
--   5. The public read policy itself, `to anon, authenticated` — matching catalog_problems (0006)
--      and problem_beta_videos (0010), because signed-out catalog browsing must keep working. The
--      0002 owner-only quartet is untouched and still supplies every write path; a permissive
--      SELECT policy ORs with the owner SELECT, and gives UPDATE/DELETE nothing.
--
-- "Live public" (visibility = 'public' and not deleted) is the single predicate all five share:
-- it gates the read policy, the completeness CHECK, the attribution stamp and the cap. A tombstone
-- is therefore unconstrained and unattributed on purpose — nobody can read it, and a setter who
-- deleted their own profiles row must still be able to take their published work down.
--
-- Not here, on purpose: no moderation/report table and no admin flag. Takedown is a service-role
-- runbook (docs/catalog-data-pipeline.md) — `update public.user_problems set visibility='private'`
-- by source_catalog_id — which needs no schema.
--
-- Known accepted risk (Scope Boundaries in the plan): the shipped iOS client pulls this table
-- unfiltered and would ingest other users' public rows as if they were its own. iOS is dormant and
-- not being released; the web PWA is the only active client.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Attribution. setter_user_id is authoritative; setter_handle is a denormalized copy that
-- exists solely because public.profiles is readable `to authenticated` only — an anon visitor
-- browsing the catalog can read the problem but never the profile behind it.
--
-- ON DELETE SET NULL rather than CASCADE: user_problems already cascades from auth.users via
-- user_id (0002), so a deleted account's rows are swept anyway; the SET NULL is what keeps this FK
-- from being a second, redundant delete path.
alter table public.user_problems add column if not exists setter_user_id uuid
    references auth.users (id) on delete set null;
alter table public.user_problems add column if not exists setter_handle text;

comment on column public.user_problems.setter_user_id is
    'Authoritative author of a public problem, stamped by trigger from auth.uid(). Null unless the row is live public. Never written by clients.';
comment on column public.user_problems.setter_handle is
    'Denormalized public.profiles.handle of the setter, so anon readers can attribute a public problem without reading profiles. Re-stamped when the setter renames their handle. Never written by clients.';

create index if not exists user_problems_public_slab_idx
    on public.user_problems (layout_id, angle, updated_at)
    where visibility = 'public' and deleted = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Retract-then-constrain. Any row already marked 'public' predates every guard below and was
-- never readable by anyone, so it goes back to private rather than becoming visible the instant
-- the policy lands. This runs BEFORE the triggers exist, so it is a plain data fix — it bumps
-- updated_at through the 0002 trigger, which is exactly what makes the author's own client notice.
--
-- `setter_user_id is null` is what keeps this re-runnable: after a successful apply every LIVE
-- public row is attributed (the CHECK below makes that an invariant), so a second run sweeps
-- nothing. Tombstones are excluded for the same reason they are excluded everywhere else — their
-- visibility is inert, and flipping it would churn updated_at on rows nobody can read.
update public.user_problems set visibility = 'private'
    where visibility = 'public' and not deleted and setter_user_id is null;

-- Holds shape. A CHECK cannot contain a subquery, so the per-element rules live in an IMMUTABLE
-- function (the only kind a CHECK may call). plpgsql with an explicit loop rather than a SQL
-- `not exists (…)`: several of the rules are only safe once the element is known to be an object
-- (jsonb_object_keys errors on a scalar), and AND-ordering inside a WHERE clause is a planner
-- decision, not a guarantee.
--
-- Bounds, measured against catalog-data/ (75,124 official problems): the densest problem uses 28
-- holds, columns run 0–10 and rows 1–18. 60 holds is therefore >2x anything the official catalog
-- contains while still bounding the payload (~2 KB), and 0–63 is a sanity floor/ceiling far outside
-- any real board — both reject abuse, neither can reject a problem a person actually drew.
--
-- search_path is pinned empty: every function and operator used below lives in pg_catalog, which is
-- always implicitly searched, so nothing here can be shadowed by a schema a caller controls.
create or replace function public.user_problem_holds_valid(_holds jsonb)
    returns boolean
    language plpgsql
    immutable
    set search_path = ''
as $$
declare _e jsonb; _n int;
begin
    if _holds is null or jsonb_typeof(_holds) <> 'array' then
        return false;
    end if;
    _n := jsonb_array_length(_holds);
    if _n < 1 or _n > 60 then
        return false;
    end if;
    for _e in select value from jsonb_array_elements(_holds) loop
        if jsonb_typeof(_e) <> 'object' then
            return false;
        end if;
        -- Exactly {c, r, t}: extra keys are how an otherwise-valid holds array becomes an
        -- unbounded blob, since the 60-element cap says nothing about per-element size.
        if (select count(*) from jsonb_object_keys(_e)) <> 3
           or not (_e ? 'c' and _e ? 'r' and _e ? 't') then
            return false;
        end if;
        if jsonb_typeof(_e -> 'c') <> 'number' or jsonb_typeof(_e -> 'r') <> 'number' then
            return false;
        end if;
        -- jsonb-to-jsonb comparison, so a non-number would have been rejected above and this can
        -- never raise on a bad cast.
        if _e -> 'c' < '0'::jsonb or _e -> 'c' > '63'::jsonb
           or _e -> 'r' < '0'::jsonb or _e -> 'r' > '63'::jsonb then
            return false;
        end if;
        if jsonb_typeof(_e -> 't') <> 'string'
           or (_e ->> 't') not in ('start', 'left', 'right', 'match', 'end') then
            return false;
        end if;
    end loop;
    return true;
end $$;

comment on function public.user_problem_holds_valid(jsonb) is
    'True when holds is an array of 1-60 {c,r,t} objects with numeric in-range coordinates and a known role. IMMUTABLE so the public-completeness CHECK can call it.';

-- Public-completeness. Every clause hangs off "live public", so a private row and a tombstone stay
-- exactly as writable as they were in 0018 — which is what keeps the iOS-era rows (empty name, null
-- layout/angle, '[]' holds) legal (R14). Added NOT VALID then validated, as in 0011, so the ADD
-- takes only a brief lock and a re-run after a partial apply is clean.
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'user_problems_public_complete') then
        alter table public.user_problems
            add constraint user_problems_public_complete
            check (
                visibility = 'private' or deleted
                or (
                    layout_id is not null
                    and angle is not null
                    and name <> ''
                    and char_length(name) <= 60
                    and setter_user_id is not null
                    and setter_handle is not null
                    and public.user_problem_holds_valid(holds)
                )
            ) not valid;
    end if;
end $$;
alter table public.user_problems validate constraint user_problems_public_complete;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Attribution stamp. SECURITY DEFINER because it must read public.profiles rows the calling
-- user may not be able to see, and because the invariant it enforces cannot depend on the caller's
-- privileges.
--
-- auth.uid() null means this is a service-role / owner write (the takedown runbook, a data fix, or
-- the profiles re-stamp trigger below when an admin renames someone). Those bypass RLS anyway, so
-- the trigger passes them through unchanged rather than pretending to police a caller it cannot
-- identify; the CHECK constraint above still refuses an unattributed live public row. No client
-- path reaches this branch: anon has no INSERT/UPDATE policy, and authenticated always has a uid.
create or replace function public.stamp_user_problem_setter()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''   -- pin search_path (advisor hardening, as in 0002); every reference below is schema-qualified
as $$
declare _uid uuid; _handle text;
begin
    _uid := auth.uid();
    if _uid is null then
        return new;
    end if;

    if new.visibility = 'public' and not new.deleted then
        select p.handle::text into _handle from public.profiles p where p.id = _uid;
        if _handle is null or _handle = '' then
            raise exception
                'Pick a profile handle before publishing a problem — a public problem is credited to its setter.';
        end if;
        new.setter_user_id := _uid;
        new.setter_handle  := _handle;
    else
        -- Private again, or tombstoned: the columns are server-owned, so they go back to empty
        -- rather than keeping a value the server would no longer stand behind.
        new.setter_user_id := null;
        new.setter_handle  := null;
    end if;
    return new;
end $$;

drop trigger if exists user_problems_stamp_setter on public.user_problems;
create trigger user_problems_stamp_setter
    before insert or update on public.user_problems
    for each row execute function public.stamp_user_problem_setter();

-- Handle renames. The denormalized copy has to follow the setter's live handle, or a rename would
-- leave stale credit — and, once the freed handle is claimed by someone else, credit pointing at a
-- completely different person. Scoped to live public rows: a tombstone or a private row carries no
-- attribution to refresh, and re-stamping them would churn updated_at for rows no one can read.
-- The UPDATE deliberately bumps updated_at (via 0002's trigger), which is what makes other devices
-- pull the new handle on their next sync.
create or replace function public.restamp_user_problem_setter_handle()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''   -- pin search_path (advisor hardening, as in 0002); every reference below is schema-qualified
as $$
begin
    update public.user_problems
       set setter_handle = new.handle::text
     where setter_user_id = new.id
       and visibility = 'public'
       and not deleted
       and setter_handle is distinct from new.handle::text;
    return null;
end $$;

drop trigger if exists profiles_restamp_setter_handle on public.profiles;
create trigger profiles_restamp_setter_handle
    after update of handle on public.profiles
    for each row when (new.handle is distinct from old.handle)
    execute function public.restamp_user_problem_setter_handle();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Per-user cap on live public problems.
--
-- 50: hand-authoring a problem means drawing a hold set in the editor, so 50 live publications is
-- far above any genuine rate while bounding one scripted account's contribution to a shared catalog
-- that already holds ~12k official rows for the active boards. It is a ceiling on LIVE rows, not a
-- lifetime quota — retracting or deleting frees a slot immediately.
--
-- The lock key is a named function so the trigger and anything that later publishes on a user's
-- behalf cannot drift apart on it, and so the key is salted away from 0011's per-user cap (which
-- hashes the bare uuid) — two unrelated caps sharing a key would make them contend for no reason.
create or replace function public.user_problem_public_cap_lock_key(_user_id uuid)
    returns bigint
    language sql
    immutable
    set search_path = ''
as $$ select pg_catalog.hashtextextended('user_problems_public:' || _user_id::text, 0) $$;

comment on function public.user_problem_public_cap_lock_key(uuid) is
    'Advisory-lock key serializing one user''s publishes, so two concurrent transitions into public cannot both read a pre-cap count.';

create or replace function public.enforce_user_problem_public_cap()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''   -- pin search_path (advisor hardening, as in 0002); every reference below is schema-qualified
as $$
declare _live int;
begin
    -- Serialize this user's publishes. Under READ COMMITTED two concurrent flips would each count
    -- the same pre-commit total and both pass — the exact scripted-flood adversary the cap exists
    -- to stop. A per-user xact advisory lock queues them; different users never contend.
    perform pg_advisory_xact_lock(public.user_problem_public_cap_lock_key(new.user_id));

    -- The row's own id is excluded, so this counts "how many OTHER live public problems would this
    -- row join". Without it, re-saving an already-published problem would start failing the moment
    -- a setter filled their quota.
    select count(*) into _live
    from public.user_problems
    where user_id = new.user_id
      and visibility = 'public'
      and not deleted
      and id <> new.id;

    if _live >= 50 then
        raise exception
            'Public problem limit reached: % already published (max 50). Make one private or delete it before publishing another.',
            _live;
    end if;
    return new;
end $$;

drop trigger if exists user_problems_public_cap on public.user_problems;
create trigger user_problems_public_cap
    before insert or update on public.user_problems
    for each row when (new.visibility = 'public' and new.deleted = false)
    execute function public.enforce_user_problem_public_cap();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The public read policy. Permissive, so it ORs with the 0002 owner SELECT: an owner keeps
-- reading their own private rows and tombstones (the sync spine needs both), while everyone else
-- sees live public rows and nothing more. `to anon` is deliberate and matches catalog_problems
-- (0006) — a signed-out visitor browsing a board must see the same catalog a signed-in one does.
--
-- No new write policy: INSERT/UPDATE/DELETE stay owner-only (0002), so reading someone's problem
-- never becomes a way to edit it.
drop policy if exists "Anyone reads live public user problems" on public.user_problems;
create policy "Anyone reads live public user problems"
    on public.user_problems for select to anon, authenticated
    using (visibility = 'public' and deleted = false);

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: unchanged. user_problems still cascades from auth.users via user_id (0002), so
-- public.delete_user() (0001) removes a departing user's published problems along with everything
-- else. The setter_user_id FK is ON DELETE SET NULL and never gets the chance to fire.
--
-- Manual step (no SQL equivalent): apply this migration to the Supabase project (SQL Editor →
-- paste + Run, or `supabase db push`) BEFORE deploying the client bundle that publishes problems.
-- Note that applying it RETRACTS any row already carrying visibility='public' (see 2 above) — on a
-- dev project where Phase A was exercised, expect to re-publish those by hand. See
-- docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────
