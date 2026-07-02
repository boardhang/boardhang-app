# Catalog Data Pipeline

How official MoonBoard problems get from the boardsesh API into the app as bundled, read-only
catalogs — and how to regenerate or add a board. Pairs with [`../CONTEXT.md`](../CONTEXT.md)
§"Importing official problems".

**Key files:** `scripts/*.py` (generation), `MoonBoardLED/Catalog/Catalog.swift` (loading),
`MoonBoardLED/Models/Problem.swift`, `MoonBoardLED/Board/HoldSetMembership.swift`.

## Data flow

```
boardsesh GraphQL API  (https://ws.boardsesh.com/graphql, public, no auth)
    │
    ├─ scripts/fetch_boardsesh_mini2025.py ─► MoonBoardLED/Resources/MiniMoonBoard2025Catalog.json
    │                                          (Mini 2025, single angle, written straight to the bundle)
    │
    └─ scripts/fetch_boardsesh.py ──────────► catalog-data/<slug>_<angle>.json
                                               (staging area for the other boards)
                                                     │
                        (copy / promote into the bundle as needed)
                                                     ▼
                                    MoonBoardLED/Resources/<Board>Catalog[_<angle>].json
    scripts/derive_holdset_membership.py ──► MoonBoardLED/Resources/<Board>HoldSets.json
        (samples hold-set overlay PNGs in Assets.xcassets/Boards/<folder>/)
    scripts/import_board_images.py ────────► MoonBoardLED/Assets.xcassets/Boards/<folder>/*.png
                                                     │
                                                     ▼
        Catalog.swift (loads bundled JSON, JSONSerialization fast path)
        HoldSetMembership.swift (membership lookup by "col-row")
                                                     ▼
        CatalogListView / CatalogProblemDetailView  (Search tab)  →  lights on device via BLE
```

Two directories, two roles:
- **`catalog-data/`** — staging output of `fetch_boardsesh.py` for all boards/angles. Not
  necessarily what ships.
- **`MoonBoardLED/Resources/`** — the JSON actually **bundled** into the app and loaded at runtime.

## File naming conventions

- **Single-angle** (Mini 2025 only, 40°): `MiniMoonBoard2025Catalog.json` — no angle suffix.
- **Multi-angle**: `<Name>Catalog_<angle>.json`, e.g. `MoonBoardMasters2019Catalog_40.json`.
  `_25` and `_40` are the wall angle in degrees.
- **Hold sets**: `<Name>HoldSets.json`, e.g. `MiniMoonBoard2025HoldSets.json`.

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
      "id": "fdac08b2-…",   // stable UUID (same across angles)
      "name": "…",
      "grade": "6A+",        // Font grade
      "userGrade": null,     // ignored by the app
      "setter": "mb_…",
      "stars": 5,            // rating 0–5
      "repeats": 28,         // ascent count
      "isBenchmark": false,
      "method": null,        // foot rule, e.g. "Footless", "No kickboard"; may be absent on old data
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
# 1. Fetch problems
python3 scripts/fetch_boardsesh_mini2025.py                 # Mini 2025 → straight to Resources/
python3 scripts/fetch_boardsesh.py --layout 5 --angle 40    # other boards → catalog-data/
#   useful flags: --all  --min-ascents N  --benchmarks-only  --delay 0.25  --out-dir <path>

# 2. Derive hold-set membership (needs Pillow: pip install Pillow)
python3 scripts/derive_holdset_membership.py                # scans its BOARDS list → *HoldSets.json

# 3. (New board only) import board art
python3 scripts/import_board_images.py [--src /path/to/boardsesh]

# 4. Register the board in Swift: add to Board.all in MoonBoardLED/Board/Board.swift
#    (and a MoonBoardSetup in MoonBoardSetup.swift if geometry differs)

# 5. Rebuild
xcodebuild -project MoonBoardLED.xcodeproj -scheme MoonBoardLED \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO
```

`derive_holdset_membership.py` samples each hold-set overlay PNG's alpha channel (threshold ~60) to
decide which grid positions a set owns; that's why it needs the imported board art present first.

## Gotchas

- **Bundled JSON is minified** (one line). `Catalog.swift` decodes with `JSONSerialization`, not
  `Codable`, because Codable is far slower over thousands of problems in debug builds. Keep the
  fast path if you touch loading.
- **Benchmark detection is unreliable on boardsesh.** When both `--benchmarks-only` and
  `--min-ascents N` are passed, `fetch_boardsesh.py` **unions** the two result sets (deduped by
  uuid) because the benchmark flag misses popular problems. (See the recent commit history around
  benchmark overrides.)
- API returns may hit `429/502/503`; the fetch scripts have retry/`--delay` handling.
- Hold-id ↔ (col,row) conversion inside the scripts: `holdId = (row-1)*11 + col + 1`; reverse is
  `col = (holdId-1) % 11`, `row = (holdId-1)//11 + 1`.
- `catalog-data/` is staging; `MoonBoardLED/Resources/` is what ships. Don't confuse the two when
  wiring a new board.
