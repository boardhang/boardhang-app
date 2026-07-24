# Pinnable filters in the catalog header

**Branch:** `feat/web-pinnable-filters` · **Tier:** Routine (web UI; no BLE / board geometry / migrations)

## Problem

The catalog's top-nav filter bar (`FilterPillBar`) has two hardcoded classes of control:
a fixed set of always-visible "pinned" toggles (Benchmarks, Favorites, Lists) and an
auto-generated removable chip per *active* filter (grade, stars, methods, status, holds).
Which controls sit in the nav is not user-configurable. Users want to **pin** the filters
they reach for (e.g. Grade) so they're always one tap away, and **unpin** ones they never use.

## Design (resolved via grilling)

- **Pin = a user-configurable always-visible quick control in the nav**, generalizing the
  current hardcoded Benchmarks/Favorites/Lists. A pinned facet shows even when inactive.
- **All facets are pinnable.** Toggle facets flip inline; rich facets (Grade, Holds, Sort,
  min-stars, Status, Methods) open a **popover** with the control + an inline **Clear**
  (Holds opens the existing full-board `HoldFilterPicker` directly). No ✕ micro-targets in
  the nav; an active rich facet gets an accent style.
- **Persistence:** a new `pinnedFiltersStore`, keyed **per `layoutId`** (not per angle —
  angle doesn't change which facets exist; different boards may want different pins).
  Default pinned set for a new layout = `['benchmarks', 'favorites', 'lists']`, so nothing
  changes for existing users until they customize.
- **One unified nav-render rule** (replaces the pinned/chip split): a facet is shown **once** —
  *pinned* → always shown as its control (reflecting the active value when set); *not pinned
  but active* → the existing removable chip; *not pinned, inactive* → hidden.
- **Fixed canonical order** for pinned controls (Sort, Grade, Holds, Benchmarks, Favorites,
  min-stars, Status, Methods, Lists), then a divider, then the unpinned-active chips. Stable
  positions build muscle memory.
- **Pin control in the sheet:** a per-row `Pin`/`PinOff` icon in each facet's header in
  `FilterControls`. Toggling updates the nav live (no save button).

## Implementation units

- **U1. `pinnableFacets.ts`** — canonical facet descriptors: `id`, `label`, `order`,
  `kind: 'toggle' | 'rich'`, `isActive(state)`, `activeLabel(state)`, `clearPatch`. Single
  source of truth shared by the sheet (pin icons) and the nav (unified render).
- **U2. `pinnedFiltersStore.ts`** — `useSyncExternalStore` + localStorage, keyed
  `catalogPinnedFilters_{layoutId}`, default `['benchmarks','favorites','lists']`,
  `isPinned` / `togglePinned(layoutId, id)` / `usePinnedFacets(layoutId)`.
- **U3. `FacetControlPopover.tsx`** — renders a rich facet's control inside a shadcn Popover
  (Grade slider, min-stars select, Status toggles, Methods toggles, Sort selects) with an
  inline Clear; Holds routes to `HoldFilterPicker`. Reuses the same primitives as the sheet.
- **U4. `FilterPillBar` rewrite** — render pinned facets in canonical order (toggle inline /
  rich → popover), divider, then `describeActiveFilters` chips for **unpinned active** facets.
- **U5. `FilterControls` pin icons** — a pin toggle in each facet row header, wired to U2.
- **U6. `CatalogScreen` wiring** — pass `layoutId` + pinned set to `FilterPillBar`.

## Non-goals

Per-angle or per-board(non-layout) pinning; reordering pinned controls by hand; syncing pins
to the account. All deferrable.
