# Catalog Data Pipeline

How official MoonBoard problems get from the boardsesh API into **our canonical snapshots in
`catalog-data/`**, from there into **Supabase**, and from there synced down and cached by each
client (iOS, PWA, future Android) — and how to refresh a board or add one. Pairs with
[`../CONTEXT.md`](../CONTEXT.md) §"Importing official problems".

Two facts shape everything below:

- **The committed snapshot is canonical; Supabase is a deployment of it.** `catalog-data/<slug>_<angle>.json`
  is the catalog in a shape we own, sorted by id, one problem per line. Prod mirrors it. A refresh is
  a pull request whose diff is the review; backup and restore of the data are `git checkout`.
- **Nothing in the pipeline deletes.** The merge and the import can only add rows and change
  upstream-owned fields. Tombstones (`deleted = true`) are the only removal mechanism clients
  understand, and the only code path that writes one is the restore script's rollback flag.

The catalog is **server-distributed**, not bundled: clients download it lazily per board into a
local cache and query it locally, so every client stays in sync instead of drifting on divergent
bundles. See migration `supabase/migrations/0006_catalog_problems.sql`.

**Key files:** `scripts/catalog_lib.py` (shared helpers: identity keys, the row normalizer, keyset
paging, snapshot and overrides I/O) + `scripts/fetch_boardsesh.py` (fetch) + `scripts/merge_catalog.py`
(merge with ownership rules) + `scripts/import_catalog.py` (diff-only deploy to Supabase) +
`scripts/{backup,restore}_catalog_problems.py` (dump / roll back the table) +
`scripts/export_catalog_snapshots.py` (the one-time seed from prod), `catalog-data/overrides.json`
(committed identity verdicts), `MoonBoardLED/Catalog/Catalog.swift` (synced disk cache + loading),
`MoonBoardLED/Services/Supabase/CatalogSyncManager.swift` (iOS pull), `web/src/catalog/catalogSync.ts`
(PWA pull), `MoonBoardLED/Board/HoldSetMembership.swift`. Tests: `scripts/tests/test_*.py`
(`python3 -m unittest discover -s scripts/tests -p 'test_*.py'`; no network, no DB).

## Data flow

```
boardsesh GraphQL API  (https://ws.boardsesh.com/graphql, public, no auth)
    │
    │  scripts/fetch_boardsesh.py --layout N [--angle A]      UNFILTERED, per slab
    ▼
catalog-data/.upstream/<slug>_<angle>.json                    scratch, gitignored
    │
    │  scripts/merge_catalog.py --layout N [--angle A]        ownership rules; refuses on ambiguity
    │        ◄── catalog-data/overrides.json                  committed human verdicts + retired ids
    ▼
catalog-data/<slug>_<angle>.json                              CANONICAL, committed, rewritten in place
    │                                                         (reviewed as a PR diff, one problem per line)
    │  scripts/import_catalog.py --layout N --angle A [--apply]   diff against prod, write only changes
    ▼
Supabase  public.catalog_problems                             a deployment of the snapshot
    │
    │  download-and-cache, lazy per (layout_id, angle) slab, updated_at > cursor
    ├──────────────────────────────┬──────────────────────────────┐
    ▼                              ▼                              ▼
iOS: CatalogSyncManager        PWA: catalogSync.ts → IndexedDB   (future clients)
     → Application Support/CatalogCache/*.json
     Catalog.swift (JSONSerialization fast path over the cached slab)

scripts/derive_holdset_membership.py ──► MoonBoardLED/Resources/<Board>HoldSets.json  (still bundled)
scripts/import_board_images.py ────────► MoonBoardLED/Assets.xcassets/Boards/<folder>/*.png
    HoldSetMembership.swift (membership lookup by "col-row")
```

Three directories, three roles:
- **`catalog-data/`** — the canonical snapshots, one per (board, angle) slab, plus `overrides.json`.
  Committed. The input to `import_catalog.py`.
- **`catalog-data/.upstream/`** — fetch scratch (gitignored). The input to `merge_catalog.py`.
  Never commit it; the merged snapshot beside it is the copy that matters.
- **`MoonBoardLED/Resources/`** — **no longer holds catalogs** (they're server-distributed now).
  Still holds the `*HoldSets.json` files and other bundled assets.

## Identity: our ids, boardsesh's uuids, hold geometry

Every problem in the app is keyed by `source_catalog_id`. **That id is ours.** It is minted as the
first boardsesh uuid seen for a problem (or a derived id, below) and never changes afterwards, so
ascents, lists, session queues, beta videos and benchmark events all keep pointing at the same row
across refreshes. Beside it the snapshot carries `boardsesh_uuid`, the upstream key, which boardsesh
re-derives from a problem's name *and* setter: a re-cased name (`'BINGO'` → `'Bingo'`), a retitle or a
trailing space added to a setter re-keys the problem upstream. The merge follows that key; our id
does not move.

`hold_key` is the geometry identity: the full sha256 hex digest of the problem's holds as a canonical
sorted `c,r,t` string. It is how the merge recognizes a renamed problem (same holds, new uuid). It is
an identity key — never truncate it, and every decision compares the *recomputed* key, never the stored
string alone. Changing its format means re-exporting every snapshot (`export_catalog_snapshots.py`).

boardsesh keys a problem identically at both angles of a board. When an incoming uuid is already our
id at the *other* angle and the holds are the same, the merge mints the problem at this angle with a
**derived id**: `uuid5(DERIVED_ID_NAMESPACE, "<uuid>:<angle>")` (`catalog_lib.derived_id`), so two
operators merging the same fetch mint the same id. A uuid that is our id elsewhere with *different*
holds is a collision and is quarantined.

## JSON schemas

### Canonical snapshot (`catalog-data/<slug>_<angle>.json`)

Header keys in this order, then problems **sorted by `id`, one per line**, each with exactly these
keys in this order (`catalog_lib.SNAPSHOT_KEYS` / `PROBLEM_KEYS`; the writer refuses anything else):

```jsonc
{"setup": "MoonBoard 2024", "layoutId": 3, "angle": 40,
 "source": "boardsesh (ws.boardsesh.com/graphql)",
 "curation": "benchmark or repeats >= 10",   // admission rule for NEW problems
 "upstream_total": 38643,                    // boardsesh's total for the fetch last merged; null after the seed
 "count": 5858, "problems": [
{"id": "13550663-…",            // OUR id — the catalog_problems PK; never changes once minted
 "boardsesh_uuid": "13550663-…", // the upstream key; may change when boardsesh re-keys the problem
 "name": "# 3", "grade": "6B+", // Font grade
 "userGrade": null,             // ignored by the app
 "setter": "mb_…", "stars": 5,  // rating 0–5
 "repeats": 28,                 // ascent count
 "isBenchmark": false,
 "method": null,                // foot rule: "No kickboard" / "Footless" / "Footless + kickboard", else null
 "holds": [{"c": 2, "r": 12, "t": "end"}, {"c": 5, "r": 5, "t": "start"}],
 "hold_key": "<sha256 hex of the sorted c,r,t string>",
 "upstream_last_seen": "2026-10-09"},   // date of the fetch it last appeared in; null = no fetch yet
…
]}
```

Ownership per field: boardsesh owns `name`, `grade`, `userGrade`, `setter`, `stars`, `repeats`,
`isBenchmark`, `method` (the merge overwrites them from the feed); **we own `id` and `holds`**.
`boardsesh_uuid`, `hold_key` and `upstream_last_seen` live only in the snapshot — the import never
uploads them (prod keeps the columns it has; no migration).

Hold encoding inside `holds`: `c` = column 0–10 (A–K), `r` = row (1 = bottom), `t` = type. **boardsesh
collapses hand holds**, so imported types are effectively `start` / `right` / `end` only (this is
why "beta" mode in the app has nothing finer to show for catalog problems).

### Overrides (`catalog-data/overrides.json`)

The committed record of every identity verdict a human made, independent of boardsesh. Every entry
is slab-scoped and may carry a free-form `note`:

```jsonc
{"retired_ids": ["726d5454-…", …],   // ids tombstoned in prod that no snapshot holds (see Gotchas)
 "entries": [
  {"action": "match",        "layout_id": 3, "angle": 40, "uuid": "<upstream>", "id": "<ours>"},     // that uuid IS our row
  {"action": "new",          "layout_id": 3, "angle": 40, "uuid": "<upstream>", "id": "<mint as>"},  // a new problem, minted as id
  {"action": "accept_holds", "layout_id": 3, "angle": 40, "id": "<ours>", "hold_key": "<sha256>"},    // accept ONE geometry change
  {"action": "pin",          "layout_id": 5, "angle": 40, "id": "<ours>", "field": "isBenchmark", "value": true}  // hold a field against the feed
 ]}
```

Overrides resolve before any rule runs and consume the rows they name; an entry that matched
nothing produces a warning. The file must never carry both `problems` and `layoutId` at top level
— the slab selectors treat any such file as a snapshot.

### Fetch scratch (`catalog-data/.upstream/<slug>_<angle>.json`)

`{fetched_at, layoutId, angle, setIds, total_count, count, problems[]}` with problems keyed by
`uuid` (not `id`). `total_count` is boardsesh's reported total on the first page — the short-fetch
guard compares against it. Not committed, not diffed.

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

## File naming conventions

The catalog resource base name (from `Board.catalogResource(angle:)`) is still the identity of a
board+angle "slab" — it's now the **cache filename** (`Application Support/CatalogCache/<name>.json`
on iOS) rather than a bundled resource:

- **Single-angle** (the Minis, 40° only): `MiniMoonBoard2025Catalog`, `MiniMoonBoard2020Catalog` —
  no angle suffix.
- **Multi-angle**: `<Name>Catalog_<angle>`, e.g. `MoonBoardMasters2019Catalog_40`. `_25` and `_40`
  are the wall angle in degrees.
- **Hold sets** (still bundled): `<Name>HoldSets.json`, e.g. `MiniMoonBoard2025HoldSets.json`.
- **Snapshots**: `<slug>_<angle>.json` with the slug from `catalog_lib.BOARDS`
  (`moonboard2024`, `moonboardmasters2019`, `minimoonboard2025`, …).

## The merge rules

`merge_catalog.py` turns a fetch into a reviewable change to the snapshot, or refuses. Stages, in
order (every stage runs to completion collecting cases; the refusal comes at the end, so a refused
run still prints the renames and mints it would have made):

1. **Overrides** for the slab resolve first and remove the rows they name from the pools below.
2. **Guards.** An empty fetch is always refused. A fetch below 80% of its own header total *or* of
   the previous fetch's total (`upstream_total` in the snapshot header) is refused unless
   `--accept-short`. A set-id re-partition upstream collapses the total; an upstream re-keying does
   not. The first merge after the seed has no previous total and only warns.
3. **Match by `boardsesh_uuid`.** The row's upstream-owned fields are updated whatever its repeats.
   Its holds must still equal ours (recomputed `hold_key`), else the case is quarantined *holds
   differ* — an `accept_holds` entry naming the exact new key lets it through once.
4. **Geometry claims, strongest evidence first.** An unknown uuid whose `hold_key` equals a snapshot
   row **this fetch did not return** is a rename when exactly one such row matches by name
   (case/whitespace-insensitive) or, failing that, by setter: the row keeps its id and gets the new
   `boardsesh_uuid`. A geometry match with neither (*no evidence*), or several incoming rows with
   evidence for one row (*contention*), is quarantined. Holds shared only with rows the fetch *did*
   return make a distinct problem. Repeats are not evidence.
5. **Curation.** Remaining unknown rows are admitted only if they are benchmarks or have ≥ 10
   repeats (`catalog_lib.CURATION`, recorded in the header). At 25° the unfiltered feed carries every
   40° problem and most fail the per-angle floor; they are dropped, not quarantined.
6. **Mint.** A uuid equal to a *retired id* is quarantined. A uuid that is already our id in another
   slab is minted with a derived id when the holds equal that row's, and quarantined *uuid collision*
   when they differ. Everything else is minted with `id = uuid`.
7. **Pins** apply last, so a pinned field holds against the feed.
8. **Invariants** before writing: ids unique across *all* snapshots, `boardsesh_uuid` unique in the
   slab, every id plain (`ID_RE`), every stored `hold_key` equal to the recomputed one.

Every returned row gets `upstream_last_seen` = the fetch date. A row the fetch did not return keeps
every field and its old date — it is never removed. The report lists every benchmark flag transition
in both directions, because boardsesh's flag flaps and a true→false drop silently removes benchmark
status in the app; a `pin` is the fix.

Each quarantined case prints with a ready-to-paste overrides entry (and an alternative where there
is one). The loop is: run, read the stanza, record the verdict in `overrides.json`, commit it, run
again. Exit status 2 on any refusal; `--dry-run` reports without writing.

## Runbook: refreshing a slab

Everything up to the apply is offline from prod's point of view; the apply is the one write.

```bash
# 0. Branch. A refresh is a PR; the snapshot diff plus the pasted merge report are the review.

# 1. Fetch the whole feed for the slab into scratch (unfiltered; ~1 s per 100 problems with the
#    default --delay 0.25; 2016 @ 40° is ~943 pages, about eight minutes).
python3 scripts/fetch_boardsesh.py --layout 3 --angle 40
#   --layout N alone fetches both angles; --all every board. Output: catalog-data/.upstream/

# 2. Merge. Rewrites catalog-data/moonboard2024_40.json in place on success; on a quarantine it
#    prints each case with an overrides.json entry and writes nothing (exit 2). --dry-run to preview.
python3 scripts/merge_catalog.py --layout 3 --angle 40
#   Short fetch refused? Check the counts it names against boardsesh before --accept-short.
#   Quarantines? Decide each one, add the entry to catalog-data/overrides.json, re-run.

# 3. Review the diff (one problem per line, so it is a per-problem diff), commit the snapshot and
#    any overrides, open the PR with the merge report pasted into the body, merge the PR.

# --- after the PR is merged: deploy to prod (operator, service-role key) ---

# 4. BACK UP the table first — prod has no row history.
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/backup_catalog_problems.py   # -> catalog_problems_backup_<ts>.json

# 5. Dry run (the default; the anon key is enough to read). Check: the un-delete list (every id is
#    printed), the orphan count (live rows prod has that the snapshot lacks — refused by default),
#    retired-id hits, cross-slab hits, and the predicted benchmark banner events (an upper bound).
#    Credentials: the prod URL and anon key are the PWA's public config (the Vercel project's env;
#    also commented in web/.env); the service-role key is in the Supabase dashboard only, is never
#    committed, and is what makes steps 4, 6 and the rollback operator-only.
SUPABASE_URL=… SUPABASE_ANON_KEY=… python3 scripts/import_catalog.py --layout 3 --angle 40

# 6. Apply. Writes inserts, then updates, then un-deletes, in batches of 500, every row with
#    deleted=false; untouched rows are not re-stamped, so clients only re-download real changes.
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/import_catalog.py --layout 3 --angle 40 --apply
#   Stopped partway (HTTP error)? Re-run the same command — written rows now diff as unchanged.

# Rollback. Updates and un-deletes: restore the backup verbatim (deleted flags included).
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/restore_catalog_problems.py catalog_problems_backup_<ts>.json
#   Rows the apply INSERTED: add the slab-scoped flag, which tombstones live rows of that one slab
#   absent from the backup — the only code path in the repo that writes deleted=true, rollback only.
#   … restore_catalog_problems.py catalog_problems_backup_<ts>.json --tombstone-absent --layout 3 --angle 40
#   Banner events fired by inserted benchmarks (benchmark_events) have no drain: retract one by
#   setting its discarded_at in SQL (migration 0018's retraction contract).
```

Exit codes, so a script or agent can tell a refusal from a crash:

| Script | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `fetch_boardsesh.py` | slab(s) written | boardsesh or GraphQL error after retries | — |
| `merge_catalog.py` | merged (or dry run clean) | bad arguments, missing or mismatched fetch file, duplicate id across snapshots | refused: quarantine, guard or invariant (report printed, nothing written) |
| `import_catalog.py` | dry run clean, or apply done | refused by a guard (orphans, retired ids, cross-slab hits), missing credentials, or an HTTP error mid-apply (re-run) | — |

### Adding a board

```bash
# 1. Add the board to catalog_lib.BOARDS (layoutId, slug, display name, setIds, angles) if missing.
python3 scripts/fetch_boardsesh.py --layout 7 --angle 40
python3 scripts/merge_catalog.py --layout 7 --angle 40 --new-slab    # every admitted row is minted
# 2. Review, commit, PR, then after merge: backup → import dry run → --apply (as above).

# 3. Derive hold-set membership (needs Pillow: pip install Pillow)
python3 scripts/derive_holdset_membership.py                # scans its BOARDS list → *HoldSets.json (bundled)
# 4. Import board art
python3 scripts/import_board_images.py [--src /path/to/boardsesh]
# 4b. Export the art the PWA renders (straight copy of the iOS imagesets; add the board to the
#     script's BOARDS list first)
python3 scripts/export_board_art_web.py                     # -> web/public/boards/<folder>/*.png
# 5. Register the board: web in web/src/board/boards.ts (BOARDS) — the boardArt test fails until
#    step 4b has run; iOS in Board.all in MoonBoardLED/Board/Board.swift (and a MoonBoardSetup in
#    MoonBoardSetup.swift if geometry differs). Clients then sync the board's slab from Supabase the
#    first time it's added/opened — no rebuild needed to ship data.
```

`derive_holdset_membership.py` samples each hold-set overlay PNG's alpha channel (threshold ~60) to
decide which grid positions a set owns; that's why it needs the imported board art present first.

### Re-seeding from prod

`export_catalog_snapshots.py` is how the snapshots were seeded (2026-10-09: 75,498 rows across ten
slabs, three tombstones skipped and recorded as retired ids). It is only needed again if the snapshot
shape changes and every slab has to be re-exported; a refresh never runs it. It reads with the anon
key and writes nothing to prod.

The seed PR's acceptance merges (2024 @ 40° and @ 25°, Mini 2025) ran against scratch copies and
dry runs, never the committed snapshots or prod, so every snapshot still carries the stats prod had
on 2026-10-09 and the 25° slabs their old angle-specific uuids until each slab's first refresh PR.

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

## Gotchas

- **The snapshot is canonical; prod is a mirror.** If prod and the snapshot disagree, the snapshot
  wins and the import's dry run shows the difference (updates, un-deletes, or orphans it refuses
  on). Hand-edit prod only in an emergency, and then re-export or fix the snapshot to match.
- **Nothing deletes.** The merge and the import never remove or tombstone a row; a problem boardsesh
  dropped stays in the catalog with a stale `upstream_last_seen`. The restore script's
  `--tombstone-absent` flag is the one tombstone path, for rolling back an apply's inserts only.
- **Diff-only imports don't re-stamp untouched rows.** The `updated_at` trigger (0006) has no change
  guard, so a blind upsert used to re-stamp every row and every client re-downloaded every slab on
  each refresh. The import diffs against prod, normalized exactly as the row mapper does (`''`
  collapses to null on `user_grade` and `method`), and writes only real changes. The diff includes
  `deleted`, so a future un-delete is a write.
- **The benchmark banner trigger (0018) fires on rising edges only:** an inserted benchmark, or a
  row whose `is_benchmark` goes false→true. The import's predicted event count is the operator's
  check before an apply; there is no drain, so a spurious event is retracted by hand.
- **The three legacy tombstones stay tombstoned.** KRUSE (2024 @ 40°), "Ply Pinches" and "Everthing
  is 5+" (2024 @ 25°) each have a live row with identical holds in prod (Kruse, "Ply Pinches 25",
  "Everything is 6b+"), so un-deleting them would show duplicates. They are absent from the
  snapshots and listed as `retired_ids` in `overrides.json`; the merge quarantines an incoming uuid
  equal to a retired id, and the import's orphan check ignores tombstoned rows. Re-pointing user data
  from KRUSE to Kruse is a separate job.
- **boardsesh uuids change when a problem is renamed or re-attributed** — they're derived from the
  name *and* the setter (a trailing space added to a setter re-keyed `'FM 1'` with its name
  untouched). **Hold geometry is the only reliable key**, and identical holds alone aren't proof (a
  deleted problem can be re-set by someone else), which is why the merge wants name or setter
  evidence and quarantines the rest. The 2026-10 refresh of 2024 @ 40° had 97 such renames (91 case
  changes, 2 whitespace-only setter edits, 4 retitles); the first merge after the seed reproduced all
  97 with name evidence and zero quarantines.
- **The 25° slabs still carry angle-specific uuids until their first refresh.** boardsesh unified
  uuids across angles after the slabs were first fetched, so hundreds of 25° rows now come back
  under the uuid that is our 40° id. The merge resolves them as renames to the shared uuid (same
  holds, same name); a 25° problem *new* to us whose holds equal the 40° row is minted with a derived
  id. Every snapshot also still carries pre-refresh stats until its first refresh PR.
- **The benchmark flag flaps upstream.** A true→false drop removes benchmark status in the app
  silently; the merge report lists both directions so the reviewer sees it, and a `pin` override
  holds it. The two pins that exist (THE WARM UP PROBLEM, FULL SWINGS; Masters 2019 @ 40°) replaced
  the hard-coded overrides the old fetch script carried.
- **Foot-rule `method` comes from boardsesh `characteristics`.** The fetch maps `method_no_kickboard`
  / `method_footless` / `method_footless_kickboard` → `"No kickboard"` / `"Footless"` /
  `"Footless + kickboard"` (else `null`). The web/iOS filter offers a **fixed** label list (not
  slab-derived), so it shows regardless of the loaded data.
- **Mini 2025 (layout 7) spans setIds `28,29,30,31` on boardsesh, not just `28`.** boardsesh
  re-partitioned it; `setIds="28"` alone returns only a ~181-problem slice. `catalog_lib.BOARDS`
  has the full set. A re-partition collapses the feed's total, which is exactly what the merge's
  short-fetch guard refuses on — probe adjacent setIds before assuming data was deleted.
- API returns may hit `429/502/503`; the fetch has retry/`--delay` handling and the Supabase reads
  retry the same codes.
- **Supabase REST reads are silently clamped to 1000 rows.** Hosted PostgREST's `db-max-rows`
  caps every `/rest/v1` response at 1000 — `Range: 0-99999` still returns 200 with 1000 rows and
  `Content-Range: 0-999/*`, no error. Every catalog script reads through
  `catalog_lib.live_rows`, which pages by keyset on `source_catalog_id`, asks for the exact count
  on its first request and stops at the total; `sb_get_all` in `seed_beta_videos.py` pages by
  `Range` the same way. See
  [the solutions entry](solutions/developer-experience/paginate-supabase-rest-reads-past-the-1000-row-clamp.md).
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
- Hold-id ↔ (col,row) conversion inside the fetch: `holdId = (row-1)*11 + col + 1`; reverse is
  `col = (holdId-1) % 11`, `row = (holdId-1)//11 + 1`.
- **`seed_beta_videos.py` reads the snapshot too** (`problems[].id/name/isBenchmark/repeats`) and
  keeps its own copy of the board table; the weekly workflow runs it from a plain checkout.
