---
title: Beta Videos "View All" Grid - Plan
type: feat
date: 2026-09-01
topic: beta-view-all
---

# Beta Videos "View All" Grid - Plan

## Goal

The problem drawer's beta strip currently scrolls horizontally with no overview. Add a
"view all" affordance: the strip caps at a few cards and ends in a **"+N / View all"
count tile** (Option C of the design exploration) that opens a **full-height grid
sheet** listing every clip. Tapping a card in the grid opens the existing player on
top. Design settled with the product owner on the mockup canvas
(claude.ai/code/artifact/72460914-edcb-4270-baab-6ae31ab2fe86); tier: Standard.

## Decisions

- **Strip cap:** show at most 4 real cards. When `videos.length > 5`, the 5th slot
  renders as the count tile — the 5th video's thumbnail dimmed under a
  `+{videos.length - 4}` + "View all" overlay. With ≤ 5 videos there is no tile (a
  "+1" tile would hide exactly the one clip it replaces). The seed pipeline now tops
  problems up to 6 clips (#137), so the tile is the norm on seeded problems. The
  local pending-review placeholder stays first and never counts toward the cap.
- **Surface:** a shadcn `Drawer` bottom sheet (`BetaGridSheet`), header = "Beta
  videos" + muted count + the existing "Add a beta" ghost button (the sign-in gate
  stays in `BetaVideos`; the sheet only calls back). Body = fluid thumbnail grid
  (`repeat(auto-fill, minmax(~120px, 1fr))`) reusing the same card component.
- **Back gesture:** the sheet pushes a history entry exactly like `BetaPlayerSheet`
  does, so on mobile "back" closes player → grid → problem drawer in order. The
  subtle pushState/popstate/StrictMode pattern is extracted once into a
  `useHistoryBackClose(open, onClose, stateKey)` hook used by both sheets.
- **Card reuse:** `BetaCard` + `PendingCard` move from `BetaVideos.tsx` into
  `web/src/beta/BetaCard.tsx` with a width/class prop (strip: `w-28 shrink-0
  snap-start`; grid: `w-full`). No visual change to the card itself.

## Units

1. **Extract** `BetaCard.tsx` (BetaCard, PendingCard, thumb/fmtDur helpers) — pure
   move + `className` prop; strip renders unchanged.
2. **Hook** `useHistoryBackClose` in `web/src/beta/`; refactor `BetaPlayerSheet` to
   use it (behavior-preserving).
3. **`BetaGridSheet.tsx`** — controlled Drawer, header + grid, uses the hook; player
   stacks on top via the parent's existing `active` state.
4. **Strip cap + tile** in `BetaVideos.tsx` + `gridOpen` state wiring.
5. **Tests:** strip-cap boundary (6 → no tile; 7+ → 5 cards + correct "+N" and
   aria-label; tap opens sheet), grid sheet rendering/interaction, hook history
   behavior. Extend `BetaVideos.test.tsx` (stub the sheet like the other surfaces),
   new `BetaGridSheet.test.tsx`.
6. **Docs:** update the beta-videos paragraph in the owning `docs/` file in the same
   PR.

## Test plan

- `npm test` (vitest) — new + existing beta suites green.
- `npm run build` (tsc -b + vite) and oxlint — clean.
- Manual: dev server — strip with >6 clips shows the tile, tile opens the grid,
  card opens the player over it, back gesture unwinds player → grid → drawer,
  "Add a beta" gate still works from the sheet, ≤6 clips shows no tile.

## Out of scope

- Sorting/filtering inside the grid sheet (the sheet leaves room for it later).
- Any iOS work (web PWA is the only active client).
