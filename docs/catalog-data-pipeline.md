# Catalog Data Pipeline

How official MoonBoard problems get from the boardsesh API into **Supabase**, and from there
synced down and cached by each client (iOS, PWA, future Android) — and how to regenerate or add
a board. Pairs with [`../CONTEXT.md`](../CONTEXT.md) §"Importing official problems". Official
problems are only one of two sources — see §"The second source: user-authored problems" for the
client-written lane and its takedown runbook.

The catalog is **server-distributed**, not bundled: clients no longer ship the problem JSON.
They download it lazily per board into a local cache and query it locally, so every client stays
in sync instead of drifting on divergent bundles. See migration `supabase/migrations/0006_catalog_problems.sql`.

**Key files:** `scripts/fetch_boardsesh*.py` (fetch) + `scripts/enrich_catalog_methods.py`
(backfill the `method` field onto existing staging JSON without re-fetching) +
`scripts/import_catalog.py` (upload to Supabase) + `scripts/{backup,restore}_catalog_problems.py`
(dump / roll back the table) + `scripts/prune_catalog_orphans.py` (soft-delete removed rows),
`MoonBoardLED/Catalog/Catalog.swift` (synced disk cache + loading),
`MoonBoardLED/Services/Supabase/CatalogSyncManager.swift` (iOS pull),
`web/src/catalog/catalogSync.ts` (PWA pull + the read-time merge),
`web/src/catalog/userProblemsSync.ts` (the user-authored lane),
`MoonBoardLED/Board/HoldSetMembership.swift`.

## Data flow

```
boardsesh GraphQL API  (https://ws.boardsesh.com/graphql, public, no auth)
    │
    ├─ scripts/fetch_boardsesh_mini2025.py ─┐
    └─ scripts/fetch_boardsesh.py ──────────┴─► catalog-data/<slug>_<angle>.json   (staging)
                                                     │
                          scripts/import_catalog.py  │  (service-role key; upsert on source_catalog_id)
                                                     ▼
                                    Supabase  public.catalog_problems   (source of truth)
                                                     │
                       download-and-cache, lazy per (layout_id, angle) slab, updated_at > cursor
                          ┌──────────────────────────┼───────────────────────────┐
                          ▼                                                        ▼
   iOS: CatalogSyncManager → Application Support/CatalogCache/*.json     PWA: catalogSync.ts → IndexedDB
        Catalog.swift (JSONSerialization fast path over the cached slab)
                          ▼
        CatalogListView / CatalogProblemDetailView  (Search tab)  →  lights on device via BLE

    scripts/derive_holdset_membership.py ──► MoonBoardLED/Resources/<Board>HoldSets.json  (still bundled)
    scripts/import_board_images.py ────────► MoonBoardLED/Assets.xcassets/Boards/<folder>/*.png
        HoldSetMembership.swift (membership lookup by "col-row")
```

Two directories, two roles:
- **`catalog-data/`** — staging output of the fetch scripts for all boards/angles. The input to
  `import_catalog.py`.
- **`MoonBoardLED/Resources/`** — **no longer holds catalogs** (they're server-distributed now).
  Still holds the `*HoldSets.json` files and other bundled assets.

## File naming conventions

The catalog resource base name (from `Board.catalogResource(angle:)`) is still the identity of a
board+angle "slab" — it's now the **cache filename** (`Application Support/CatalogCache/<name>.json`
on iOS) rather than a bundled resource:

- **Single-angle** (Mini 2025 only, 40°): `MiniMoonBoard2025Catalog` — no angle suffix.
- **Multi-angle**: `<Name>Catalog_<angle>`, e.g. `MoonBoardMasters2019Catalog_40`. `_25` and `_40`
  are the wall angle in degrees.
- **Hold sets** (still bundled): `<Name>HoldSets.json`, e.g. `MiniMoonBoard2025HoldSets.json`.

## JSON schemas

### Catalog file

```jsonc
{
  "setup": "Mini MoonBoard 2025",
  "holdsetup": 22,        // optional; the active hold-set id (Mini catalogs)
  "layoutId": 5,          // optional; present in catalog-data staging, dropped from bundled files
  "angle": 40,            // wall angle, degrees
  "source": "boardsesh (ws.boardsesh.com/graphql)",
  "count": 4889,
  "problems": [
    {
      "id": "fdac08b2-…",   // UUIDv5, globally unique per (board, angle) — the catalog_problems PK
      "name": "…",
      "grade": "6A+",        // Font grade
      "userGrade": null,     // ignored by the app
      "setter": "mb_…",
      "stars": 5,            // rating 0–5
      "repeats": 28,         // ascent count
      "isBenchmark": false,
      "method": null,        // foot rule: "No kickboard" / "Footless" / "Footless + kickboard", else null
      "holds": [ { "c": 2, "r": 12, "t": "end" }, { "c": 5, "r": 5, "t": "start" } ]
    }
  ]
}
```

Hold encoding inside `holds`: `c` = column 0–10 (A–K), `r` = row (1 = bottom), `t` = type. **boardsesh
collapses hand holds**, so imported types are effectively `start` / `right` / `end` only (this is
why "beta" mode in the app has nothing finer to show for catalog problems).

### HoldSets file

```jsonc
{
  "sets": [ { "id": 28, "name": "Hold Set F" }, { "id": 29, "name": "Original School Holds" } ],
  "membership": { "0-1": 30, "0-10": 29, "0-12": 28 }   // "col-row" → owning set id
}
```

- `"col-row"` keys: col 0–10, row 1 = bottom (matches [board-geometry.md](board-geometry.md)).
- A set with **zero** membership entries is "always-on" (feet/art) — rendered but not filterable.
  See [multi-board-model.md](multi-board-model.md) §"Hold-set membership".

## Regenerating / adding a board

```bash
# 1. Fetch problems into the catalog-data/ staging area.
#    Curation rule for the committed snapshots: "benchmark OR repeats >= 10" — pass BOTH
#    flags; fetch_boardsesh.py UNIONS them (the benchmark flag alone misses popular problems).
python3 scripts/fetch_boardsesh.py --layout 5 --angle 40 --benchmarks-only --min-ascents 10
#   other flags: --all  --delay 0.25  --out-dir <path>.  (--min-ascents is inclusive: 10 → >=10.)

# 1b. (Optional) instead of re-fetching, ADD `method` to existing snapshots by uuid without
#     reshaping them: python3 scripts/enrich_catalog_methods.py

# 2. BACK UP the current table first — the import upserts in place with no row history.
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  python3 scripts/backup_catalog_problems.py                # -> catalog_problems_backup_<ts>.json

# 3. Upload the staged JSON to Supabase (idempotent upsert on source_catalog_id).
#    Needs the SERVICE-ROLE key (bypasses RLS) — never ship it in a client.
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  python3 scripts/import_catalog.py --all                   # or --layout 5 --angle 40

# 3b. Reconcile: soft-delete rows no longer in staging (the upsert never removes any).
#     Dry-run by default; --apply writes. Guards refuse to tombstone a slab whose staged
#     set is empty or whose orphan share exceeds --max-orphan-fraction (0.20) — override
#     with --force once you've confirmed the dry-run counts look right.
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  python3 scripts/prune_catalog_orphans.py --all            # add --apply to write

# Rollback (if an import/prune went wrong): restore the pre-import backup verbatim,
# including `deleted` (un-tombstones a bad prune).
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  python3 scripts/restore_catalog_problems.py catalog_problems_backup_<ts>.json

# 4. Derive hold-set membership (needs Pillow: pip install Pillow)
python3 scripts/derive_holdset_membership.py                # scans its BOARDS list → *HoldSets.json (bundled)

# 5. (New board only) import board art
python3 scripts/import_board_images.py [--src /path/to/boardsesh]

# 6. Register the board in Swift: add to Board.all in MoonBoardLED/Board/Board.swift
#    (and a MoonBoardSetup in MoonBoardSetup.swift if geometry differs). Clients then sync the
#    board's slab from Supabase the first time it's added/opened — no rebuild needed to ship data.
```

`derive_holdset_membership.py` samples each hold-set overlay PNG's alpha channel (threshold ~60) to
decide which grid positions a set owns; that's why it needs the imported board art present first.

## PWA cache durability and repair

`web/src/catalog/catalogSync.ts` pages a slab down 1000 rows at a time and **commits each page as
it arrives** — one IndexedDB transaction per page, advancing the `catalogCursor.<layout>_<angle>`
high-water mark to that page's newest `updated_at`. Consequences worth keeping:

- A pull that dies partway (flaky radio, 5xx, timeout, storage quota) leaves a **shorter** slab,
  never a gappy one: pages arrive oldest-first, so everything below the cursor is committed. The
  next sync resumes from the cursor instead of re-downloading the whole board.
- Individual pages are retried twice with a short backoff before the pull gives up, so one blip
  in a 20-page board doesn't discard the 19 good pages.
- `syncSlab` still never throws — it returns `{ synced: false, error }`. `error` is the message, so
  a repeatable failure is diagnosable rather than showing up as a mysteriously short catalog.

Three levels of repair, weakest first:

| Level | Entry point | What it does |
| --- | --- | --- |
| Delta | screen mount (`useSlab`) | pull rows newer than the cursor |
| Re-pull | catalog pull-to-refresh (`resyncSlab`) | reset the cursor, re-`put` every row (additive) |
| Rebuild | Settings → Catalog cache (`rebuildSlab`) | delete one slab's rows **and** cursor, then download it again |

Rebuild is the only one that can fix a cache the browser evicted, a first sync that half-wrote, or
a full origin quota — pull-to-refresh is additive, so it can't free space or prune rows whose
server-side tombstone predates the cursor. Settings shows each owned board+angle's cached row count
(`countSlab`), which is how a short slab becomes visible at all, and rebuilds are **per slab** —
one board+angle at a time, so repairing the 2019 40° board doesn't re-download the others (and two
concurrent slab downloads can't re-create the exhaustion being undone). It is
destructive-then-refetch: an interrupted rebuild leaves that board emptier than it started, hence
the confirm dialog.

## The second source: user-authored problems

Official problems are one of **two** lanes into a client's catalog. The other is
`public.user_problems` — written by the web editor straight through PostgREST, with no fetch
script, no staging directory and no service-role step. A user-authored problem is identified by
the generated text id **`user:<uuid>`** (migration `0018`), which is the same id lane
`catalog_problems.source_catalog_id` uses, so ascents, session queues and lit-problem pointers
store one kind of problem id regardless of origin. Migration `0019` adds the public read policy
(`to anon, authenticated`, live-public rows only) plus the guards that make it safe: trigger-stamped
`setter_user_id`/`setter_handle`, a public-completeness `CHECK`, and a per-user cap of 50 live
public rows. Schema detail lives in [data-model-and-logging.md](data-model-and-logging.md);
the authoring UI is in [navigation-and-ui-flows.md](navigation-and-ui-flows.md).

```
Supabase  public.user_problems   (client-written; owner-only writes, live-public reads)
    │
    ├─ OWN rows ──────────► updated_at cursor delta, tombstones included ──┐
    └─ OTHERS' PUBLIC rows ► full per-slab snapshot, absence = retraction ─┤
                                                                          ▼
                          PWA: userProblemsSync.ts → IndexedDB  moonboard-user-problems
                                                                          │
                          merged at READ time by catalogSync.ts ──────────┘
                          (readSlab, getCatalogProblemsByIds)
```

The two lanes never write the same rows: the snapshot skips rows the caller owns, because a
private row is absent from a public snapshot *by definition* and eviction-by-absence would delete
the author's own work. The custom rows live in a **separate IndexedDB database** from the imported
catalog, which is what makes Settings → Catalog cache → Rebuild safe: `clearSlab`/`rebuildSlab`
wipe imported rows only and can never destroy something a user authored. Conversely a failed
public pull evicts nothing — an offline device keeps browsing what it has instead of reading the
failure as "everything was retracted". The eviction rule is written up in
[`docs/solutions/architecture-patterns/snapshot-eviction-over-tombstone-streams.md`](solutions/architecture-patterns/snapshot-eviction-over-tombstone-streams.md).

### Takedown runbook (service role)

There is no moderation table and no admin flag by design — a takedown is a service-role SQL
statement against the hosted project (SQL Editor, or `psql` with the service-role connection).
Address the row by its `source_catalog_id`, the id that appears in a client URL and a report.

```sql
-- 1. Unpublish (reversible): the row stays the author's, they can re-publish it.
--    Frees one of their 50 public slots immediately.
update public.user_problems
   set visibility = 'private'
 where source_catalog_id = 'user:<uuid>';

-- 2. Tombstone (removes it from the author too; their client deletes its cached copy).
update public.user_problems
   set deleted = true
 where source_catalog_id = 'user:<uuid>';

-- Look one up before acting on it.
select source_catalog_id, name, grade, layout_id, angle, visibility, deleted,
       setter_handle, setter_user_id, updated_at
  from public.user_problems
 where source_catalog_id = 'user:<uuid>';
```

Both statements bump `updated_at` through the `0002` trigger, so the author's own client notices
on its next delta pull, and every other client drops the row on its next per-slab snapshot (it is
no longer listed, so it evicts by absence). No client cache needs manual clearing.

**A service-role write does not clear the attribution columns.** The `0019` stamp trigger keys off
`auth.uid()`, which is null for a service-role connection, so it passes the write through
untouched: `setter_user_id` and `setter_handle` keep the values they had when the row was public.
That is harmless — nothing can read a private or tombstoned row but its owner — but do not treat a
runbook retraction as having erased the author's identity from the row. To actually clear them, set
the columns explicitly in the same statement.

**Moderation posture (v1).** The takedown path above is reactive and manual; there is no queue, no
report flow and no pre-publication review. What bounds the blast radius is that the PWA origin is
**entirely `noindex`** (`X-Robots-Tag` on every `www.boardhang.app` response — see
[content-site.md](content-site.md)), so a public user problem is reachable by another app user
browsing the board, never by a search engine.

## Gotchas

- **`Catalog.swift` decodes with `JSONSerialization`, not `Codable`**, because Codable is far
  slower over thousands of problems in debug builds. The synced disk-cache slabs are written in the
  same on-disk shape the bundled files used, so this fast path is unchanged — keep it if you touch
  loading. `CatalogSyncManager` writes slabs to `Application Support/CatalogCache/` and merges
  deltas by `source_catalog_id`.
- **First open of a board needs network.** The catalog is no longer bundled, so a board's first
  add/open fetches its slab from Supabase (cached after that, incl. offline). A cold offline
  first-run — or a clone with `Supabase.xcconfig` unset — shows an empty catalog until one sync.
- **A board stuck at a fraction of its problems is a client-cache problem, not missing data.**
  Check the count in the PWA's Settings → Catalog cache against the slab's real size before
  suspecting the import; the fix is Rebuild there (see above), not a re-import.
- **Benchmark detection is unreliable on boardsesh.** When both `--benchmarks-only` and
  `--min-ascents N` are passed, `fetch_boardsesh.py` **unions** the two result sets (deduped by
  uuid) because the benchmark flag misses popular problems. (See the recent commit history around
  benchmark overrides.)
- **Foot-rule `method` comes from boardsesh `characteristics`.** The fetch scripts map
  `method_no_kickboard` / `method_footless` / `method_footless_kickboard` → `"No kickboard"` /
  `"Footless"` / `"Footless + kickboard"` (else `null`). To add `method` to snapshots that were
  fetched before this without re-fetching (which would reshape the curated slabs), run
  `scripts/enrich_catalog_methods.py` — it pages boardsesh and adds `method` to existing problems
  **by uuid** (additive, idempotent), then re-import with `import_catalog.py`. The web/iOS filter
  offers a **fixed** label list (not slab-derived), so it shows regardless of the loaded data.
- **Mini 2025 (layout 7) spans setIds `28,29,30,31` on boardsesh, not just `28`.** boardsesh
  re-partitioned it; `setIds="28"` alone now returns only a ~181-problem slice of the full ~4,870.
  Both fetch scripts use the full `28,29,30,31`. If a board's live count ever collapses, probe
  adjacent setIds before assuming data was deleted.
- API returns may hit `429/502/503`; the fetch scripts have retry/`--delay` handling.
- Hold-id ↔ (col,row) conversion inside the scripts: `holdId = (row-1)*11 + col + 1`; reverse is
  `col = (holdId-1) % 11`, `row = (holdId-1)//11 + 1`.
- `catalog-data/` is staging (the input to `import_catalog.py`); **Supabase** is the catalog source
  of truth clients sync from. `MoonBoardLED/Resources/` no longer holds catalogs — only `*HoldSets.json`.
