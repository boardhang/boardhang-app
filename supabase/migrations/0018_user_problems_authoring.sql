-- 0018_user_problems_authoring.sql
-- Problem authoring on the web (Phase A — private): let a signed-in user invent a problem in the
-- browser, on a specific board at a specific angle, and have it sync like any other logbook row.
-- The table already exists — 0002 created public.user_problems for the iOS logbook sync — so this
-- is an EXTENSION of that table, not a new one: it already has the right spine (client-generated
-- uuid PK, holds jsonb, the updated_at/deleted sync columns, the owner-only RLS quartet) and a live
-- FK from ascents.user_problem_id. A parallel table would fork the sync spine for no gain.
--
-- Scope: columns only. This migration makes NO policy change — the 0002 owner-only quartet stands,
-- so everything authored here is visible to its author and to nobody else. The public surface
-- (public read policy, publish-completeness constraint, per-user cap, attribution) is deliberately
-- deferred to 0019, so Phase A can teach us the shape is right before the production table grows a
-- cross-user read path. See docs/plans/2026-07-28-001-feat-web-problem-authoring-plan.md.
--
-- Design (KTD1/KTD2 of that plan):
--   • layout_id + angle are NULLABLE. Web-authored rows always carry both — a hold grid means
--     nothing without the board it was drawn on — but every row already in production came from
--     iOS, which never recorded either. A NOT NULL here would fail on apply (R14).
--   • visibility defaults to 'private' with a two-value CHECK. Existing rows adopt the default; no
--     retroactive flip, and no path in this migration publishes anything.
--   • source_catalog_id is a GENERATED ALWAYS … STORED column, 'user:' || id. Every downstream
--     surface (ascents.source_catalog_id, session_queue, sessions.lit_problem_id, the client's
--     getCatalogProblemsByIds) already stores a bare TEXT problem id, so user problems join that
--     one lane instead of forcing dual-lane handling everywhere. The 'user:' prefix cannot collide
--     with the UUIDv5 catalog ids, and the whole value is 41 chars — inside the 64-char
--     sessions.lit_problem_id cap (0017). Generated rather than written: it cannot drift from the
--     PK, and PostgREST treats it as read-only, so no write path can round-trip it.
--   • NO name/holds constraints here. Legacy rows have empty names and empty hold arrays; every
--     completeness rule is a publish-time rule and belongs with the public path in 0019 (R14).
--
-- updated_at: unchanged. The 0002 user_problems_set_updated_at trigger and public.set_updated_at()
-- already stamp every write; generated columns are computed after BEFORE triggers, so they compose.
--
-- Apply-time note: adding a STORED generated column rewrites the table (ACCESS EXCLUSIVE), unlike
-- the three plain ADD COLUMNs above it. user_problems is small (per-user hand-authored rows), so
-- this is a brief lock, not a maintenance window.

-- ─────────────────────────────────────────────────────────────────────────────
-- Board scoping. A problem is a set of holds ON a specific layout at a specific angle; without
-- both, the client cannot render it or decide whether it belongs in the current slab.
alter table public.user_problems add column if not exists layout_id int;
alter table public.user_problems add column if not exists angle     int;

comment on column public.user_problems.layout_id is
    'MoonBoard layout the problem was authored on. Null on legacy iOS-created rows, which recorded no board.';
comment on column public.user_problems.angle is
    'Board angle (degrees) the problem was authored at. Null on legacy iOS-created rows.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Sharing intent. Private is the default and the only state 0018 can actually serve — the value
-- 'public' is accepted here so the client can store the intent, but until 0019 adds a public read
-- policy no other user can read such a row.
alter table public.user_problems add column if not exists visibility text not null default 'private';

alter table public.user_problems drop constraint if exists user_problems_visibility_valid;
alter table public.user_problems add constraint user_problems_visibility_valid
    check (visibility in ('private', 'public'));

comment on column public.user_problems.visibility is
    'Sharing intent: private (default, owner-only) or public. 0018 ships no public read policy — that is 0019.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The single text-id lane. Read-only by construction: GENERATED ALWAYS rejects any supplied value,
-- so the id a user problem is referenced by can never diverge from its primary key.
alter table public.user_problems add column if not exists source_catalog_id text
    generated always as ('user:' || id::text) stored;

comment on column public.user_problems.source_catalog_id is
    'Stable text id ("user:" || id) that user problems share with catalog problems, so ascents / queues / lit-problem pointers store one kind of id. Generated — never written.';

create unique index if not exists user_problems_source_catalog_id_key
    on public.user_problems (source_catalog_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: no change needed. user_problems already FKs auth.users ON DELETE CASCADE
-- (0002), so the 0001 public.delete_user() sweeps these rows — new columns and all.
--
-- Manual step (no SQL equivalent): apply 0018 AND 0019, in that order, to the Supabase project (SQL
-- Editor → paste + Run, or `supabase db push`) BEFORE deploying this branch's client bundle. They
-- are one deploy unit, not two independent steps: 0018 alone unblocks nothing, because the client's
-- shared column list names setter_user_id / setter_handle — 0019 columns — so on a 0018-only project
-- EVERY user_problems query fails with 42703 (undefined_column), not just the publish path. 0019's
-- own footer carries the rest of the ordering it needs (it must land before the bundle that
-- publishes, and it retracts any row already marked public).
--
-- 0018 itself is additive and changes no policy, so the shipped iOS client keeps syncing across it
-- unchanged. See docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────
