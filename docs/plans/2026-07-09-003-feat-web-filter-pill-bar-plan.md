---
title: "feat: Sticky catalog filter pill bar — always-on Benchmark toggle + removable active-filter pills in the header"
date: 2026-07-09
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: grill-me
depth: standard
tier: routine
---

# feat: Sticky catalog filter pill bar

## Summary

Add a **single horizontally-scrolling pill row to the frosted sticky header, on the catalog
route only**. The first pill is an always-visible **Benchmark toggle** (the most-used filter,
toggled on/off in place). Following it, every **active** filter is shown as a **dismissible
pill** so a user can drop filters one at a time — without opening the filter bottom sheet.

Today the only way to change a filter is the floating filter FAB → bottom sheet (`FilterSheet`
→ `FilterControls`). Benchmark-only lives buried in a "Filter" row inside that sheet, and there
is no glanceable summary of what's currently filtering the list. This plan surfaces the
Benchmark toggle and an at-a-glance, tap-to-remove view of the active filter set at the top of
the screen, while leaving the FAB/sheet — where filters are *built* — completely untouched.

Scope is **presentation + fast removal of already-modelled filter state**. No new filter
capability, no filter-model changes, no sheet changes.

---

## Problem Frame

`FilterState` (`web/src/catalog/filters.ts`) is fully URL-backed: `CatalogScreen.tsx` reads it
via `searchToFilters(search)` and writes it via `setFilters(next)` (lines ~111–115), which also
persists the cold-launch seed (`saveSeed`, `filterSeed.ts`) before writing the URL. The list is
filtered by `applyFilters(problems, filters, context)`.

Two gaps this plan closes:

1. **Benchmark reachability.** `benchmarkOnly` is the most-toggled filter but is reachable only
   by opening the FAB → sheet and finding the "Filter" row (`FilterControls.tsx:176`). The user
   wants it one tap away, always on screen.
2. **No active-filter summary / fast removal.** Nothing shows *what* is currently filtering the
   list, and removing any single filter means reopening the sheet. There's an `activeFilterCount`
   (drives the FAB badge) but no per-filter affordance.

The header is the natural home: it's already a `position: sticky; top: 0` frosted bar
(`AppLayout.tsx` header, `App.css` `.app-header`) built from stacked `.app-header-slot` divs that
**collapse to zero height when `:empty`**. A new catalog-only slot inherits the frosting,
scroll-shadow, and safe-area handling for free, and sidesteps the "sticky just below a
dynamic-height header" offset problem entirely.

The design below was fully resolved in a grill-me session; the resolved decisions are captured as
KTDs so this plan does not re-litigate them.

---

## Product Contract

### Requirements

- **R1 — Placement.** On the **catalog route only**, a pill row renders inside the sticky frosted
  header, below the existing SessionPill slot. On every other route the slot is empty and
  collapses to zero height (no layout cost). The row is part of the sticky header, so it stays
  visible while the list scrolls.
- **R2 — Always-on pinned toggles: Benchmark + Favorites.** The **first two** pills are the
  Benchmark and Favorites toggles, in that order. Both are **always shown** (even with no filters
  active and even when off). Tapping toggles `benchmarkOnly` / `favoritesOnly`. Each is a **pure
  toggle with no ✕**: outline when off, **accent-filled** when on (the `Toggle`'s default pressed
  fill — *not* the benchmark-amber token; the amber was tried and rejected in review as too loud).
  Both reuse the existing `Toggle` primitive and share one label constant each (`BENCHMARK_LABEL`
  / `FAVORITES_LABEL` in `filters.ts`) with the sheet's own toggles so the two surfaces never drift.
- **R3 — Active-filter pills.** After the pinned toggles (separated by a hairline divider, shown
  only when ≥1 pill is present), every currently-active filter appears as a **dismissible pill**.
  Tapping **anywhere on the pill removes** that filter; each pill shows a trailing **✕ glyph as a
  discoverability cue** (the ✕ is not a separate hit target). The pills are styled as **outlined
  gray tags** (border + `text-muted-foreground`, transparent fill) so they read as secondary to
  the accent-filled pinned toggles — a *filled* gray would vanish into the near-white frosted
  header in light mode (`--muted ≈ --background`), so the **border carries the shape**.
- **R4 — One pill per selected value.** Array-valued filters render **one pill per selected
  value**: each selected **method** (`methods[]`) and each selected **solo ascent status**
  (`statusFilters[]`, subject to R9's gating) is its own removable pill. (`favoritesOnly` is **not**
  a removable pill — it is a pinned toggle, R2.)
- **R5 — Single-pill filters.** `gradeRange` renders as **one** pill labelled with the font
  grades (e.g. `6A–7B`); removing it clears the range (`gradeRange: null`). `minStars` renders as
  **one compact** pill (e.g. `≥2★`); removing it sets `minStars: 0`.
- **R6 — Holds collapsed.** `holdsFilter[]` (board positions, no per-value human label) renders as
  a **single collapsed** pill `Holds (N)`; removing it clears the whole hold set
  (`holdsFilter: []`).
- **R7 — Fixed category order.** The two pinned toggles come first (**Benchmark → Favorites**),
  then the removable pills in a **stable category order**: **Grade → Min-stars → Methods → Status →
  Holds**. Positions never reshuffle by recency; removing one pill does not move the others. Within
  an array filter, pills follow the option source order (`METHOD_LABELS`, status key order).
- **R8 — Single scrolling row.** Everything lives on **one row** that **scrolls horizontally** when
  it overflows (never wraps to a second line, so header height is a predictable single line). The
  pinned toggles are the first two items and **scroll with the row** (not sticky within the
  scroller).
- **R9 — Status pills gate exactly like the list predicate.** Status pills appear **only when the
  status filter is actually filtering the list** — i.e. **signed in with ascents loaded
  (`statusReady`) AND not in a collab session**. In a session the flat `statusFilters` model is
  *ignored* by `applyFilters` (the per-member `memberStatus` path runs instead), and while
  `!statusReady` (e.g. a signed-out `?status=` deep link) `applyFilters`/`activeFilterCount`
  neither apply nor count status — so in both cases a status pill would be a **phantom** that
  doesn't match list behavior. Suppress it. Status stays editable in the sheet. All other pills
  behave normally in a session.
- **R10 — Writes go through the one path.** Every toggle/removal calls the catalog's existing
  `setFilters` so the **cold-launch seed and URL stay in sync** exactly as sheet edits do. The
  header/shell never learns catalog concepts — the bar is owned by `CatalogScreen` and
  **portaled** into a header mount point (mirroring `BottomSlotContext`).
- **R11 — Out of scope, unchanged.** The filter **FAB and its count badge are untouched**; the
  sheet remains where filters are built. **Search and sort are not represented** in the bar (they
  are already excluded from "active filters" today).

### Acceptance examples

- **AE1** — On the catalog with no filters active, the header shows the two **outline** pinned
  toggles (`Benchmarks`, `Favorites`) and nothing else (no divider). Tapping either fills it
  (accent) and narrows the list; tapping again reverts. On any non-catalog route the pill row is
  absent.
- **AE2** — Set grade `6A–7B`, min-stars 2, and two methods in the sheet, then close it. The header
  row shows, in order: `Benchmarks`, `Favorites`, │ (divider), `6A–7B ✕`, `≥2★ ✕`, `<method1> ✕`,
  `<method2> ✕`. Toggling Favorites on from the bar fills its pill (it does **not** add a removable
  tag).
- **AE3** — Tap the `≥2★ ✕` pill → it disappears, `minStars` resets to 0, the list updates, and the
  URL/seed no longer carry it. The other pills stay put (no reshuffle).
- **AE4** — Select 4 methods + grade so the row overflows; the row scrolls horizontally to reveal
  the later pills. The pinned toggles scroll off the left edge with the row.
- **AE5** — Select 3 hold positions in the sheet → the header shows one `Holds (3) ✕` pill;
  tapping it clears all three.
- **AE6** — Solo (no session): select statuses Sent + Unlogged → two pills `Sent ✕`, `Not logged ✕`,
  each individually removable. Join a session → those status pills vanish from the bar (status now
  edited in the sheet); the pinned toggles / Grade / etc. are unaffected.
- **AE7** — Scroll the catalog list down; the pinned toggles and active pills remain visible in
  the sticky header (the whole point).

### Product scope / boundaries

- **In:** a catalog-only sticky header pill row; two always-on pinned toggles (Benchmark +
  Favorites); one removable pill per active filter value (methods, solo statuses); single pills for
  grade, min-stars; collapsed Holds pill; a divider between the pinned toggles and the removable
  pills; fixed-order single horizontally-scrolling row; portal plumbing from `CatalogScreen` into
  the header; session-aware suppression of status pills; shared label constants (`BENCHMARK_LABEL`,
  `FAVORITES_LABEL`) between the bar and the sheet toggles.
- **Out (explicit):** any change to the filter FAB or its badge; any change to `FilterSheet` /
  the filter model (`FilterControls` changes only in that its Benchmark/Favorites toggle text now
  reads the shared label constants — no behavior change); representing search or sort as pills; a
  "clear all" control in the bar (per-pill removal only — **accepted tradeoff:** bulk reset stays in
  the sheet's "Clear filters"); per-member session-status pills; pinning the toggles sticky-left
  within the scroller (they scroll with the row); editing any filter *value* from the bar (the bar
  only toggles Benchmark/Favorites and removes filters — building filters stays in the sheet).
- **Accepted tradeoff:** because the pinned toggles are always shown (R2), the catalog header is
  **always one pill-row taller**, even with zero filters active — a deliberate cost of one-tap
  Benchmark/Favorites access.

---

## Planning Contract

### Key Technical Decisions

- **KTD1 — New catalog-only header slot via a portal context (mirror `BottomSlotContext`).**
  `AppLayout` already portals route-owned chrome into the shell: it renders a `ref`-captured mount
  div and exposes it through `BottomSlotContext`, and the last-opened bar `createPortal`s into it.
  Add an analogous **`HeaderFilterSlotContext`**: a new `.app-header-slot` div inside the header
  (below the SessionPill slot), captured by `ref` and provided via context. `CatalogScreen`
  consumes it and `createPortal`s the `FilterPillBar` into it. Because only the catalog route
  mounts a consumer, the slot is empty (→ collapsed) everywhere else — no route-prop gating needed
  in the shell. This keeps `setFilters` (seed + URL) as the single write path (R10) and keeps the
  shell ignorant of catalog concepts.
- **KTD2 — Pure `describeActiveFilters(state, ctx)` derivation, unit-tested.** A pure function maps
  `FilterState` (+ the label inputs) to an **ordered list of pill descriptors**
  `{ id, label, patch: Partial<FilterState> }`, where `patch` is what `setFilters` applies on
  removal (e.g. `{ favoritesOnly: false }`, `{ gradeRange: null }`, `{ minStars: 0 }`,
  `{ methods: without(m) }`, `{ statusFilters: without(s) }`, `{ holdsFilter: [] }`). **Benchmark
  and Favorites are NOT in this list** — they're the pinned always-on toggles rendered separately
  (R2). Order is fixed per R7. Keeping this pure isolates the label/order/patch logic from React
  and makes AE2/AE5/AE6 unit-testable without a DOM.
- **KTD3 — Reuse existing label sources; only min-stars gets a compact rewrite.** Grade uses
  `FONT_GRADES[range[0]]`–`FONT_GRADES[range[1]]` (`board/grades`, same source the sheet's Grade
  field uses). Methods use their own strings from `METHOD_LABELS` (already short). Solo statuses
  reuse the existing status labels (the `StatusKey` label source behind `MemberStatusRow`) — **do
  not invent new strings**. Benchmark/Favorites reuse the shared `BENCHMARK_LABEL`/`FAVORITES_LABEL`
  constants (`filters.ts`), shared with the sheet toggles. **Min-stars** is the one compact rewrite:
  `≥{n}★` (the sheet's `RATING_LABELS` "N★ and up" is too long for a scrolling chip). Holds =
  `Holds (${holdsFilter.length})`.
- **KTD4 — Pinned toggles reuse `Toggle`; removable pills are a small bespoke outlined chip.** The
  Benchmark and Favorites pills are literally the existing `Toggle variant="outline" size="sm"`
  (down-sized to `h-6`) bound to `benchmarkOnly`/`favoritesOnly` — the same component the sheet
  uses — with the `Toggle`'s **default accent fill** when pressed (the benchmark-amber token was
  tried and rejected in review; neutral accent chosen so the two toggles match). The removable pills
  are a small chip built from shadcn theme tokens: **outlined** (`border-border`, transparent fill,
  `text-muted-foreground`) with a trailing lucide `X` cue; the **whole chip is the button** (R3). An
  *outline* (not fill) is deliberate — a `bg-muted`/`bg-accent` fill is ~invisible on the near-white
  frosted header in light mode (`--muted`/`--accent` ≈ `--background`), so the border carries the
  shape. A hairline divider (`h-4 w-px bg-border`) sits between the pinned toggles and the pills,
  rendered only when ≥1 pill exists. Per `web/CLAUDE.md`, compose from existing primitives; the chip
  is the minimum bespoke piece and uses theme tokens, no ad-hoc hex.
- **KTD5 — Single-line horizontal scroll, edge-to-edge.** The row is `flex` + `overflow-x-auto`
  with the scrollbar hidden and `flex-nowrap` (never wraps → predictable one-line header height,
  R8). To let pills scroll edge-to-edge under the frosted header, the row may use the header's
  `margin-inline: -1rem` break-out idiom with matching scroll-padding so the first pill still
  aligns to the 1rem content column. `touch-action: pan-x` / momentum scroll for iOS feel.
- **KTD6 — Session detection reuses the existing session signal.** Status-pill suppression (R9)
  keys off the same session state the sheet already reads (`useSessionFilterRows` /
  `FilterContext.session`). When a session is active, `describeActiveFilters` (or the component)
  omits status descriptors. No new session plumbing.

### Assumptions

- The `.app-header-slot:empty` collapse rule (App.css) applies to the new slot exactly as to the
  existing three, so an empty (non-catalog) slot costs zero height.
- `setFilters` is safe to call from a portaled component rendered under `CatalogScreen` (it is —
  same React tree/owner, just a different DOM mount).
- Status labels are **already shared** — `STATUS_LABELS` and `STATUS_KEYS` are exported from
  `filters.ts` and imported by `MemberStatusRow`. No extraction needed (verified).
- Grade range, when equal to the full slab span, is stored as `null` (per `FilterControls`
  `onValueChange`), so a "grade" pill only appears for a genuine sub-range — no spurious pill for
  the default.

### Sequencing

U1 (portal plumbing) and U2 (pure derivation + tests) are independent and can proceed in parallel.
U3 (the `FilterPillBar` component) depends on U2 (descriptors) and U4-adjacent tokens. U4 (wire
into `CatalogScreen`, portal into the header) depends on U1 + U3. Verify end-to-end last.

---

## Implementation Units

### U1. Header portal slot (`HeaderFilterSlotContext`)

**Goal:** A catalog-injectable mount point inside the frosted sticky header that collapses when
unused.

**Requirements:** R1, R10. **Dependencies:** none.

**Files:**
- `web/src/shell/AppLayout.tsx` — add a fourth `.app-header-slot` div (below the SessionPill slot),
  capture it with a `ref`/`useState` setter exactly like `setBottomSlot`, and provide it through a
  new context.
- `web/src/shell/headerFilterSlot.ts` (new) — mirror `shell/bottomSlot.ts` (context +
  `useHeaderFilterSlot()` hook).

**Approach:** Copy the `BottomSlotContext` pattern verbatim: `const [headerFilterSlot,
setHeaderFilterSlot] = useState<HTMLElement | null>(null)`, render `<div ref={setHeaderFilterSlot}
className="app-header-slot" />` inside the header after the SessionPill slot, wrap the tree in
`<HeaderFilterSlotContext.Provider value={headerFilterSlot}>`. No route gating in the shell — the
slot stays empty (collapsed) until a consumer portals in.

**Test scenarios:** none new (structural); covered by U4 browser verify (slot absent/empty off
catalog).

---

### U2. Pure active-filter descriptor derivation

**Goal:** Map `FilterState` (+ label/session inputs) to an ordered list of removable-pill
descriptors, excluding the pinned toggles (Benchmark **and** Favorites).

**Requirements:** R3, R4, R5, R6, R7, R9. **Dependencies:** none.

**Files:**
- `web/src/catalog/activeFilterChips.ts` (new) — `describeActiveFilters(state, { inSession,
  statusReady }): Array<{ id: string; label: string; patch: Partial<FilterState> }>`.
- `web/src/catalog/activeFilterChips.test.ts` (new).

Status labels are **already shared**: `filters.ts` exports `STATUS_LABELS` and `STATUS_KEYS`
(`StatusKey = 'sent' | 'attempted' | 'unlogged'`), imported by `MemberStatusRow`. Import them —
**no extraction needed** (this closes former Q1). Method labels come from `METHOD_LABELS`, grade
from `FONT_GRADES` (`board/grades`) — all already exported.

**Approach:** Emit descriptors in fixed order (R7): grade (if `gradeRange` non-null) → min-stars
(if `minStars > 0`) → each method in `METHOD_LABELS` order that's in `state.methods` → **(only when
`statusReady && !inSession`)** each status in `STATUS_KEYS` order that's in `state.statusFilters` →
holds (if `holdsFilter.length`). **Favorites is intentionally NOT emitted** — it's a pinned toggle
(R2), like Benchmark. The status gating mirrors `activeFilterCount` (`filters.ts`: status counts
only when `statusReady`, and the session predicate ignores `statusFilters`) so a pill never appears
for a filter the list isn't actually applying (R9). Labels per KTD3; `patch` per KTD2. Stable `id`s
(e.g. `method:<m>`, `status:<k>`, `grade`, `stars`, `holds`) so React keys are stable and removal
never reshuffles.

**Test scenarios:**
- Full set (grade sub-range, minStars=2, two methods, two statuses, three holds) with
  `statusReady: true, inSession: false` → descriptors in exact R7 order with expected labels
  (`6A–7B`, `≥2★`, method strings, status strings, `Holds (3)`).
- `favoritesOnly: true` alone → **empty array** (Favorites is a pinned toggle, never a chip).
- `inSession: true` omits the status descriptors, keeps the rest (AE6).
- `statusReady: false` (signed out) omits the status descriptors even when `statusFilters` is
  non-empty (no phantom pill for an unapplied `?status=` deep link), keeps the rest.
- Default `FilterState` → empty array (no spurious grade pill for full-span/null range).
- Each descriptor's `patch` clears exactly its own filter (grade→null, stars→0, one method removed
  leaving the other, holds→[]).

---

### U3. `FilterPillBar` component

**Goal:** Render the two pinned toggles + a divider + the removable pills as one
horizontally-scrolling row.

**Requirements:** R2, R3, R7, R8. **Dependencies:** U2.

**Files:**
- `web/src/catalog/FilterPillBar.tsx` (new).

**Approach:** Props `{ filters: FilterState; onChange: (next: FilterState) => void; inSession:
boolean; statusReady: boolean }`. Wrap the row in a labelled region (`role="toolbar"`,
`aria-label="Active filters"`) so the scrollable group is announced. Render a single `flex
flex-nowrap gap-1.5 overflow-x-auto` row (scrollbar hidden, `touch-pan-x`, `-mx-4`/`px-4`
edge-to-edge break-out per KTD5). First two children: the **Benchmark** then **Favorites**
`Toggle`s (`variant="outline" size="sm"`, down-sized `h-6`, `pressed`/`onPressedChange` bound to
`benchmarkOnly`/`favoritesOnly`, default accent fill when on, no ✕, labels from
`BENCHMARK_LABEL`/`FAVORITES_LABEL` — R2). Then, **only when `describeActiveFilters(...)` is
non-empty**, a hairline divider (`h-4 w-px bg-border`), then map the descriptors to chips: each is
a `<button>` (whole-pill hit target) styled as an **outlined gray tag** (KTD4) with the label + a
trailing lucide `X` (aria-hidden cue), `onClick={() => onChange({ ...filters, ...chip.patch })}`,
`aria-label={`Remove ${chip.label} filter`}`. Native `<button>` click semantics (fires on tap, not
a scroll drag) so swiping to scroll doesn't remove a filter. Use shadcn theme tokens only. The row
renders even with zero pills (the two toggles alone — AE1).

**Test scenarios:** unit-render optional; primary coverage is the browser verify (AE1–AE7). If a
component test is cheap, assert both toggles always present + one button per descriptor with the
right `aria-label` + the divider only when ≥1 pill.

---

### U4. Wire into `CatalogScreen` (portal into the header)

**Goal:** Portal the `FilterPillBar` into the header slot with live filters + `setFilters`, session
aware.

**Requirements:** R1, R9, R10, R11. **Dependencies:** U1, U3.

**Files:**
- `web/src/catalog/CatalogScreen.tsx` — consume `HeaderFilterSlotContext`; when the node exists,
  `createPortal(<FilterPillBar filters={filters} onChange={setFilters} inSession={...}
  statusReady={statusReady} />, node)`. `CatalogScreen` already computes **both** signals for the
  FAB/sheet: `statusReady` (built into `FilterContext`, drives `activeFilterCount`) and the session
  presence via `useSessionFilterRows(board)` (defined ⇒ a session targets this board). Pass both;
  no new plumbing. `CatalogScreen` already uses `createPortal` (line ~247) for the bottom slot, so
  this is the same idiom. No change to the FAB, `FilterSheet`, or `applyFilters` wiring (R11).

**Approach:** Mirror how the last-opened bar portals into `BottomSlotContext`. `setFilters` is the
existing function (writes seed via `saveSeed` then URL via `navigate({ search, replace: true })`),
so Benchmark toggles and pill removals persist identically to sheet edits (R10). Guard on the
portal node being non-null (it always is on catalog, but null-guard for safety).

**Test scenarios (browser `/verify`):** AE1–AE7.

---

## Verification Contract

- **Typecheck/build:** `cd web && npm run build` (`tsc -b` + Vite) — **not** `tsc --noEmit`
  (memory `web-typecheck-use-tsc-b`). Must pass.
- **Unit tests:** `cd web && npm test` covering U2 (`describeActiveFilters`: order, labels, patches,
  in-session suppression, default→empty) and, if cheap, U3 render.
- **Browser end-to-end (`/verify` / `/ce-test-browser`):** on the catalog route —
  - AE1: no-filter state shows the two outline pinned toggles (`Benchmarks`, `Favorites`) and no
    divider; toggling either filters the list and fills it; the pill row is absent off-catalog.
  - AE2/AE3: build a multi-filter set in the sheet → divider + pills appear in R7 order with correct
    labels → tap a pill → that filter clears, others stay, list + URL update. Verify **both light
    and dark** theme (removable pills are outline-only, so confirm they're legible on the frosted
    header in each).
  - AE4: overflow the row → horizontal scroll works; the pinned toggles scroll with the row.
  - AE5: holds → single `Holds (N)` pill clears all.
  - AE6: solo statuses show individual pills; joining a session removes the status pills only.
  - AE7: pills stay visible while scrolling the list (sticky header).
  - Confirm the FAB badge/count and the sheet are visually and behaviorally unchanged (R11).
- **Lint:** repo linter clean on changed files.

---

## Definition of Done

- On the catalog route, the frosted sticky header shows a single horizontally-scrolling pill row;
  it is absent (zero-height) on every other route.
- Benchmark and Favorites are the first two pills — pinned always-on toggles (`benchmarkOnly` /
  `favoritesOnly`), no ✕, on/off shown via accent fill; their labels come from the shared
  `BENCHMARK_LABEL`/`FAVORITES_LABEL` constants (also used by the sheet toggles).
- Every other active filter renders as an outlined-gray removable pill in fixed category order
  (R7): grade (one pill), min-stars (compact `≥N★`), each method, each solo status, holds
  (collapsed `Holds (N)`), separated from the toggles by a divider. Tapping anywhere on a pill
  removes that filter; a ✕ glyph cues removability.
- Status pills are suppressed while in a collab session; all other pills behave normally.
- All toggles/removals go through `setFilters` (seed + URL stay in sync); the FAB, its badge, and
  the filter sheet are unchanged; search and sort are not represented.
- Build (`tsc -b`), unit tests (`describeActiveFilters`), lint, and the browser `/verify` pass.
- Docs: if the header/filter surface is described in a `docs/` subsystem file, note the new pill
  bar there in the same commit (root `CLAUDE.md` doc-discipline).

---

## Open Questions

- **Q1 (resolved)** — Status-label source. **Resolved:** `STATUS_LABELS`/`STATUS_KEYS` already
  exist and are exported from `filters.ts`; U2 imports them, no extraction (verified against code).
- **Q2 (resolved)** — Should Benchmark stay pinned sticky-left while pills scroll? **Resolved: no**
  — Benchmark is the first pill and scrolls with the row (R8/AE4), per the grill decision.
- **Q3 (resolved)** — Should the bar offer a "clear all"? **Resolved: no** — per-pill removal only;
  bulk reset stays in the sheet (scope boundary).
- **Q4 (deferred, non-blocking)** — Edge-to-edge break-out vs. inset row (KTD5): a purely visual
  polish choice to settle against the live frosted header during U3/U4; either satisfies R8.

No launch-blocking questions remain. The plan is implementation-ready.
