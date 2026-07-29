-- Test fixture, NOT a migration. Seeds a pre-0018 (iOS-era) public.user_problems row so the 0018
-- case applies that migration to a table which ALREADY HOLDS legacy data — chained BETWEEN 0002
-- and 0018 in run_rls_test.sh (same idiom as stub_realtime.sql sitting mid-chain).
--
-- This is what makes R14 testable rather than aspirational: `alter table … add column visibility
-- not null default 'private'`, the visibility CHECK, and the generated source_catalog_id column
-- all have to survive contact with rows that predate them (empty name, null layout + angle), and
-- the generated column has to BACKFILL them. Applying 0018 to an empty table proves none of that.
--
-- Runs as superuser, before the assertions file creates its own users, so its ids are deliberately
-- disjoint from the ones there.
\set LU '99999999-9999-9999-9999-999999999999'
\set LP 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

insert into auth.users (id) values (:'LU');

-- Exactly the shape 0002 allowed a client to write: id + owner, nothing else. name/grade default
-- to '', holds to '[]' — i.e. the "empty name, no layout/angle" legacy row R14 names.
insert into public.user_problems (id, user_id) values (:'LP', :'LU');
