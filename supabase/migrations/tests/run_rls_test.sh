#!/usr/bin/env bash
# Exercise migration RLS on a throwaway Postgres (docker) — no local Supabase stack
# needed. For each test case: stub the Supabase auth+storage+profiles schema
# (stub_supabase.sql), apply the migration chain in order, grant public-table access to
# anon/authenticated exactly as Supabase's defaults do (RLS then gates rows), and run the
# case's cross-user assertions on its own fresh database (so cases can't collide on the
# fixed user UUIDs they seed).
#
# Usage:  supabase/migrations/tests/run_rls_test.sh
# Exit 0 = every case passed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE="postgres:16-alpine"

# run_case <assertion-file> <migration.sql> [<migration.sql> …]
# Applies the listed migrations (in order) on a fresh container, then runs the assertions.
run_case() {
  local assertions="$1"; shift
  local migrations=("$@")
  local container="mb-rls-test-$$-$(basename "$assertions" .sql)"

  cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
  trap cleanup RETURN

  echo "── case: $(basename "$assertions")"
  echo "→ starting throwaway postgres ($IMAGE)…"
  docker run -d --name "$container" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=app "$IMAGE" >/dev/null

  for _ in $(seq 1 30); do
    if docker exec "$container" pg_isready -U postgres -d app >/dev/null 2>&1; then break; fi
    sleep 0.5
  done

  local psql_in=(docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d app)

  echo "→ loading Supabase schema stub…"
  "${psql_in[@]}" < "$HERE/stub_supabase.sql"

  local mig
  for mig in "${migrations[@]}"; do
    echo "→ applying $(basename "$mig")…"
    "${psql_in[@]}" < "$mig"
  done

  echo "→ granting public-table access to anon/authenticated (mirrors Supabase defaults)…"
  "${psql_in[@]}" <<'SQL'
grant select, insert, update, delete on public.profiles to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
-- Grant migration-created public tables only when the applied chain created them, so a
-- single-migration case (e.g. 0010 alone) doesn't fail granting a table it never made.
do $$
begin
  if to_regclass('public.logbook_imports') is not null then
    execute 'grant select, insert, update, delete on public.logbook_imports to anon, authenticated';
  end if;
  if to_regclass('public.problem_beta_videos') is not null then
    execute 'grant select, insert, update, delete on public.problem_beta_videos to anon, authenticated';
  end if;
end $$;
SQL

  echo "→ running RLS assertions…"
  "${psql_in[@]}" < "$assertions"

  echo "✅ $(basename "$assertions") passed"
  echo
  cleanup
  trap - RETURN
}

# 0008: logbook-imports bucket (applied alone — its delete_user() sweeps only logbook).
run_case "$HERE/0008_logbook_imports_rls.sql" "$HERE/../0008_logbook_imports.sql"

# 0009: avatars bucket + avatar_url CHECK + extended delete_user(). Needs the 0008 → 0009
# chain so the final delete_user() (both sweeps) and both buckets exist.
run_case "$HERE/0009_avatars_rls.sql" "$HERE/../0008_logbook_imports.sql" "$HERE/../0009_avatars.sql"

# 0010: beta videos — public approved-only read + Phase-1 write-closed + partial dedupe index.
# Independent of the logbook/avatars chain, so it applies alone.
run_case "$HERE/0010_problem_beta_videos_rls.sql" "$HERE/../0010_problem_beta_videos.sql"

# 0011: beta USER submissions — the authenticated INSERT clamp, video_id CHECK, per-user pending
# cap, and the source-filtered notification trigger. Alters the 0010 table, so it applies the
# 0010 → 0011 chain.
run_case "$HERE/0011_beta_user_submissions_rls.sql" \
  "$HERE/../0010_problem_beta_videos.sql" "$HERE/../0011_beta_user_submissions.sql"

echo "✅ ALL RLS CASES PASSED"
