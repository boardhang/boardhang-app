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
  -- 0012 chain (0002 → 0007): the receive-auth assertions query realtime.messages as
  -- `authenticated`, and is_session_member reads session_members. RLS still gates rows.
  if to_regclass('public.session_members') is not null then
    execute 'grant select on public.sessions, public.session_members to anon, authenticated';
  end if;
  -- 0015 chain: the queue RLS assertions insert/select/update session_queue as `authenticated`.
  if to_regclass('public.session_queue') is not null then
    execute 'grant select, insert, update, delete on public.session_queue to anon, authenticated';
  end if;
  -- 0017 chain (keyed on its column, so earlier session chains keep their narrower grants):
  -- the direct-UPDATE assertion needs the table-level UPDATE grant real Supabase gives
  -- `authenticated`, so the owner-only RLS policy — not a missing grant — is what denies it.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'sessions'
               and column_name = 'lit_problem_id') then
    execute 'grant update on public.sessions to authenticated';
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

# 0012: session realtime — the ascents→broadcast fan-out trigger + private-channel receive
# authorization. Needs ascents (0002) + sessions/session_members/is_session_member (0007), and
# the realtime-schema stub applied before 0012 so realtime.messages exists for its policy.
run_case "$HERE/0012_session_realtime_rls.sql" \
  "$HERE/../0002_logbook_sync.sql" \
  "$HERE/../0007_collaboration_sessions.sql" \
  "$HERE/stub_realtime.sql" \
  "$HERE/../0012_session_realtime.sql"

# 0013: session membership realtime — the session_members join/leave trigger that broadcasts
# member-joined / member-left on the session:<id> channel. Same chain as 0012 (needs the
# realtime stub); reuses 0012's receive policy, so 0012 is in the chain too.
run_case "$HERE/0013_session_membership_realtime_rls.sql" \
  "$HERE/../0002_logbook_sync.sql" \
  "$HERE/../0007_collaboration_sessions.sql" \
  "$HERE/stub_realtime.sql" \
  "$HERE/../0012_session_realtime.sql" \
  "$HERE/../0013_session_membership_realtime.sql"

# 0014: session end realtime — the sessions soft-delete trigger that broadcasts session-ended.
# Needs sessions (0007) + the realtime stub; independent of 0012/0013 (emit-only test).
run_case "$HERE/0014_session_end_realtime_rls.sql" \
  "$HERE/../0002_logbook_sync.sql" \
  "$HERE/../0007_collaboration_sessions.sql" \
  "$HERE/stub_realtime.sql" \
  "$HERE/../0014_session_end_realtime.sql"

# 0015: session queue — the queue table + membership RLS + attribution pinning + the
# session-scoped reorder RPC + the queue-changed broadcast trigger. Needs sessions /
# session_members / is_session_member (0007), set_updated_at (0002), and the realtime stub
# (realtime.send) applied before 0015.
run_case "$HERE/0015_session_queue_rls.sql" \
  "$HERE/../0002_logbook_sync.sql" \
  "$HERE/../0007_collaboration_sessions.sql" \
  "$HERE/stub_realtime.sql" \
  "$HERE/../0015_session_queue.sql"

# 0016: cross-device session resume — list_my_live_sessions(), the membership-scoped, live-only,
# pure-read RPC that lets a second device discover the caller's resumable sessions. Needs sessions /
# session_members / is_session_member (0007); 0002 seeds the auth/profile substrate the chain
# assumes. No realtime stub (pure read, no broadcast).
run_case "$HERE/0016_session_resume_rls.sql" \
  "$HERE/../0002_logbook_sync.sql" \
  "$HERE/../0007_collaboration_sessions.sql" \
  "$HERE/../0016_session_resume.sql"

# 0017: session lit problem ("now on the wall") — the three sessions columns, the member-gated
# setter RPC (attribution pinning, no expiry bump, liveness guard), and the lit-changed broadcast
# trigger. Needs sessions / session_members / is_session_member (0007) + the realtime stub.
run_case "$HERE/0017_session_lit_problem_rls.sql" \
  "$HERE/../0002_logbook_sync.sql" \
  "$HERE/../0007_collaboration_sessions.sql" \
  "$HERE/stub_realtime.sql" \
  "$HERE/../0017_session_lit_problem.sql"

echo "✅ ALL RLS CASES PASSED"
