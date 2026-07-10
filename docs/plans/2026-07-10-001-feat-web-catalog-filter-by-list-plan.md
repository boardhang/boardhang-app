---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
date: 2026-07-10
---

# Web Catalog — Filter by Saved List - Plan

> **Implementation-ready.** The Goal Capsule and Product Contract (WHAT) below are the
> `ce-brainstorm` output, resolved in the 2026-07-10 grill-me interview and preserved unchanged.
> `ce-plan` added the HOW: Key Technical Decisions, Implementation Units, Verification Contract,
> and Definition of Done.
>
> **Product Contract preservation:** Product Contract unchanged (R1–R7, KTD1–9, defaults,
> non-goals, success signals carried verbatim). Planning discovered no conflict with product
> intent; the brainstorm's Outstanding Questions OQ1–OQ4 are HOW details now resolved in Key
> Technical Decisions.

---

## Goal Capsule

- **Objective:** Let a web user **filter the catalog browser by their Saved Lists** — pick one
  or more of their lists and the catalog shows only problems in those lists, composed with the
  existing grade/angle/hold-set/search/favorites filters. A list becomes a first-class **filter
  facet**, not a separate destination.
- **Product authority:** the user (solo/crew climber curating and browsing problems). Product
  decisions below were resolved in a `ce-brainstorm` / `grill-me` session on 2026-07-10.
- **Open blockers:** none. Saved Lists already ship on web (`web/src/lists/*`, #48), list
  membership is already offline-readable in IndexedDB, and catalog problems + list problems
  already share the **same join key** (`source_catalog_id`). The favorites filter is a
  near-exact template to generalize.
- **Tier:** **Standard** (new catalog-browsing UI over existing patterns; **no
  `supabase/migrations/**`**, no BLE, no geometry — see TD1). Plan → work → review → PR.

---

## Context — what already exists

- **Saved Lists (done, #48) — `web/src/lists/*`:** a list (`SavedList`) binds **one board**
  (`boardLayoutId`); a list's problem (`SavedListProblem`) is keyed by **`sourceCatalogId`**.
  Membership is offline-readable in IndexedDB (`web/src/lists/listsSync.ts`, DB `moonboard-lists`,
  store `list_problems` with a `list` index on `list_id`). Reactivity flows through
  `subscribeListProblemsChanged`. Read helpers already exist: `listIdsContaining(sourceCatalogId)`
  and `readListProblems(listId)`. In-memory lists are exposed by `useSavedLists()`
  (`web/src/lists/listsStore.ts`); a per-list reactive read exists at
  `web/src/lists/useListProblems.ts`.
- **Catalog filtering (done) — `web/src/catalog/*`, `web/src/shell/*`:** filters are a pure
  `FilterState` (`web/src/catalog/filters.ts`) applied by `applyFilters(problems, state, ctx)`,
  with runtime side-data (favorites set, ascents, hold-set) riding a separate `FilterContext`.
  The **URL is the source of truth** via TanStack Router (`web/src/catalog/catalogSearch.ts`:
  `filtersToSearch` / `searchToFilters`; route `/board/$layoutId/catalog` in
  `web/src/router.tsx`), defaults stripped from the URL. A per-`(board, angle)` **cold-launch
  seed** persists filters (`web/src/catalog/filterSeed.ts`) — write-through from `CatalogScreen`,
  read only by the `router.tsx` cold-launch redirect. Because the seed key is
  `catalogFilters_<layoutId>_<angle>`, a persisted list id **cannot leak across boards**.
- **Filter pill bar (done, #72) — `web/src/catalog/FilterPillBar.tsx`:** portaled into the
  frosted header slot (`web/src/shell/headerFilterSlot.ts`). Pinned toggles (Benchmark,
  Favorites) render inline; other active filters render as **removable chips** from
  `describeActiveFilters(state, ctx)` (`web/src/catalog/activeFilterChips.ts`), each chip carrying
  a `patch` that clears it.
- **The favorites analog (the template to generalize):** a **boolean** `favoritesOnly` in
  `FilterState`, a `fav=0|1` URL param, a `FilterContext.favoriteIds: Set<source_catalog_id>`,
  and a **single predicate line** in `applyFilters`
  (`if (s.favoritesOnly && !ctx.favoriteIds.has(p.source_catalog_id)) return false`). The list
  filter is this, generalized from one boolean + one set to a **set of selected list ids** + a
  **union member-id set**.
- **The join:** `source_catalog_id` (string) is shared by catalog problems (also the catalog
  IndexedDB keyPath), favorites, ascents, and `list_problems`. List membership is **not** loaded
  into the catalog view today — this feature introduces that read.

---

## Product Contract

### Core model

- **R1 — List is a catalog **filter facet**, not a destination.** In the normal catalog browser,
  the user can constrain results to "problems in my selected list(s)". It **composes** with every
  existing filter (grade, angle, hold-set, search, favorites, status) and reuses the #72 pill bar.
  It does **not** navigate away to a separate list view, and it does **not** turn the list-detail
  screen into a catalog grid (both alternatives were considered and rejected).
- **R2 — Multi-select, **OR** semantics.** The user can select **several** lists at once; the
  catalog shows problems that are in **any** selected list (**union** of member sets). AND
  (intersection) is a non-goal. The list facet as a whole **ANDs** with all other facets — i.e.
  the result is `(in any selected list) AND (matches grade) AND (favorited) AND …`.
- **R3 — Two entry points, one shared state.** Both write the **same** URL param, so the state
  is identical however it was set:
  1. **Catalog pill bar (primary):** a **"Lists" control** in the filter pill bar opens a
     **multi-select picker** of the user's lists **for the current board**; each picked list
     becomes a removable chip.
  2. **Lists screen bridge:** list cards and `ListDetailScreen` gain a **"Show in catalog"**
     action that deep-links into the catalog with that list applied.
- **R4 — Hidden when there's nothing to pick.** The "Lists" control appears **only** when the
  signed-in user has **≥1 list for the current board**. When signed out, or signed in with no
  lists for this board, the control is **absent** (no disabled/empty state — matches the app's
  "fully usable signed-out" posture). A `list=` deep-link that cannot resolve (signed out, or
  ids not matching a live list for this board) is **silently dropped**.
- **R5 — Persists like every other filter.** The applied list set is written to the **URL**
  (deep-linkable) **and** the per-`(board, angle)` **cold-launch seed**, so reopening the board
  resumes the view. On load the set is **validated**: any list id that no longer resolves to a
  live list for the current board (deleted, or a seed carried from another board) is dropped. The
  visible removable chip(s) keep the state from ever being hidden.
- **R6 — One removable chip per selected list.** Each selected list renders as its **own**
  removable chip labeled with the **list name** ("Projects ✕"), individually clearable — mirrors
  the existing removable-chip model. (A combined "Lists: N" chip and a `+K` overflow variant were
  considered; overflow is a deferred refinement, not built speculatively — see Non-goals.)
- **R7 — "Show in catalog" **replaces** the list set.** Triggering the bridge (R3.2) from the
  Lists screen sets the catalog's list filter to **just that list**, because from the Lists
  screen the user cannot see the catalog's current list filter, so OR-ing into an invisible set
  would surprise. **Other facets (grade, angle, hold-set, search, favorites) are preserved** —
  only the list set is replaced. Additive OR lives only where it is visible: the in-catalog
  picker (R3.1).

### Behavior & consistency (stated defaults — resolved in the grill)

- **KTD1 — Join on `source_catalog_id`.** Membership is matched against the catalog by
  `source_catalog_id`, exactly as favorites/ascents already do.
- **KTD2 — Board-scoped picker.** The picker offers **only** lists where
  `boardLayoutId === current board.layoutId` (the catalog is already board-scoped by route). Same
  scoping the AddToListSheet already uses (`web/src/lists/AddToListSheet.tsx`).
- **KTD3 — Live reactivity.** While a list filter is active, the catalog reflects membership
  changes **live** (via `subscribeListProblemsChanged`): removing a problem from a filtered list
  makes it drop out of the grid immediately; adding one makes it appear (subject to other active
  filters).
- **KTD4 — Catalog sort applies; list order is not imposed.** The facet **filters**; it does
  **not** re-order results into the list's manual/added order. The catalog's current sort governs
  ordering. (The deliberate consequence of R1 choosing a facet over a hybrid view.)
- **KTD5 — Works offline.** List membership is already in IndexedDB, so the filter works offline
  for cached lists — no new network dependency.
- **KTD6 — Empty result reuses the existing empty state.** When the composed filter matches
  nothing, the catalog renders its existing empty state (paralleling "None at this angle").

### Surfaces & navigation

- **KTD7 — Picker UI.** The pill-bar "Lists" control opens a **multi-select sheet** listing the
  current board's lists (checkbox per list). It sits alongside the existing pinned pill-bar
  controls but opens a sheet rather than toggling.
- **KTD8 — Chips.** Selected lists render as removable chips (R6) in the pill bar's
  removable-chip zone (`describeActiveFilters`); each `patch` removes just that list id.
- **KTD9 — URL param.** A `list` catalog search param (CSV of list ids for the OR set) mapped
  bidirectionally through `filtersToSearch`/`searchToFilters`; a `listFilter` field on
  `FilterState`; a `FilterContext` field carrying the union member-id
  `Set<source_catalog_id>`; and one predicate line in `applyFilters`.

---

## Key Technical Decisions

> **Identifier note.** `KTD1–9` are the **product-behavior** decisions in the Product Contract
> above (carried from the brainstorm); `TD1–8` below are the **planning/technical (HOW)**
> decisions. A unit that cites `KTD9` means the Product Contract item, not a `TD`.

- **TD1 — No database migration; read-only reuse.** The feature only *reads* existing
  `list_problems` rows the user can already see (RLS unchanged). Nothing under
  `supabase/migrations/**` changes, so this is **Standard** tier, not safety-critical. The
  membership read reuses the existing IndexedDB projection (`listsSync`) — no new network path.
- **TD2 — Generalize the favorites filter, don't invent a new mechanism.** Add `listFilter:
  string[]` to `FilterState` (default `[]`), a `listMemberIds: Set<string>` to `FilterContext`
  (the precomputed **union** of the selected lists' `source_catalog_id`s), a companion
  `listMembersReady: boolean` on `FilterContext`, and **one predicate line** in `applyFilters`
  beside the favorites line:
  `if (s.listFilter.length && ctx.listMembersReady && !ctx.listMemberIds.has(p.source_catalog_id)) return false`.
  The `listMembersReady` guard makes the facet a **no-op until membership has resolved** (fail
  **open** to everything, never a flash of zero results while IndexedDB reads are in flight — see
  TD5, U2, U3). OR semantics (R2) fall out of the union being built once, upstream, in the hook
  (TD5) — the predicate stays a single membership test.
- **TD3 — URL param `list` = CSV of list ids**, mirroring the existing `holds` / `method` CSV
  convention in `catalogSearch.ts`. Default `[]` is stripped from the URL (via the existing
  `stripSearchParams(CATALOG_SEARCH_DEFAULTS)` in `router.tsx`). Empty/whitespace tokens are
  dropped on parse. List ids are opaque strings — no ordinal encoding like `grade`.
- **TD4 — Single validation locus in `CatalogScreen`, gated on lists being loaded.**
  `CatalogScreen` **triggers `loadLists()` on mount** (cached-first, as `AddToListSheet` does on
  open — nothing else on the catalog surface warms the lists store; see `AddToListSheet.tsx:80`
  "Outside the Lists screens nothing calls `loadLists`"). It resolves `filters.listFilter`
  against the board-scoped live lists from `useSavedLists()` (filtered to
  `boardLayoutId === board.layoutId`), **dropping any id that does not resolve to a live list for
  the current board.** The prune and the URL self-heal fire **only once
  `useSavedLists().status === 'loaded'`** — while the store is `idle`/`loading`, the raw
  `listFilter` is kept as-is (no prune, no URL rewrite) and the facet stays a no-op via
  `listMembersReady` (TD2). This closes the cold-launch race: a valid `?list=` deep-link is **not**
  destroyed by pruning against an empty store before the lists finish loading. Once loaded, the
  prune covers deleted lists, foreign-board ids, signed-out (loaded-with-zero → all dropped → R4),
  and stale seed/deep-link ids (R5); when the pruned set differs, write it back (replace
  navigation). Chips and the union hook consume the **pruned** set, never the raw param.
- **TD5 — Reactive union membership hook with a readiness flag.** A new
  `useListMemberIds(listIds: string[])` (mirror `useListProblems`) reads each selected list's
  members from IndexedDB, unions their `source_catalog_id`s into one `Set<string>`, and re-reads
  on `subscribeListProblemsChanged` so KTD3 (live) holds. It reuses `readListProblems` (per list)
  or a small batch helper added to `listsSync.ts`; no new store state. It returns **both** the
  union set **and** a `ready` boolean (`false` until the first read for the current `listIds`
  resolves; trivially `true` for an empty `listIds`; drops back to `false` on a selection change
  until the new read resolves). **`CatalogScreen` gates `FilterContext.listMembersReady` as
  `listsLoaded && ready`, not `ready` alone** — a bare resolved read flips `true` even against an
  empty/cleared cache (signed out, or before the cold pull), which would blank the grid for a
  selected-but-unresolved list; ANDing with `useSavedLists().status === 'loaded'` keeps the facet
  fail-**open** until membership is truly known. **`applyFilters` also runs against the pruned
  `listFilter`** (an `effectiveFilters` built from the pruned set), so a fully-pruned selection
  is a no-op immediately rather than flashing zero in the render before the self-heal (TD4)
  rewrites the URL. Together: no blank grid signed-out, on cold launch, or on a stale deep-link.
- **TD6 — "Lists" opener is a pinned control; selection renders as chips.** Add a pinned "Lists"
  control to `FilterPillBar` (sibling of the Favorites toggle) that opens the multi-select sheet
  (TD7); it is **rendered only when the board has ≥1 loaded list** (R4). Selected lists become
  removable chips via a new branch in `describeActiveFilters` — one `FilterChip` per id,
  `label` = the list's name, `patch` = `listFilter` minus that id. **Chip labels need a name
  lookup that `describeActiveFilters` does not have today** (its context is `{inSession,
  statusReady}`, and `applyFilters`' `FilterContext` — favoriteIds/etc. — never flows to it). So
  `CatalogScreen` computes a board-scoped `listsById` from `useSavedLists()` and threads it as a
  **new prop** into `FilterPillBar`, which passes it into `describeActiveFilters`' context; an id
  with no matching live list yields no chip (defense in depth with TD4). **Long names** (up to
  `MAX_LIST_NAME` = 60) get a `max-width` + `truncate` with the full name in a `title` tooltip, so
  one chip can't dominate the single-line, non-wrapping pill bar. **Same-named lists** (names are
  not unique — presets include "Projects") get a short disambiguator suffix (e.g. a trailing
  index) so two selected lists never render as two identical chips.
- **TD7 — Picker sheet mirrors `AddToListSheet`, live per-row toggle (no batched Apply).** A new
  `ListFilterSheet` reuses the board-scoped list enumeration and row/checkbox affordances of
  `AddToListSheet.tsx`, but its checkboxes toggle membership **in `listFilter`** (the filter
  selection) rather than adding the problem to a list. Each checkbox toggle writes `listFilter`
  through the existing `setFilters` path **immediately** — the catalog updates **live behind the
  open sheet**, mirroring `AddToListSheet` and the pill bar's other instant-apply controls. There
  is **no** separate confirm/Apply gesture.
- **TD8 — Bridge is a fresh navigation with `list` only.** "Show in catalog" navigates to
  `/board/$layoutId/catalog` with search `{ list: thatId }` (a single id — the `list` param is a
  CSV **string**, not an array, per TD3; one id needs no join) and no other facet params; the
  remaining facets hydrate from that board+angle's seed via the normal cold-launch/route path, so
  R7's "replace the list set, preserve other facets" holds without the Lists screen needing to
  know the catalog's current facets.

---

## Implementation Units

### U1. Facet plumbing — `FilterState`, predicate, and URL param

- **Goal:** Make "in any selected list" a real, URL-addressable, persisted filter that
  `applyFilters` honors. No UI yet.
- **Requirements:** R1, R2 (union via a single membership set), R5 (URL + seed), KTD1, KTD9, TD2,
  TD3.
- **Dependencies:** none.
- **Files:**
  - `web/src/catalog/filters.ts` — add `listFilter: string[]` to `FilterState`; add `[]` to
    `DEFAULT_FILTERS`; add `listMemberIds: Set<string>` **and `listMembersReady: boolean`** to
    `FilterContext`; add the readiness-gated predicate line beside favorites (TD2).
  - `web/src/catalog/catalogSearch.ts` — add `list` (CSV) to `CatalogSearch`,
    `CATALOG_SEARCH_DEFAULTS`, **and `validateCatalogSearch`** (the route's `validateSearch`
    object literal — a `list` key missing there is silently dropped on every read, so `?list=`
    deep-links would never hydrate); map in `filtersToSearch` (join ids with `,`, omit when empty)
    and `searchToFilters` (split, drop empties).
  - `web/src/catalog/filters.test.ts`, `web/src/catalog/catalogSearch.test.ts` — extend.
  - `docs/navigation-and-ui-flows.md` — document the new `list` param in the web-routing section
    (same commit, per doc discipline).
- **Approach:** Follow the `favoritesOnly` / `fav` pairing exactly. The predicate is a single
  membership test against the precomputed union set (built in U2/U3), so OR needs no special
  logic here. Seed persistence is automatic: `filterSeed` serializes the whole `FilterState`, so
  `listFilter` rides along; the pruning that keeps it honest lives in U3, not here.
- **Patterns to follow:** `favoritesOnly` in `filters.ts`; `holds` / `method` CSV mapping in
  `catalogSearch.ts`.
- **Test scenarios:**
  - `filters.test.ts`: with `listFilter: ['a']`, `listMembersReady: true`, and
    `ctx.listMemberIds = {p1}`, a problem with `source_catalog_id p1` passes and `p2` is filtered
    out.
  - `filters.test.ts`: `listFilter: []` is a no-op (all problems pass regardless of
    `listMemberIds`).
  - `filters.test.ts`: **readiness gate** — `listFilter: ['a']` with `listMembersReady: false`
    (and an empty `listMemberIds`) passes **all** problems (fail-open while loading, TD2/TD5),
    not zero.
  - `filters.test.ts`: list facet ANDs with favorites — a problem in the list but not favorited
    is filtered out when `favoritesOnly` is on (composition, KTD/R2).
  - `catalogSearch.test.ts`: `filtersToSearch({listFilter:['a','b']})` → `list: 'a,b'`;
    `listFilter: []` omits the param.
  - `catalogSearch.test.ts`: `searchToFilters({list:'a,b'})` → `['a','b']`; `searchToFilters`
    of `''` / missing → `[]`; a trailing comma / empty token is dropped.
- **Verification:** `applyFilters` narrows to list members when `listFilter` is set and
  `listMemberIds` is populated; the `list` param round-trips through the URL mappers; defaults
  strip cleanly.

### U2. Reactive union membership hook — `useListMemberIds`

- **Goal:** Given the selected list ids, produce the live union `Set<source_catalog_id>` **plus a
  `ready` flag** that feed `FilterContext.listMemberIds` / `listMembersReady`.
- **Requirements:** R2 (union), KTD3 (live), KTD5 (offline), TD5.
- **Dependencies:** none (independent of U1; consumed by U3).
- **Files:**
  - `web/src/lists/useListMemberIds.ts` (new) — hook returning `{ ids: Set<string>, ready:
    boolean }`: read each id's members from IndexedDB, union `sourceCatalogId`s, re-read on
    `subscribeListProblemsChanged`.
  - `web/src/lists/listsSync.ts` — optional small batch helper (e.g. read members for N list ids)
    if it reads cleaner than looping `readListProblems`.
  - `web/src/lists/useListMemberIds.test.ts` (new).
- **Approach:** Mirror `useListProblems.ts` (same subscribe/re-read cadence). Empty `listIds` →
  `{ ids: ∅, ready: true }` without touching IndexedDB. For a non-empty `listIds`, `ready` is
  `false` until the first read for that id set resolves, then `true`; while in flight, return the
  last resolved set. The `ready` flag is the single signal that makes the `applyFilters` predicate
  fail **open** while loading (TD2/TD5) — U3 wires it into `FilterContext.listMembersReady`, so
  neither U2 nor U3 has to conflate "empty set" with "still loading".
- **Patterns to follow:** `web/src/lists/useListProblems.ts`; `listIdsContaining` /
  `readListProblems` in `listsSync.ts`.
- **Test scenarios:**
  - Single list id → set equals that list's `source_catalog_id`s.
  - Two list ids with an overlapping problem → union has the problem **once** (dedup).
  - Empty id array → `{ ids: ∅, ready: true }`, no IndexedDB read.
  - **Readiness:** for a non-empty `listIds`, `ready` is `false` on first render and flips to
    `true` after the read resolves; a subsequent `listIds` change flips `ready` back to `false`
    until the new read resolves.
  - After a `subscribeListProblemsChanged` fire that added a problem to a selected list, the hook
    re-reads and the set grows (live, KTD3). Covers the "remove makes it drop out" case
    symmetrically.
  - Integration: the hook reads from the IndexedDB layer (not a mock of the store), proving
    offline-source membership (KTD5).
- **Verification:** Selecting lists yields the correct deduped union; mutating a selected list's
  membership updates the set without a remount.

### U3. Wire membership into `CatalogScreen` + validate/prune list ids

- **Goal:** Feed the union set + readiness into `FilterContext`, warm the lists store, and enforce
  R4/R5 by pruning ids that don't resolve to a live list — **without destroying a valid deep-link
  on cold launch.**
- **Requirements:** R4, R5, KTD2, KTD3, TD4, TD5.
- **Dependencies:** U1, U2.
- **Files:**
  - `web/src/catalog/CatalogScreen.tsx` — call `loadLists()` on mount (cached-first); resolve
    `filters.listFilter` against board-scoped `useSavedLists()`; **prune + URL self-heal only when
    `status === 'loaded'`**; feed pruned ids to `useListMemberIds`; set
    `FilterContext.listMemberIds` + `listMembersReady`; compute a board-scoped `listsById` and
    thread it (new prop) to `FilterPillBar`.
  - `web/src/catalog/CatalogScreen.test.tsx` — extend.
  - `web/src/catalog/filterSeed.ts` — no code change expected (whole-state serialization already
    carries `listFilter`); add a comment noting validation happens at resolve time in
    `CatalogScreen`, gated on lists being loaded — not here.
- **Approach:** **Warm the store first** — nothing on the catalog surface calls `loadLists` today
  (`AddToListSheet.tsx:80` documents this), so without a mount-time `loadLists()` the store is
  `idle`/empty and every id looks non-resolving. Board-scope lists exactly as `AddToListSheet.tsx:54`
  does (`boardLayoutId === board.layoutId`). **Only once `useSavedLists().status === 'loaded'`**
  build a `Set` of live board list ids and keep only matching `listFilter` ids; if the pruned array
  differs from the current param, `setFilters` (replace navigation) so the URL self-heals. **While
  `idle`/`loading`, do not prune and do not rewrite the URL** — keep the raw `listFilter`; the facet
  stays a no-op because `listMembersReady` is `false` (U2). This is the fix for the cold-launch /
  shared-deep-link race: a legitimate `?list=` id survives until the lists actually load. Pass
  `listsById` down so U4 can label chips.
- **Patterns to follow:** `loadLists()` on open in `AddToListSheet.tsx`; existing `FilterContext`
  assembly in `CatalogScreen.tsx` (favorites, ascents, hold-set); `setFilters` → `saveSeed` +
  `navigate(..., {replace:true})`; `ListsStatus` (`idle`/`loading`/`loaded`/`error`/`offline`) on
  the lists store.
- **Test scenarios:**
  - **Cold-launch deep-link survives (the P1 regression guard):** mount with `list=<validId>`
    while `useSavedLists().status` is `loading` → **no** prune, **no** URL rewrite, grid shows all
    (fail-open); after the store resolves to `loaded` containing that id → membership applies and
    the `list=` param is retained. Covers R5/R3.2.
  - `loadLists()` is invoked on mount (cached-first), mirroring `AddToListSheet`.
  - After `loaded`: `list` param with one id matching a live board list → `FilterContext`
    populated, `listMembersReady` true.
  - After `loaded`: a deleted / unknown id → pruned; URL rewritten without it (R5).
  - After `loaded`: an id belonging to another board's list → pruned (KTD2/R4).
  - Signed-out → store resolves to `loaded` with zero lists → all ids pruned, catalog unfiltered,
    no error (R4).
  - Empty state: a valid list filter matching no problems at the current angle renders the existing
    empty state, not a crash (KTD6).
- **Verification:** A shared deep-link opens filtered (not blanked, not stripped) even on a cold
  launch; a stale id self-heals only after lists load; switching boards never carries another
  board's list filter.

### U4. Pill-bar "Lists" control, picker sheet, and per-list chips

- **Goal:** The in-catalog entry point (R3.1): open a multi-select of the board's lists; show each
  selection as a removable chip.
- **Requirements:** R3.1, R4, R6, KTD7, KTD8, TD6, TD7.
- **Dependencies:** U1 (for `listFilter` + `setFilters`); U3 (for `loadLists`, board `listsById` +
  pruned set + the new `FilterPillBar` prop).
- **Files:**
  - `web/src/catalog/ListFilterSheet.tsx` (new) — multi-select sheet of board lists; each row
    toggle writes `listFilter` **live** via `setFilters` (no batched Apply).
  - `web/src/catalog/FilterPillBar.tsx` — pinned "Lists" opener, rendered only when the board has
    ≥1 loaded list (R4); accept the new `listsById` prop and pass it into `describeActiveFilters`'
    context.
  - `web/src/catalog/activeFilterChips.ts` — extend `describeActiveFilters`' context arg (today
    `{inSession, statusReady}`) with a `listsById` name lookup; new branch emitting one
    `FilterChip` per selected list id (label = list name, **truncated** with a `title` tooltip;
    same-named lists get a short disambiguator suffix; `patch` removes that id). Slot in the chip
    order (e.g. after grade, before holds — decide at build time for scan order).
  - `web/src/catalog/ListFilterSheet.test.tsx` (new), `web/src/catalog/activeFilterChips.test.ts`
    (extend).
- **Approach:** `ListFilterSheet` reuses the board-scoped enumeration + row/checkbox affordances
  of `AddToListSheet.tsx`, but checkboxes reflect/toggle `listFilter` membership (not list
  membership of a problem) and write **immediately** via `setFilters` — the catalog updates live
  behind the open sheet (TD7), matching `AddToListSheet` and the pill bar's instant controls; there
  is no confirm step. The opener follows the Favorites pinned-control pattern in `FilterPillBar` but
  opens the sheet instead of toggling a boolean. Chip labels come from the `listsById` lookup
  threaded from `CatalogScreen` (U3) — **not** `applyFilters`' `FilterContext`, which never reaches
  `describeActiveFilters`.
- **Patterns to follow:** `web/src/lists/AddToListSheet.tsx` (board-scoped list rows, live checkbox
  toggles); Favorites pinned control + removable-chip rendering in `FilterPillBar.tsx`;
  `describeActiveFilters` chip shape + context arg in `activeFilterChips.ts`.
- **Test scenarios:**
  - `activeFilterChips.test.ts`: `listFilter: ['a','b']` with `listsById` {a:"Projects",
    b:"Warm-ups"} → two chips labeled "Projects" and "Warm-ups"; each `patch` removes only its own
    id.
  - `activeFilterChips.test.ts`: a `listFilter` id absent from `listsById` → no chip (TD6).
  - `activeFilterChips.test.ts`: two selected lists sharing a name → chips are **distinguishable**
    (disambiguator applied), not two identical labels (TD6/D).
  - `activeFilterChips.test.ts`: a list name at `MAX_LIST_NAME` (60 chars) → chip label truncates
    (asserts the truncation class / `title`), so it can't dominate the bar.
  - `ListFilterSheet.test.tsx`: only the current board's lists are listed (KTD2); toggling a row
    updates `listFilter` immediately (live, no Apply button); already-selected lists render checked.
  - `FilterPillBar`: the "Lists" opener is absent when the board has 0 lists (R4) and present when
    ≥1 (assert per existing pill-bar test style).
- **Verification:** Selecting two lists narrows the catalog to their union live behind the sheet
  with two distinguishable chips; removing one chip narrows to the other; a long list name doesn't
  push other chips off-screen; no "Lists" control on a board with no lists.

### U5. "Show in catalog" bridge from the Lists screen

- **Goal:** The second entry point (R3.2/R7): jump from a list into the catalog pre-filtered to
  just that list.
- **Requirements:** R3.2, R7, TD8.
- **Dependencies:** U1 (the `list` param must exist).
- **Files:**
  - `web/src/lists/ListsScreen.tsx` **and** `web/src/lists/ListDetailScreen.tsx` — a "Show in
    catalog" action on **both** the list card (ListsScreen) and the detail header
    (ListDetailScreen), per R3.2, linking to `/board/$layoutId/catalog` with search
    `{ list: listId }` (a single id string, per TD8 — not an array).
  - `web/src/lists/ListsScreen.test.tsx` **and** `web/src/lists/ListDetailScreen.test.tsx` —
    extend.
- **Approach:** Use the list's own `boardLayoutId` for the route param and set only the `list`
  search param (single id string); all other facets hydrate from that board's seed (TD8).
  Navigation **replaces** the list set, preserving other facets by construction. Both surfaces are
  required (R3.2); only their exact placement/styling is a build detail — see Open Questions.
- **Patterns to follow:** existing TanStack Router `Link`/`navigate` usage into
  `/board/$layoutId/catalog`; the catalog route's `validateSearch`.
- **Test scenarios:**
  - Triggering "Show in catalog" for a list navigates to that list's board catalog with
    `list=<id>` in the search.
  - The action targets the **list's** board, not the currently-viewed board (a list bound to
    another board routes to its own board).
  - The navigation sets only `list` (other facet params absent → hydrate from seed), satisfying
    R7's "preserve other facets, replace list set".
- **Verification:** From a list, "Show in catalog" lands in the catalog showing only that list's
  problems, with any previously-seeded grade/angle intact.

---

## Verification Contract

Gates for the whole change (run before PR):

- **Types/build:** `npm run build` (i.e. `tsc -b` + Vite) is clean. Do **not** rely on
  `tsc --noEmit` — the root tsconfig is a no-op solution file.
- **Lint:** `npm run lint` (oxlint) clean. Do **not** run Prettier in `web/` (no config → it
  corrupts the single-quote / no-semi house style).
- **Unit:** `npx vitest run` green, including the extended/added tests above.
- **Browser smoke (manual, the end-to-end proof the units don't individually cover):**
  1. Signed in with ≥1 list for the board → "Lists" control shows; open the picker, tick two
     lists → catalog updates **live behind the open sheet** to their **union**; two chips appear;
     layer a grade filter → composes (AND).
  2. Remove one chip → narrows to the other list; clear both → catalog returns to unfiltered.
  3. Add/remove a problem from a filtered list (via AddToListSheet) → grid updates **live**.
  4. Copy the URL, **hard-reload / open in a fresh tab (cold launch)** → same filtered view, the
     `list=` param is **not** stripped while lists load (the P1 guard); then delete one of the
     lists, reload → that stale id dropped, URL self-heals.
  5. Signed out (or a board with no lists) → no "Lists" control; a `list=` deep-link opens
     unfiltered.
  6. From the Lists screen, "Show in catalog" → catalog filtered to just that list, other facets
     intact.

---

## Definition of Done

- R1–R7 satisfied; the six browser-smoke flows above pass.
- All Verification Contract gates green (build, lint, vitest).
- No `supabase/migrations/**` change (TD1); `ascents`/`list_problems` RLS untouched.
- `docs/navigation-and-ui-flows.md` documents the `list` catalog param (same PR, doc discipline).
- PR opened per AGENTS.md conventions (branch `feat/web-list-catalog-filter`, Standard tier:
  plan → work → review → PR), body linking this plan.

---

## Open Questions (deferred to implementation)

- **Chip order slot.** Where the per-list chips sit in `describeActiveFilters`' order
  (grade → stars → methods → status → holds today). Low-stakes; decide for best scan order at
  build (leaning: right after grade).
- **Bridge placement/styling.** Both surfaces are required (card + detail, R3.2/U5) — only the
  exact placement and styling of each "Show in catalog" affordance is open; confirm against the
  existing list action affordances at build. (Not a surface-count decision.)
- **Same-name chip disambiguator.** The exact form of the disambiguator for two selected lists
  sharing a name (TD6/D) — a trailing index, a subtle marker, or another affordance — is a
  build-time styling choice; the requirement (they must be distinguishable) is fixed.
- **Batch membership read shape.** Whether `useListMemberIds` loops `readListProblems` or a new
  `listsSync` batch helper reads cleaner (TD5) — an execution-time call once the real IndexedDB
  read is in front of the implementer.

---

## Non-goals (this phase)

- **iOS** — web-only v1 (iOS lists/catalog filtering unchanged).
- **AND (intersection) across lists** — OR only.
- **`+K` overflow / combined chip UI** — deferred; one named chip per list for v1 (R6).
- **Any change to list authoring, sharing, or the collaborative-lists work** — this feature only
  *reads* existing list membership; it is orthogonal to
  `docs/plans/2026-07-09-001-feat-web-collaborative-lists-plan.md`. If shared lists later land,
  this filter benefits automatically (RLS already scopes `list_problems` to the caller's
  memberships) with no special handling.
- **Cross-board / multi-board list filtering** — a list binds one board; the filter is
  board-scoped.
- **Sorting the catalog by list order** — see KTD4.

---

## Success signals

- With ≥1 list for the current board, a "Lists" control appears in the catalog filter pill bar;
  the user multi-selects two lists and the catalog shows the **union** of their problems, layered
  under grade/angle/hold-set. Each selected list shows as its own removable chip.
- Signed out (or with no lists for this board), the "Lists" control is **absent**; a shared
  `list=` deep-link that can't resolve opens the catalog unfiltered rather than erroring.
- From the Lists screen, "Show in catalog" opens the catalog filtered to **just** that list,
  preserving any existing grade/angle filters.
- Reopening the board (cold launch) **resumes** the last list filter from the seed; a list deleted
  meanwhile is silently dropped and the catalog opens without it.
- Removing a problem from a currently-filtered list makes it disappear from the catalog grid
  immediately (live), offline included.
