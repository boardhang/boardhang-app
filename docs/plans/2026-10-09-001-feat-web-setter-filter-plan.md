---
title: Filter the web catalog by setter - Plan
type: feat
date: 2026-10-09
topic: web-setter-filter
execution: code
---

# Filter the web catalog by setter - Plan

## Goal

Add a **Setter** facet to the web catalog: a searchable list of every setter on the current
board + angle, each with the number of their climbs that pass the *other* active filters, tick
any number of them (OR), and the list narrows to those setters' problems. Tier: **Standard**
(catalog-browsing UI inside the existing facet pattern; no schema, no BLE, no geometry).

## Decisions (grilled 2026-10-09)

- **Build it now**, no wayfinder map: one session of work inside an existing pattern.
- **Multi-select, OR** — like Lists and Method. Header chip reads the name when one setter is
  picked, `Setters (n)` otherwise.
- **Counts shrink with the other active filters** (faceted counts): a setter's number is how many
  of their problems pass every filter *except* the setter filter itself, so ticking one setter never
  zeroes the others. Setters with 0 under the current filters stay in the list, greyed, at the
  bottom.
- **Before typing, the list shows the top 100 setters by count** with a hint that the rest are
  reachable by search; typing filters the whole set (case-insensitive substring).
- **Names are matched exactly as stored**, case included (`Kyle Knapp` and `kyle knapp` are two
  entries — they may be two accounts). Leading/trailing whitespace *is* trimmed for grouping and
  matching: thousands of catalog rows carry a stray trailing space and a trailing space is never
  a different person.
- **Entry points:** a Setter row in the Filters sheet, a pinnable header control (unpinned +
  active → removable chip), and the URL (`?setter=`). *Not* in scope: tapping the setter name on
  a problem to filter by it.
- The main search box keeps matching setter names; the facet ANDs on top of it like every filter.

## Units

1. **`filters.ts`** — `FilterState.setterFilter: string[]`; predicate `setterFilter.includes
   (p.setter.trim())`; counted in `activeFilterCount`. Split the filter pass out of `applyFilters`
   as `filterProblems` (no sort) and add `setterOptions(problems, state, ctx)`: every distinct
   trimmed setter in the slab with its count under `{...state, setterFilter: []}`, sorted count
   desc then name. Plus `SETTER_LABEL`.
2. **`catalogSearch.ts`** — `setter` param: each name `encodeURIComponent`-ed, comma-joined
   (13 catalog setters contain a comma, two contain `|`). Decode trims, drops empties, dedupes.
3. **`pinnableFacets.ts` / `pinnedFiltersStore.ts` / `activeFilterChips.ts`** — facet id
   `setters` appended to `CANONICAL_ORDER` (after Lists, so no existing pin moves), active/label/
   clear-patch cases, `VALID` entry, one collapsed chip.
4. **`SetterFilterSheet.tsx`** (new) — nested shadcn Drawer: title, search `Input`, Clear all,
   rows (round check + name with the count captioned underneath as "227 problems" / "No problems
   match", dimmed at 0 — the caption replaces a description line; picked from four prototyped row
   layouts), top-100 cap with a "N more — type to search" hint, selected setters pinned to the
   top so a selection is always removable even when it sits past the cap or is absent from this
   slab. Live toggles (no Apply), like `ListFilterSheet`.
5. **`FilterControls.tsx`** — "Setter" `Field` with a Holds-style opener row ("Any" / name /
   "n selected") that opens the sheet. **`FilterPillBar.tsx`** — `setters` pinned control opens
   the same sheet; `FacetControlPopover`'s facet union excludes it like Lists. **`FilterSheet` /
   `CatalogScreen`** — thread a lazily-evaluated `getSetterOptions` thunk (memoised on filters +
   context + `newSince` view) so the counts are computed only while a sheet is open.
6. **Tests** — predicate + options counting (`filters.test.ts`), codec round-trip with commas
   (`catalogSearch.test.ts`), chip + facet label (`activeFilterChips.test.ts`,
   `pinnableFacets.test.ts`), sheet behaviour (`SetterFilterSheet.test.tsx`), the sheet row and the
   pinned control (`FilterControls.test.tsx`, `FilterPillBar.test.tsx`).
7. **Docs** — `docs/navigation-and-ui-flows.md` catalog search params: add `setter`.

## Out of scope

- iOS parity (iOS is on hold). Tap-to-filter from a problem's setter line. Merging case variants.
- Aurora/Kilter: the facet reads `p.setter`, which the Aurora rows also fill, so nothing here is
  MoonBoard-specific; Kilter's facet set is decided on the Kilter map (#163).
