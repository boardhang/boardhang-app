#!/usr/bin/env bash
# Exercise 0008_logbook_imports.sql RLS on a throwaway Postgres (docker) — no local
# Supabase stack needed. Stubs the Supabase auth+storage schema (stub_supabase.sql),
# applies the migration, grants public-table access to anon/authenticated exactly as
# Supabase's defaults do (RLS then gates rows), and runs the cross-user assertions.
#
# Usage:  supabase/migrations/tests/run_rls_test.sh
# Exit 0 = all assertions passed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../0008_logbook_imports.sql"
CONTAINER="mb-rls-test-$$"
IMAGE="postgres:16-alpine"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ starting throwaway postgres ($IMAGE)…"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=app "$IMAGE" >/dev/null

# Wait for readiness.
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d app >/dev/null 2>&1; then break; fi
  sleep 0.5
done

psql_in() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d app "$@"; }

echo "→ loading Supabase schema stub…"
psql_in < "$HERE/stub_supabase.sql"

echo "→ applying migration 0008…"
psql_in < "$MIG"

echo "→ granting public-table access to anon/authenticated (mirrors Supabase defaults)…"
psql_in <<'SQL'
grant select, insert, update, delete on public.logbook_imports to anon, authenticated;
grant select, insert, update, delete on storage.objects       to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
SQL

echo "→ running RLS assertions…"
psql_in < "$HERE/0008_logbook_imports_rls.sql"

echo "✅ RLS test passed"
