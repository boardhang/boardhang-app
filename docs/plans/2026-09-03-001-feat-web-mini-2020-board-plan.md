---
title: Mini MoonBoard 2020 on the web PWA - Plan
type: feat
date: 2026-09-03
topic: web-mini-2020-board
execution: code
---

# Mini MoonBoard 2020 on the web PWA - Plan

## Goal

Make the **Mini MoonBoard 2020** (layout id 6) an addable board in the Boardhang web PWA, so its
official-problem catalog can be browsed, filtered by installed hold set, rendered, and lit like
the other five boards. Tier: **Standard** (a new board inside the existing registry pattern; no
BLE, geometry, or migration changes).

## What already exists (verified 2026-09-03)

- `catalog-data/minimoonboard2020_40.json` is staged: 3,807 problems, 40° only, curated under the
  "benchmark OR repeats ≥ 10" rule, with `method` populated.
- Prod Supabase `catalog_problems` already holds those **3,807 rows for `layout_id = 6`** — the
  import step of [catalog-data-pipeline.md](../catalog-data-pipeline.md) is done.
- iOS `MoonBoardSetup.all` defines layout 6 (hold sets 24–27) and the overlay art lives under
  `ios/MoonBoardLED/Assets.xcassets/Boards/minimoonboard2020/` (650×694, same as Mini 2025).

What is missing is purely client registration on the web: the registry entry, the hold-set
membership map, the exported art, and the docs.

## Units

1. **Membership** — add Mini 2020 to `scripts/derive_holdset_membership.py` and regenerate
   `MiniMoonBoard2020HoldSets.json` (web + iOS copies). Verify every grid cell the 3,807 problems
   use is classified, so the hold-set filter can never hide a problem on a full board.
2. **Art** — add Mini 2020 to `scripts/export_board_art_web.py` and export
   `web/public/boards/minimoonboard2020/*.png` (the shared `minimoonboard-bg` already exists).
3. **Registry** — add layout 6 to `BOARDS` in `web/src/board/boards.ts`: `angles: [40]`,
   `MINI_GEOMETRY`, `MiniMoonBoard2020Catalog` / `MiniMoonBoard2020HoldSets`, hold sets 24–27.
   Listed right after Mini 2025 so the Minis sit together in "Add a board".
4. **Tests** — registry test expects six boards and both Minis single-angle; add a guard that every
   registered board has a bundled membership resource whose set ids match the registry.
5. **Docs** — `docs/multi-board-model.md` (layout table: web-only), `docs/catalog-data-pipeline.md`
   (single-angle naming, add-a-board recipe gains the art-export step), `CONTEXT.md`, `README.md`.

## Out of scope

- iOS registration in `Board.all` (iOS is on hold; the setup/art are already there when wanted).
- A 25° Mini 2020 slab — the Mini is a fixed 40° board.
- Beta videos for Mini 2020 (none seeded; the strip simply stays empty).

## Test plan

- `npm run test`, `npm run lint`, `npm run build` in `web/` are green.
- Browser: add "Mini MoonBoard 2020" from Boards, the catalog syncs ~3,800 problems from Supabase,
  a problem renders on the mini art with the correct hold positions, and toggling a hold set off
  in the board config hides problems that use it.
