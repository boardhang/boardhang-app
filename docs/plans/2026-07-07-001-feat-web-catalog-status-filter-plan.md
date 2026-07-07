---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "feat(web): ascent-status filter for the catalog sheet (iOS parity)"
date: 2026-07-07
depth: standard
tier: routine
---

# feat(web): Ascent-status filter for the catalog filter sheet (iOS parity)

## Summary

The iOS catalog filter sheet's "Filters" section has five chips — Benchmarks, Favorites, **My ascents**, **Not completed**, **Not logged**. The web PWA sheet ships only Benchmarks + Favorites. This plan adds the missing three-state **ascent-status filter** to the web catalog sheet, mirroring iOS semantics exactly, and wires it through web's existing URL-as-source-of-truth filter pipeline.

Web-native chip labels: **Sent** / **Attempted** / **Not logged**. The three states OR together; every other filter ANDs on top — byte-for-byte with iOS `matchesFilters` (`ios/MoonBoardLED/Views/CatalogListView.swift` ~315-333).

**Product Contract preservation:** N/A — solo (bootstrap) plan, no upstream requirements doc. Scope was fixed in a prior grilling session (6 decisions, carried into Requirements below).

---

## Problem Frame

Web's ascent data (`web/src/logbook/ascents.ts`) is cloud-only and already loaded into the catalog via `useEnsureAscentsLoaded()`; `CatalogScreen` already derives a board-scoped `sentIds` Set to render the green "sent" check on rows. But there is **no way to filter the catalog by ascent status** — a user cannot ask "show me only problems I've sent" or "only ones I've never logged." iOS has had this since launch. The gap is a single filter group; all the data and most of the plumbing already exist.

**Constraint that shapes the design:** web ascents are cloud-only and empty when signed out, whereas iOS reads local SwiftData and always has data. So the web filter must degrade gracefully for signed-out users rather than silently blanking the list.

---

## Requirements

Traceable to the grilling-session decisions (all fixed):

- **R1 — Three status chips.** Add `Sent`, `Attempted`, `Not logged` as outline `Toggle` chips in the catalog filter sheet, alongside the existing Benchmarks/Favorites toggles. Multi-select.
- **R2 — iOS-exact semantics.** The three states OR together; grade range, min rating, method, holds, benchmarks, favorites, and the installed-hold-set climbable gate all AND on top. Classification by `source_catalog_id`, board-scoped:
  - **Sent** = `sentIds.has(id)`
  - **Attempted** = `loggedIds.has(id) && !sentIds.has(id)`
  - **Not logged** = `!loggedIds.has(id)`
  - A problem with any send counts as Sent even if it also has unsent attempt rows (`sent` wins).
- **R3 — Data source.** Reuse the existing board-scoped `sentIds` Set (`CatalogScreen.tsx` ~63). Add a parallel board-scoped `loggedIds` Set = any ascent for this board with a non-null `sourceCatalogId` (sent or not). Thread `sentIds`, `loggedIds`, and a `statusReady` gate through `FilterContext` into `applyFilters` (and a separate `signedOut` flag to the sheet for the chip disabled/hint state — see R4).
- **R4 — Degraded states (signed-out AND ascents-not-loaded).** The filter has two distinct gates because auth state and ascent-data availability are independent:
  - **Filter-pass gate (`statusReady`):** status is **ignored in the filter pass** (URL value preserved but not applied) and **not counted** in `activeFilterCount` whenever `statusReady` is false, where `statusReady = signedIn && ascents.status === 'loaded'`. This covers signed-out **and** the signed-in-but-ascents-`loading`/`error`/`idle` window. Rationale: `sentIds`/`loggedIds` are only trustworthy once ascents load; applying the predicate against empty sets would blank a `?status=sent` deep-link (the exact failure this guards) or make `Not logged` match everything.
  - **Chip disabled + hint gate (`signedOut`):** render the three chips **disabled** with the hint "Sign in to filter by status" only when the user is **definitively** signed out — `signedOut = !isRestoring && authStatus === 'signedOut'`. During `isRestoring` (cold-launch session restore) the chips stay enabled/neutral so an established user never sees a "Sign in" flash; during the signed-in ascents-loading window the chips are enabled and simply self-correct once data arrives (the predicate no-ops until then).
- **R5 — URL + persistence parity.** New `status` search param (comma-joined subset of the three keys) in the catalog search schema, with encode/decode + defaults-stripping. Counts in `activeFilterCount` (when signed in), cleared by "Reset filters", and carried in the cold-launch `localStorage` seed — full parity with every existing filter.

**Out of scope (explicit):** method option-set drift (iOS's fixed canonical set vs web's slab-derived list) and secondary-sort persistence. Separate follow-ups — see Scope Boundaries.

---

## Key Technical Decisions

**KTD1 — `StatusKey` union + `statusFilters: StatusKey[]` on `FilterState`.** Model status as `type StatusKey = 'sent' | 'attempted' | 'unlogged'` and a `statusFilters: StatusKey[]` array (empty = no status filter), mirroring how `methods: string[]` already works. Rationale: multi-select OR semantics map cleanly to an array; the existing method filter is the exact precedent to follow for URL encode/decode, seed, and reset.

**KTD2 — `statusReady` lives in `FilterContext`, not `FilterState`.** `FilterState` is the URL/seed-serializable value; ascent-data readiness is runtime, not a filter value. `FilterContext` carries `statusReady: boolean` (= `signedIn && ascents.status === 'loaded'`) alongside `favoriteIds`/`isClimbable`, so `applyFilters` skips the status predicate when `!ctx.statusReady`. Rationale: matches the existing split — `FilterContext` already carries runtime-derived data that isn't URL state — and folds both degraded states (signed-out, ascents-not-loaded) into one gate (R4).

**KTD3 — `activeFilterCount`/`hasActiveFilters` gain an optional `statusReady` param defaulting to `true`.** `activeFilterCount(s, statusReady = true)` adds `1` for `statusFilters` only when `statusReady`. Default `true` keeps every existing caller and test compiling unchanged; the FAB badge (`FilterSheet`) **and** the "Reset filters" button (`FilterControls` → `hasActiveFilters`) both pass the real `statusReady`, so the badge count and the Reset-button visibility stay consistent (a signed-out `?status=` link shows neither). Rationale: least-invasive way to make the count readiness-aware without threading runtime state into pure filter state; passing the same value to both consumers closes the badge-vs-Reset inconsistency.

**KTD4 — No changes needed in `filterSeed.ts` or `resetFilters`.** `saveSeed` serializes the whole `FilterState`; `loadSeed` merges over `DEFAULT_FILTERS`; `resetFilters` spreads `DEFAULT_FILTERS`. Once `statusFilters: []` is in `DEFAULT_FILTERS`, seeding, cold-launch merge-forward of old blobs, and reset all work automatically. Rationale: verified by reading both files — the field just needs to exist in the default.

**KTD5 — Two derived flags from `useAuth()` + ascents status.** `signedIn = authStatus !== 'signedOut'` (matching `useEnsureAscentsLoaded`); then `statusReady = signedIn && ascents.status === 'loaded'` (filter-pass + count gate) and `signedOut = !isRestoring && authStatus === 'signedOut'` (chip-disabled + hint gate). Rationale: `signedIn` alone is insufficient — it flips true during `isRestoring` and before ascents load, which would either flash "Sign in" for returning users or blank a `?status=` deep-link. Reading the ascents `status` field (already available from `useEnsureAscentsLoaded`, currently destructured as `{ ascents }` only) and `isRestoring` from `useAuth()` closes both windows.

---

## High-Level Technical Design

Data flow for the status filter (new/changed pieces marked ⟡):

```
useAuth() ──authStatus, isRestoring──▶ signedOut ⟡ ────────────────────┐
        └──▶ signedIn ⟡ ──┐                                            │
                          ▼                                            │
useEnsureAscentsLoaded() ──ascents, ascents.status ⟡──▶ CatalogScreen  │
        │                     └──▶ statusReady ⟡ = signedIn && loaded  │
        ├─▶ sentIds   (existing: sent && board && id)                  │
        └─▶ loggedIds ⟡ (new: any ascent, board, id)                   │
                        │                                              │
                        ▼                                              ▼
   FilterContext { favoriteIds, isClimbable, ⟡ sentIds, ⟡ loggedIds, ⟡ statusReady }
                        │  (all ⟡ values MUST be in CatalogScreen's useMemo deps)
   URL ?status=sent,unlogged ⟡                                        │
        │ validateCatalogSearch / searchToFilters ⟡                   │
        ▼                                                              ▼
   FilterState.statusFilters ⟡ ───────────────▶ applyFilters(problems, state, ctx)
                                                     │  status predicate ⟡:
                                                     │    if ctx.statusReady && statusFilters.length:
                                                     │      keep if OR(state matches any selected)
                                                     ▼
                                                 displayed list

FilterState.statusFilters ⟡ ─▶ FilterSheet: activeFilterCount(state, statusReady) ⟡ ─▶ badge
                            └─▶ FilterControls: 3 chips (disabled when signedOut ⟡),
                                                Reset via hasActiveFilters(state, statusReady) ⟡
```

**Status predicate (directional, not implementation spec):**

```
matchesStatus(p, statusFilters, sentIds, loggedIds):
  if statusFilters is empty: return true
  id = p.source_catalog_id
  return statusFilters.some(k =>
    k === 'sent'      ? sentIds.has(id)
    k === 'attempted' ? loggedIds.has(id) && !sentIds.has(id)
    k === 'unlogged'  ? !loggedIds.has(id)
    : false)
# applied in applyFilters ONLY when ctx.statusReady (signed in AND ascents loaded);
# otherwise skipped entirely — signed-out AND the signed-in-loading window both no-op
```

---

## Implementation Units

### U1. Status filter core logic in `filters.ts`

**Goal:** Add the status model, classification predicate, and auth-aware active-count to the pure filter module.

**Requirements:** R1, R2, R3, R4 (filter-pass + count halves), KTD1–KTD3.

**Dependencies:** none.

**Files:**
- `web/src/catalog/filters.ts` (modify)
- `web/src/catalog/filters.test.ts` (create if absent, else extend — confirm exact path during work; a `filters` test may live as `filters.test.ts` under `web/src/catalog/`)

**Approach:**
- Add `export type StatusKey = 'sent' | 'attempted' | 'unlogged'` and `export const STATUS_LABELS: Record<StatusKey, string> = { sent: 'Sent', attempted: 'Attempted', unlogged: 'Not logged' }`.
- Add `statusFilters: StatusKey[]` to `FilterState` (empty = any status); add `statusFilters: []` to `DEFAULT_FILTERS`.
- Extend `FilterContext` with `sentIds: Set<string>`, `loggedIds: Set<string>`, `statusReady: boolean`.
- In `applyFilters`, add the status predicate (see HTD) as an AND alongside the other narrowing filters, applied **only when `ctx.statusReady && s.statusFilters.length > 0`**. Classify by `p.source_catalog_id`. Order it with the other `if (...) return false` checks; keep `ctx.isClimbable` last as today.
- Change `activeFilterCount(s: FilterState, statusReady = true)` to add `(statusReady && s.statusFilters.length > 0 ? 1 : 0)`. `hasActiveFilters(s, statusReady = true)` forwards `statusReady` to `activeFilterCount`.
- `resetFilters` needs no explicit status handling (spreads `DEFAULT_FILTERS` → `statusFilters: []`). Add a test asserting this so a future refactor can't silently break it.

**Patterns to follow:** the existing `methods: string[]` field and its handling in `applyFilters` (line 117) and `activeFilterCount` (line 64); `favoriteIds` in `FilterContext` for the runtime-Set precedent.

**Test scenarios** (`filters.test.ts`):
- Happy path — `statusFilters: ['sent']` keeps only ids in `sentIds`; `['unlogged']` keeps only ids absent from `loggedIds`; `['attempted']` keeps ids in `loggedIds` but not `sentIds`.
- OR semantics — `['sent','unlogged']` keeps sent OR never-logged; excludes attempted-not-sent.
- Sent-wins — a problem present in BOTH `sentIds` and `loggedIds` (has a send AND an attempt row) classifies as Sent, not Attempted; `['attempted']` excludes it, `['sent']` includes it.
- AND composition — `statusFilters: ['sent']` combined with `benchmarkOnly: true` returns only sent AND benchmark problems.
- Empty status — `statusFilters: []` is a no-op (all problems pass the status stage).
- Not-ready skip — `ctx.statusReady = false` with `statusFilters: ['sent']` returns the same set as no status filter (predicate skipped), even when `sentIds` is empty. This one scenario covers **both** degraded cases R4 folds into `statusReady`: signed-out, and signed-in-but-ascents-not-yet-loaded (a deep-linked `?status=sent` must not blank the list before data arrives).
- `activeFilterCount` — `['sent']` with `statusReady = true` counts 1; same state with `statusReady = false` counts 0; empty `statusFilters` counts 0 either way; default param (`statusReady` omitted) counts as ready.

**Verification:** unit tests green; type-check passes (new field on `FilterState` surfaces every construction site).

---

### U2. `status` URL param in `catalogSearch.ts`

**Goal:** Make status deep-linkable and default-stripped, parity with other filters.

**Requirements:** R5, KTD1.

**Dependencies:** U1 (`StatusKey`, `DEFAULT_FILTERS.statusFilters`).

**Files:**
- `web/src/catalog/catalogSearch.ts` (modify)
- `web/src/catalog/catalogSearch.test.ts` (extend)

**Approach:**
- Add `status: string` to `CatalogSearch` (comma-joined keys; `''` = any) and `status: ''` to `CATALOG_SEARCH_DEFAULTS`.
- In `validateCatalogSearch`, coerce `raw.status` via `str(...)`. (Token validity is enforced on decode into `FilterState`, mirroring how `method` is passed through as a string and split later.)
- Add `encodeStatus(keys: StatusKey[]): string` (join `,`; `''` when empty) and decode in `searchToFilters`: split on `,`, filter to the three known `StatusKey` values (drops garbage from hand-edited URLs).
- `filtersToSearch`: emit `status: encodeStatus(f.statusFilters)`. The route's `stripSearchParams` middleware removes it at default (`''`) — confirm `status` is covered by the same default-strip path the other params use (it will be, since it's in `CATALOG_SEARCH_DEFAULTS`).

**Patterns to follow:** the `method` param end-to-end (schema line 33, default line 52, `filtersToSearch` line 121, `searchToFilters` line 139) — status is the same shape (comma-joined multi-select) with an added allowlist filter on decode.

**Test scenarios** (`catalogSearch.test.ts`):
- Round-trip — `filtersToSearch` then `searchToFilters` preserves `['sent','attempted']`.
- Empty — `statusFilters: []` encodes to `''`; `''` decodes to `[]`.
- Order/subset — `'unlogged,sent'` decodes to exactly those two keys.
- Garbage rejection — `status: 'sent,bogus,'` decodes to `['sent']` (unknown + empty tokens dropped).
- Defaults — `CATALOG_SEARCH_DEFAULTS.status === ''`; a missing `status` validates to `''`.

**Verification:** unit tests green; a URL with `?status=sent` round-trips to `statusFilters: ['sent']` and back, and a bare default produces no `status` in the URL.

---

### U3. Wire `loggedIds` + `statusReady`/`signedOut` through `CatalogScreen.tsx`

**Goal:** Derive the new board-scoped `loggedIds` Set, the `statusReady` gate, and the `signedOut` flag, and thread them (plus existing `sentIds`) into `FilterContext` and down to the sheet.

**Requirements:** R3, R4, KTD2, KTD5.

**Dependencies:** U1 (`FilterContext` shape). **U3 and U4 must land in the same commit/PR** — U3 passes new props (`statusReady`, `signedOut`) into `FilterSheet` that U4 adds to its signature, so landing them separately breaks the type-check. (Alternative if they must split: make the new `FilterSheet`/`FilterControls` props optional; the single-commit path is preferred.)

**Files:**
- `web/src/catalog/CatalogScreen.tsx` (modify)
- `web/src/catalog/CatalogScreen.test.tsx` (extend)

**Approach:**
- Read auth from `useAuth()`: `const { status: authStatus, isRestoring } = useAuth()`. Change the ascents destructure from `{ ascents }` to `{ ascents, status: ascentsStatus }` (the `AscentsState.status` field already exists). Derive `signedIn = authStatus !== 'signedOut'`, `statusReady = signedIn && ascentsStatus === 'loaded'`, `signedOut = !isRestoring && authStatus === 'signedOut'` (KTD5).
- Add a `loggedIds` memo parallel to `sentIds` (line 63): `new Set(ascents.filter(a => a.boardLayoutId === board.layoutId && a.sourceCatalogId).map(a => a.sourceCatalogId as string))` — note: **no `a.sent` filter** (any ascent counts as logged). Keep the same `[ascents, board.layoutId]` deps.
- Build `FilterContext` with `sentIds`, `loggedIds`, `statusReady` added to the existing `favoriteIds` / `isClimbable`. **Critical:** the `FilterContext` is `useMemo`'d (currently on `[board, favoriteIds, activeHoldSetsRaw]`); add `sentIds`, `loggedIds`, and `statusReady` to that dependency array, or the status pass reads stale sets and doesn't re-run when ascents load (this is what makes the ascents-loading→loaded transition actually re-filter the list).
- Pass `statusReady` and `signedOut` to `FilterSheet` (which forwards `statusReady` to `activeFilterCount` + the Reset button, and `signedOut` to the chip disabled/hint state).

**Patterns to follow:** the existing `sentIds` memo (line 63) is the exact template for `loggedIds`; `favoriteIds`/`isClimbable` for how `FilterContext` is assembled and passed to `applyFilters`.

**Test scenarios** (`CatalogScreen.test.tsx`):
- Integration — with mock ascents (one sent, one unsent-attempt, plus a catalog problem with neither) and `statusFilters: ['attempted']`, the rendered list shows only the attempted-not-sent problem.
- Board scoping — an ascent for a different `boardLayoutId` does not classify a same-`sourceCatalogId` problem as logged/sent on the current board.
- Signed-out — signed out with `?status=sent` in the route renders the full (unfiltered-by-status) list, not an empty list.
- Ascents-loading window — signed in with `?status=sent` while `ascentsStatus !== 'loaded'` renders the full list (status skipped); once `ascentsStatus` becomes `'loaded'`, the list re-filters to the sent set (verifies the `useMemo` deps make the transition reactive).
- No restore flash — with `isRestoring: true` and `authStatus: 'signedOut'`, the chips are **not** disabled and show no "Sign in" hint (`signedOut` is false during restore).

**Verification:** opening the catalog signed in with logged/sent ascents and toggling each status chip narrows the list correctly; signed-out shared `status=` link shows a full list.

---

### U4. Status chips in `FilterControls.tsx` + badge/threading in `FilterSheet.tsx`

**Goal:** Render the three status chips (disabled + hinted when signed out) and make the FAB badge auth-aware.

**Requirements:** R1, R4, KTD3.

**Dependencies:** U1 (`STATUS_LABELS`, `StatusKey`, `statusFilters`), U3 (`statusReady` + `signedOut` passed in). Lands in the **same commit/PR** as U3 (see U3 Dependencies).

**Files:**
- `web/src/catalog/FilterControls.tsx` (modify)
- `web/src/catalog/FilterSheet.tsx` (modify)
- `web/src/catalog/FilterControls.test.tsx` (create if absent, else extend — confirm exact path during work)

**Approach:**
- `FilterSheet`: add `statusReady: boolean` and `signedOut: boolean` to props; `const count = activeFilterCount(state, statusReady)`; forward both to `FilterControls`.
- `FilterControls`: add `statusReady: boolean` and `signedOut: boolean` to props. Add a `Field`-wrapped group titled **"Status"** holding three `Toggle variant="outline" size="sm"` chips over `(['sent','attempted','unlogged'] as StatusKey[])` using `STATUS_LABELS`, `pressed={state.statusFilters.includes(k)}`, `onPressedChange` add/remove from `statusFilters` (mirror the method-chip toggle at lines 168-179). Set `disabled={signedOut}` on each chip.
- **Placement (committed):** put the "Status" group immediately **after** the Benchmarks/Favorites/rating row, keeping the ascent-personalization filters adjacent and matching iOS's order (My ascents/Not completed/Not logged follow Benchmarks/Favorites in one row). The Method section stays last.
- **Accessibility (F2):** when `signedOut`, render the hint "Sign in to filter by status" (`text-xs text-muted-foreground`) **above** the chips (so it's read before the controls in DOM/AT order) with a stable `id`, and set `aria-describedby={hintId}` on each `Toggle`. Native `disabled` removes the chips from the tab order, so the above-order hint is what a screen-reader user encounters; do not rely on the disabled chips themselves being focusable.
- **Reset button (F4):** the existing `hasActiveFilters(state)` call that gates the "Reset filters" button must become `hasActiveFilters(state, statusReady)`, so the button's status contribution matches the FAB badge (both hidden for a signed-out `?status=` link).

**Patterns to follow:** the method multi-select chips (lines 164-182) for toggle add/remove; the `Field` label wrapper (lines 54-61); Benchmarks/Favorites `Toggle` (lines 144-149) for chip style. Use shadcn `Toggle` + Tailwind theme tokens only (web/CLAUDE.md).

**Test scenarios** (`FilterControls.test.tsx`):
- Signed in (`signedOut = false`) — clicking "Sent" adds `'sent'` to `statusFilters` via `onChange`; clicking again removes it; two chips pressed → both present (multi-select).
- Signed out (`signedOut = true`) — the three chips render `disabled`; the "Sign in to filter by status" hint is visible with an `id`, and each chip has `aria-describedby` pointing at it; clicking a disabled chip does not call `onChange`.
- Pressed state reflects `state.statusFilters` (e.g. `['unlogged']` → only "Not logged" pressed).
- `FilterSheet` badge — with `statusFilters: ['sent']`, the badge shows the status contribution when `statusReady`, and omits it when `!statusReady`.
- Reset button parity — with `statusFilters: ['sent']` and `statusReady = false`, the "Reset filters" button does not appear (matches the badge omitting the count).

**Verification:** in the running app, the sheet shows Sent/Attempted/Not logged; signed out they're greyed with the hint; signed in they toggle and the FAB badge count reflects an active status filter.

---

## Scope Boundaries

**In scope:** the three-state ascent-status filter inside the web catalog filter sheet, with iOS-exact semantics, signed-out degradation, and full URL/seed/reset/badge parity.

### Deferred to Follow-Up Work
- **Method option-set drift** — iOS uses a fixed canonical set ("Any marked holds" / "No kickboard" / "Footless" / "Footless + kickboard"); web derives methods dynamically from the slab and has no explicit "Any marked holds" (nil-method) entry. Aligning them is a separate parity task.
- **Secondary-sort persistence** — iOS persists the secondary sort; web forces it to default on load and it is not URL-addressable. Separate follow-up.

---

## System-Wide Impact

- **Shared links:** a new `?status=` param appears in catalog URLs when active. Old links (no `status`) are unaffected (defaults to `''`). Signed-out recipients of a `status=` link see a full list (R4), not an empty one.
- **Cold-launch seed:** `catalogFilters_{layoutId}_{angle}` blobs now include `statusFilters`. Old blobs without it merge-forward safely (KTD4). No migration.
- **No backend/schema change:** reads the existing `ascents` table via the existing store; no Supabase migration.
- **Auth coupling:** the catalog now reads `useAuth()` `status` + `isRestoring` directly to derive `statusReady`/`signedOut` (it already reads ascents under the same condition), so the filter's availability tracks sign-in and data-load state reactively.

---

## Risks & Dependencies

- **`loggedIds` cost:** one extra `Set` build over the already-loaded ascents array, memoized on `[ascents, board.layoutId]` — negligible, same shape as `sentIds`.
- **Classification correctness is the core risk** — the sent-wins edge (a problem with both a send and an unsent attempt row) must classify as Sent. Covered explicitly by a U1 test scenario; mirrors iOS `sentIDs`/`loggedIDs` set logic.
- **`activeFilterCount` signature change** ripples to all callers — mitigated by the `statusReady = true` default (KTD3), so only the badge and Reset-button callers opt in; existing tests compile unchanged.
- **Two-flag model (`statusReady` vs `signedOut`)** is the subtlety an implementer must not collapse back to a single `signedIn`: `statusReady` gates the *filter pass + counts* (needs ascents loaded); `signedOut` gates the *chip disabled state + hint* (needs definitive sign-out, not mid-restore). Conflating them reintroduces either the blank-deep-link or the restore "Sign in" flash. Encoded in KTD5 + the U3/U1 test scenarios.
- **Exact test file paths** (`filters.test.ts`, `FilterControls.test.tsx`) to be confirmed at execution — adjacent test files exist (`CatalogRow.test.tsx`, `catalogSearch.test.ts`), so the convention is co-located `*.test.tsx?`.

---

## Definition of Done

- All four units landed; `web` type-check and the catalog/filter test suites pass.
- Signed in: Sent / Attempted / Not logged chips toggle, combine (OR among themselves, AND with other filters) exactly like iOS, and drive the FAB badge count.
- Signed out: chips are disabled (with `aria-describedby` → the "Sign in to filter by status" hint); a `?status=` link does not blank the list, and neither the FAB badge nor the Reset button counts status.
- Signed in but ascents still loading: a `?status=` deep-link shows the full list, then re-filters once ascents load (no blank flash); no "Sign in" flash during session restore.
- `?status=` round-trips through the URL, is stripped at default, seeds to `localStorage`, and clears on "Reset filters".
- No Supabase migration; shadcn + theme tokens only (web/CLAUDE.md).

---

## Verification Contract

1. **Unit:** `filters.test.ts` (predicate, OR, sent-wins, AND, signed-out skip, count) and `catalogSearch.test.ts` (round-trip, garbage rejection, defaults) green.
2. **Component:** `FilterControls.test.tsx` (toggle, disabled+hint, pressed state) and `CatalogScreen.test.tsx` (board-scoped classification, signed-out full list) green.
3. **Runtime smoke:** run the web app (`web/`), open a board catalog signed in with at least one sent and one attempted problem, toggle each chip, confirm narrowing; sign out and confirm chips disabled + `status=` link shows full list.

---

## Sources & Research

- iOS reference: `ios/MoonBoardLED/Views/CatalogListView.swift` — `matchesFilters` (~315-333), `CatalogFilter` enum, `sentIDs`/`loggedIDs` derivation.
- Web filter pipeline: `web/src/catalog/filters.ts`, `catalogSearch.ts`, `FilterControls.tsx`, `FilterSheet.tsx`, `filterSeed.ts`, `CatalogScreen.tsx` (all read during planning).
- Ascent data model: `web/src/logbook/ascents.ts` (`Ascent.sent`, board-scoped, `useEnsureAscentsLoaded`).
- Auth: `web/src/auth/AuthProvider.tsx` (`status`, `signedOut`, `isRestoring`).
- No external research — strong local patterns (every requirement has a direct in-repo precedent).
