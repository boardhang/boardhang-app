---
title: Refresh the MoonBoard 2024 40° catalog without duplicating renamed problems - Plan
type: fix
date: 2026-10-08
topic: catalog-2024-benchmark-refresh
execution: code
---

# Refresh the MoonBoard 2024 40° catalog without duplicating renamed problems - Plan

## Goal

Bring the **MoonBoard 2024 @ 40°** slab up to date with boardsesh — 39 benchmarks promoted since
the 2026-07-08 snapshot (23 brand-new problems, 16 existing problems newly flagged), 372
problems that crossed the "repeats ≥ 10" floor, 12 regrades, fresh repeat counts — **without
inserting duplicate rows for problems boardsesh has renamed**. Tier: **Standard** (scripts +
staging data; no migration, no client code).

## What was verified (2026-10-08, live boardsesh vs prod Supabase)

- Live benchmark list: 468 at 40° vs 429 flagged in prod. 25°: 41 = 41, nothing to do.
- Every one of the 5,486 existing 40° rows has **identical holds** on boardsesh — user data
  (ascents, lists, session queue, `lit_problem_id`) references problems by `source_catalog_id`
  and nothing it points at moves.
- **97 of the fetch's 469 "new" uuids are renames**: boardsesh derives uuids from the name, and
  it re-cased 93 names (`'BINGO'` → `'Bingo'`) and retitled 4 (`'OAKTAPUS'` → `'plaktipus'`).
  Each matches exactly one prod row by hold geometry, and that prod row is itself absent from
  the fresh fetch. A plain `import_catalog.py` would insert them beside the old rows: the same
  problem twice in the catalog, with only the old copy carrying ascents. None are benchmarks.
- Prod's one tombstoned 40° row (KRUSE) is not in the fetch — untouched either way.
- Side effects of the import, both intended: the 0018 trigger writes 39 `benchmark_events`
  (in-app "new benchmarks" banner; no push drain exists), and the upsert re-stamps
  `updated_at` on every row so clients re-pull the slab once.

## Units

1. **`scripts/reconcile_catalog_renames.py`** — rewrite a staged slab so renamed problems keep
   prod's uuid. For each staged problem whose id is not live, find live rows with the same
   `(c, r, t)` hold set that are *not* in the staged set. Identical holds alone aren't proof
   (a deleted problem can be re-set by someone else — and the uuid is a function of name *and*
   setter, so a setter edit re-keys too), so a match also needs evidence it's the same record,
   strongest first: same name (case/whitespace-insensitive), same setter, or — only with
   `--trust-repeats` — a carried-over ascent count. Claims are settled per hold set strongest
   evidence first so a rename beats a new copy of the same holds; ties, no-evidence matches and
   tombstoned counterparts are reported, never merged. `import_catalog.py` refuses a slab with
   anything outstanding (`--skip-rename-check` for a brand-new slab). Pure core, unit-tested
   (`scripts/tests/test_reconcile_catalog_renames.py`); PostgREST reads paged past the 1000-row
   clamp like `prune_catalog_orphans.py`; setters are stripped at fetch and import.
2. **Staging data** — re-fetch `catalog-data/moonboard2024_40.json` under the usual curation rule
   and run the reconcile against prod before committing it. 25° is **not** re-fetched (all 41
   benchmarks were re-cased; nothing new there).
3. **Docs** — `docs/catalog-data-pipeline.md`: the new step between fetch and import, and the
   rename gotcha.
4. **Import (operator, after merge)** — `backup_catalog_problems.py` → `import_catalog.py
   --layout 3 --angle 40`. **No prune**: the 97 old-uuid rows are now the staged rows, and the
   remaining absent rows are the tombstone. Expected after: 5,859 rows, 468 benchmarks,
   41 `benchmark_events` on (3, 40).

## Out of scope

- A push drain for `benchmark_events` (never built; not needed for the banner).
- Refreshing other boards. The same reconcile step applies when they are.
