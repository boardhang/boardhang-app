---
title: "feat: Web catalog recently-viewed FAB + bottom sheet"
date: 2026-07-06
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# feat: Web catalog recently-viewed FAB + bottom sheet

## Summary

Replace the in-list "Recently viewed" section at the top of the web PWA catalog with an
iOS-style floating action button (FAB) that opens the recently-viewed problems in a bottom
sheet. This mirrors the iOS app (`ios/MoonBoardLED/Views/CatalogListView.swift`:
`recentFAB` + `recentSheet`) and frees the top of the list for the problem results.

All product decisions were settled in a prior grilling session and are treated as fixed here.
The storage layer (`recentsStore.ts` — per `layoutId+angle`, cap 5, move-to-front) is
**unchanged**; this work is UI wiring plus one latent-bug fix.

---

## Problem Frame

Today the web catalog renders a `RecentlyViewed` section pinned above the results list
(`CatalogList.tsx`), showing 2 rows with expand/clear. This eats vertical space above the
actual catalog and diverges from the iOS app, which surfaces recents through a FAB +
bottom sheet instead.

Separately, opening a recently-viewed problem currently routes through
`CatalogScreen.openProblem`, which locates the problem by index in the **filtered**
`displayed` list and silently bails (`if (i >= 0)`) when the problem is filtered out. A
recent that no longer matches the active filters therefore cannot be opened — a latent bug.
Recents are meant to be filter-independent.

---

## Requirements

- **R1** — Remove the in-list `RecentlyViewed` section from the catalog list.
- **R2** — Add a recents FAB that stacks directly **above** the existing filter FAB, using
  the same `size-14` round style, with the lucide `History` icon.
- **R3** — The recents FAB renders **only** when at least one recent problem exists for the
  current board+angle (`useRecents(...).length > 0`); no empty state is needed.
- **R4** — Tapping the FAB opens a shadcn `Drawer` bottom sheet titled "Recently viewed",
  listing the recent problems (reusing `CatalogRow`), with a "Clear" action. Dismissal is
  via swipe/overlay like the app's other Drawers (no "Done" button).
- **R5** — Sheet rows respect the global climb-previews toggle (`useShowPreviews()`).
- **R6** — Tapping a recent row opens that problem's detail **regardless of active filters**
  (fixes the latent bail-out bug), and the detail pager pages over the **full unfiltered
  slab** `problems`, not the filtered `displayed` list.

---

## Key Technical Decisions

- **KTD1 — Shared FAB column owned by `CatalogScreen`.** Both FABs move into a single
  positioned wrapper (`pointer-events-none sticky bottom-4 z-30 mt-auto flex flex-col
  items-end gap-3`) so placement has one source of truth and the two triggers stack (recents
  on top, filter below), mirroring iOS's single `VStack`. `FilterSheet` drops its own sticky
  wrapper and becomes trigger-only; the parent positions it. Rationale: two independent
  `sticky ... mt-auto` siblings fight over the same slot and overlap.
- **KTD2 — Detail Drawer takes an explicit source list, not just an index.** `CatalogScreen`
  replaces `openIndex: number | null` with a single open-target holding the array to page
  over **and** the initial index. List taps pass `displayed`; recent taps pass the full
  `problems` slab. This is what makes R6 work: the recent is always found in the full slab, so
  the open never bails, and paging neighbors are the full catalog (iOS parity).
- **KTD3 — `RecentsSheet` mirrors `FilterSheet` and self-resolves its data.** The new
  component takes `board`, `angle`, `problems`, `favoriteIds`, and an `onSelect`, and internally
  calls `useRecents` + resolves ids against `problems` (same resolution `CatalogList` does
  today). It returns `null` when there are no recents (R3), so the FAB simply disappears.
  Rationale: co-locates recents UI in one component and keeps `CatalogList` purely about the
  results list.
- **KTD4 — `recentsStore.ts` is untouched.** Cap, move-to-front, per-slab keying, and the
  `recordRecent` call site in `ProblemDetail.tsx` all stay as-is. Only the *rendering* of
  recents moves.

---

## High-Level Technical Design

Component/data shape after the change:

```
CatalogScreen (owns useSlab → problems, displayed, favoriteIds)
├── CatalogList            (results only; no recents)
├── FAB column  ─ sticky bottom-4 mt-auto flex flex-col items-end gap-3
│   ├── RecentsSheet       ─ useRecents+resolve; History FAB → Drawer("Recently viewed")
│   │                         onSelect(problem) ─────────────┐  (full slab)
│   └── FilterSheet        ─ trigger-only; SlidersHorizontal FAB → Drawer("Filters")
└── Drawer(ProblemDetail)  ← open target = { list, index }
        list = displayed   (list taps)   ── or ──   list = problems (recent taps)
```

Open-target flow (KTD2):

```
list tap    → openProblem(p)  → find p in displayed → setOpen({ list: displayed, index })
recent tap  → openRecent(p)   → find p in problems  → setOpen({ list: problems,  index })
                                   (always found → never bails; fixes R6 bug)
```

---

## Implementation Units

### U1. Make `FilterSheet` trigger-only

**Goal:** Remove `FilterSheet`'s own sticky positioning wrapper so a parent can place its
trigger inside the shared FAB column.

**Requirements:** R2 (enables stacking).

**Dependencies:** none.

**Files:** `web/src/catalog/FilterSheet.tsx`

**Approach:** Drop the `<div className="pointer-events-none sticky bottom-4 z-30 mt-auto flex
justify-end">` wrapper. Render the `Drawer` with its `DrawerTrigger` (keeping the
`pointer-events-auto ... size-14 rounded-full bg-primary ...` button classes and the count
badge) directly, so the parent's FAB column controls position. No prop or behavior change to
the filter drawer contents. Update the file's top comment to note positioning is now owned by
the parent.

**Patterns to follow:** existing `FilterSheet.tsx` trigger markup (keep verbatim except the
wrapper).

**Test scenarios:** `Test expectation: none — presentational refactor with no behavior change;
covered indirectly by U2's FAB-column rendering and existing manual verification.`

**Verification:** Filter FAB still opens the filter drawer; visually sits where the FAB column
places it (see U2).

### U2. Shared FAB column + source-aware detail open in `CatalogScreen`

**Goal:** Introduce the shared FAB column that stacks the recents and filter FABs, and change
the detail Drawer to page over an explicit source list so recents open filter-independently.

**Requirements:** R2, R6.

**Dependencies:** U1 (filter trigger is now placeable), U3 (renders `RecentsSheet`, but U2 and
U3 can land together — U2 owns the wiring, U3 owns the component).

**Files:** `web/src/catalog/CatalogScreen.tsx`

**Approach:**
- Replace `const [openIndex, setOpenIndex] = useState<number | null>(null)` with a single
  open-target: `useState<{ list: CatalogProblem[]; index: number } | null>(null)`.
- `openProblem(problem)` (list taps, passed to `CatalogList` `onSelect`): find index in
  `displayed`; on hit set `{ list: displayed, index }`.
- Add `openRecent(problem)` (passed to `RecentsSheet` `onSelect`): find index in the full
  `problems` slab; set `{ list: problems, index }`. Because the recent is always present in the
  full slab, this never bails — the R6 fix.
- Detail `Drawer` `open` is `target !== null`; `onOpenChange` clears the target. Pass
  `problems={target.list}` and `initialIndex={target.index}` to `ProblemDetail`.
- Wrap both `RecentsSheet` (top) and the now-trigger-only `FilterSheet` (below) in one column:
  `<div className="pointer-events-none sticky bottom-4 z-30 mt-auto flex flex-col items-end gap-3">`.
  Move that column to where `<FilterSheet>` is rendered today.

**Patterns to follow:** the sticky/`mt-auto`/`pointer-events` idiom lifted from the current
`FilterSheet.tsx` wrapper; existing detail `Drawer` block in `CatalogScreen.tsx`.

**Test scenarios:**
- Opening a problem from the list still opens the detail pager at that problem and prev/next
  page through the filtered `displayed` order (unchanged behavior).
- Opening a recent that is **filtered out** of `displayed` still opens its detail (previously
  bailed) — pager opens on that problem and pages over the full slab.
- Closing the detail Drawer clears the open target.
- `Test note:` if `CatalogScreen`/`ProblemDetail` have no existing RTL harness, assert this at
  the `RecentsSheet` + open-target seam in U3's test rather than adding a new screen-level
  suite; keep coverage where a test already renders.

**Verification:** With a grade filter active that excludes a known recent, tapping that recent
in the sheet opens it; swiping in the pager moves through all problems, not just the filtered
set.

### U3. `RecentsSheet` component (FAB + bottom sheet)

**Goal:** New component mirroring `FilterSheet`: a `History` FAB that opens a "Recently viewed"
Drawer listing recent problems, shown only when recents exist.

**Requirements:** R2, R3, R4, R5.

**Dependencies:** none (consumed by U2).

**Files:** `web/src/catalog/RecentsSheet.tsx` (new),
`web/src/catalog/RecentsSheet.test.tsx` (new)

**Approach:**
- Props: `{ board, angle, problems, favoriteIds, onSelect }` (`onSelect` = `openRecent` from U2).
- Resolve recents internally: `const recentIds = useRecents(board.layoutId, angle)` then map
  against a `source_catalog_id → problem` `Map` built from `problems`, dropping ids not present
  (identical to the resolution currently in `CatalogList.tsx`).
- Return `null` when `recentProblems.length === 0` (R3) — the FAB disappears with no history.
- FAB: a `DrawerTrigger` styled to match the filter FAB — `pointer-events-auto relative flex
  size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg
  transition hover:opacity-90`, containing `<History className="size-6" />`, `aria-label="Recently
  viewed"`.
- Drawer: `<Drawer showSwipeHandle>` → `DrawerContent` with `DrawerHeader`/`DrawerTitle`
  "Recently viewed" plus a ghost "Clear" `Button` calling `clearRecents(board.layoutId, angle)`;
  scroll body `max-h-[70vh] overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom))]`
  (match `FilterSheet`).
- Rows: `recentProblems.map` → `CatalogRow` keyed by `source_catalog_id`, passing
  `board`, `isFavorite={favoriteIds.has(id)}`, `showThumbnail={useShowPreviews()}` (R5), and
  `onSelect`. Selecting a row should also close the drawer — use `DrawerClose` around the row or
  drive `open` state so the tap both selects and dismisses (mirror how the detail
  Drawer/`FilterSheet` handle close-on-action).

**Patterns to follow:** `web/src/catalog/FilterSheet.tsx` (FAB + Drawer structure),
`web/src/catalog/RecentlyViewed.tsx` (the id→problem resolution and `CatalogRow` usage) before
it is deleted in U4, `@/components/ui/drawer`.

**Test scenarios:**
- Renders nothing when `useRecents` is empty (no FAB in the DOM).
- With recents present, the FAB renders with `aria-label="Recently viewed"`.
- Opening the sheet lists one `CatalogRow` per resolved recent, in recents order (most-recent
  first), dropping ids absent from `problems`.
- Rows show thumbnails when `showClimbPreviews` is on and omit them when off (R5).
- "Clear" calls `clearRecents` and the sheet empties.
- Tapping a row calls `onSelect` with that problem and closes the sheet.

**Verification:** `vitest` suite green; manual — open a couple of problems, confirm the FAB
appears above the filter FAB, opens the sheet, and rows open the right problem.

### U4. Remove the in-list `RecentlyViewed` section

**Goal:** Delete the old top-of-list recents surface now that the FAB replaces it.

**Requirements:** R1.

**Dependencies:** U2, U3 (replacement must exist first).

**Files:** `web/src/catalog/CatalogList.tsx`, `web/src/catalog/RecentlyViewed.tsx` (delete)

**Approach:**
- In `CatalogList.tsx`: remove the `<RecentlyViewed .../>` render block, the `recentIds`/
  `recentProblems` `useMemo`, and the now-unused imports (`RecentlyViewed`, `useRecents`,
  `clearRecents`). Keep `useShowPreviews`/`toggleShowPreviews` (still used by the previews
  toggle) and the `favoriteIds` prop (still used by result rows). The `searchActive` guard that
  wrapped the section goes away with it.
- Delete `web/src/catalog/RecentlyViewed.tsx`.
- Confirm no other importers of `RecentlyViewed` remain (grep showed only `CatalogList.tsx`).
- Update `CatalogList.tsx`'s top comment (drop the "Recently viewed section" mention) and the
  `searchActive` prop JSDoc (it no longer hides recents — it still steers the empty-state hint).

**Patterns to follow:** existing `CatalogList.tsx` structure.

**Test scenarios:** `Test expectation: none — deletion of a UI section; the recents behavior it
provided is now covered by U3's RecentsSheet tests. Verify the existing catalog-list test suite
(if any) and typecheck still pass with the imports removed.`

**Verification:** `web` build/`tsc` clean (no dangling imports); catalog list no longer shows a
top recents section; the FAB path works.

---

## Verification Contract

- `web` typecheck/build passes with no unused-import or dangling-reference errors after U4.
- `web` unit tests pass, including the new `RecentsSheet.test.tsx`.
- Manual (real app): open ≥2 problems from the catalog; the `History` FAB appears above the
  filter FAB; tapping it opens the "Recently viewed" sheet with those problems (thumbnails
  following the previews toggle); tapping a row opens that problem; "Clear" empties recents and
  the FAB disappears; with a filter active that excludes a recent, that recent still opens from
  the sheet.

## Definition of Done

- R1–R6 satisfied.
- `RecentlyViewed.tsx` deleted; no references remain.
- `recentsStore.ts` and the `recordRecent` call site unchanged.
- Verification Contract gates green.

---

## Scope Boundaries

**In scope:** the four units above — FAB + sheet, the source-aware detail open (R6 bug fix),
and removal of the old section.

### Deferred to Follow-Up Work

- Extracting a shared `<Fab>` primitive from the two now-parallel FAB triggers. The FABs share
  markup after this change, but the extraction is a separate tidy; both are small enough to keep
  inline for now.
- Any change to recents capacity, keying, or the record-on-view trigger — out of scope by KTD4.

---

## Sources & Research

- iOS reference: `ios/MoonBoardLED/Views/CatalogListView.swift` (`recentFAB`, `recentSheet`,
  `filterMenuOverlay` VStack), `ios/MoonBoardLED/Views/CatalogProblemDetailView.swift`
  (`recordRecent`, `recentLimit = 5`).
- Web current state: `web/src/catalog/CatalogList.tsx`, `RecentlyViewed.tsx`,
  `recentsStore.ts`, `CatalogRow.tsx`, `ProblemDetail.tsx`, `FilterSheet.tsx`,
  `previewsStore.ts`, `@/components/ui/drawer`.
- Conventions: `web/CLAUDE.md` (shadcn/ui + Tailwind v4, `@/` alias, theme tokens, no ad-hoc CSS).

**Product Contract preservation:** N/A — solo plan (`ce-plan-bootstrap`); decisions settled in a
prior grilling session and captured verbatim as R1–R6.
