# Plan: open Problem Detail from a logbook row

**Tier:** Routine (web UI only — no BLE, geometry, or migrations).

## Problem

Tapping a logbook row (`/logbook`, `web/src/logbook/LogbookScreen.tsx`) does nothing
useful. `AscentRow` has an `onSelect` hook wired only to the thumbnail, and
`LogbookScreen` never passes it, so there is no way to open the read-only
`ProblemDetail` view for a logged climb. A row tap should open the same detail view the
catalog and saved-lists screens already use.

## Approach

Render a `<Drawer>` + `<ProblemDetail>` inside `LogbookScreen`, driven by a `?problem=`
URL search param on the `/logbook` route — the **CatalogScreen** pattern, not the pure
local-state lists pattern. This was chosen after a plan review flagged that `/logbook`
is a **tab root**: with lists' pure-local-state drawer, the phone Back button would
eject the user from the whole Logbook tab instead of closing the sheet. Driving the
drawer off a history-integrated search param makes Back close the drawer and stay on
`/logbook` (CatalogScreen already does exactly this).

## Key facts (verified in code)

- The logbook is **board-scoped**: `boardAscents` filters ascents to
  `activeBoard.layoutId` (`LogbookScreen.tsx:57-58`), with a guard preventing viewing
  the logbook for a board the user hasn't added. So `board = activeBoard` always.
- `LogbookScreen` already builds `catalogById: Map<string, CatalogProblem>` from the
  catalog cache (`:34-54`). "Resolvable" = the row's `sourceCatalogId` is present in it.
- A row is **non-resolvable** two ways: `sourceCatalogId === null` (user-created), or a
  catalog id not in the cache. Both are out of scope for opening detail.
- `ProblemDetail` (`ProblemDetail.tsx:30-44`) takes a full `CatalogProblem` plus
  `displayed` (pager domain), `board`, `angle`, `favoriteIds`, `sentIds`, `onNavigate`.
- CatalogScreen's `?problem` open/close wiring (`CatalogScreen.tsx:143-192`): push on
  open (`pushed` ref → Back closes), `router.history.back()` on close when push-opened,
  else clear the param in place. Route uses `validateSearch` + `stripSearchParams`.

## Decisions

1. **History-integrated drawer** via a `?problem=<source_catalog_id>` search param on
   `/logbook`, mirroring CatalogScreen. Back closes the drawer and stays on the tab.
2. **Session-scoped pager** — prev/next walks the tapped row's **day-session** only: its
   resolvable problems, deduped by `source_catalog_id` in on-screen order. A one-problem
   day has no arrows; a 7-problem day pages within those 7 and never crosses the date
   boundary. (An earlier revision shipped *no* pager after a review flagged that a
   whole-logbook deduped list maps to no on-screen order; scoping to the session restores
   paging while keeping the order faithful to what's on screen.) The session is a **state
   snapshot** captured at tap time — `?problem` can't name the session (a problem logged
   on two days shares one id), mirroring CatalogScreen's recents `pagerStack`; a cold
   deep-link/refresh falls back to the single open problem.
3. **Non-resolvable rows** are not tappable (no `onSelect`), no error UI, no
   fetch-on-demand. They stay visually identical to tappable rows (iOS parity) and keep
   their edit pencil.
4. **Tap target:** the row's content area (thumbnail + name + grade) becomes one
   `<button>` with `aria-label={`Open ${ascent.problemName}`}` (so its accessible name
   is the problem name, not the concatenated grade/stars/comment text); the edit pencil
   is a sibling button outside it (no nested buttons). Works regardless of
   `showThumbnail`.

## Changes

### `web/src/logbook/logbookSearch.ts` (new)
- `LogbookSearch` = `{ problem: string }`; `LOGBOOK_SEARCH_DEFAULTS = { problem: '' }`;
  `validateLogbookSearch(raw)` coercing `problem` to a string (mirrors
  `catalogSearch.ts` at minimal scope).

### `web/src/router.tsx`
- Add `validateSearch: validateLogbookSearch` and
  `search: { middlewares: [stripSearchParams(LOGBOOK_SEARCH_DEFAULTS)] }` to
  `logbookRoute`.

### `web/src/logbook/LogbookScreen.tsx`
- Read `search` via `getRouteApi('/logbook')`; `openId = search.problem`.
- `current = openId ? catalogById.get(openId) : undefined` (board-scoped; drawer opens
  once the cache resolves, no pending spinner needed for v1).
- Add `favoriteIds` via `useFavorites()` and a board-scoped `sentIds` set (copy the
  lists derivation, scoped to `activeBoard.layoutId`).
- Open (push): `pushed.current = true; navigate({ search: prev => ({ ...prev, problem: id }) })`.
  Close: `pushed.current ? router.history.back() : navigate({ search: prev => ({ ...prev, problem: '' }), replace: true })`.
- Per day-session, precompute `resolveSession(session.ascents, catalogById)` — the
  session's resolvable problems, deduped by `source_catalog_id` in on-screen order.
- On tap, `openProblem(id, sessionProblems)` stashes that session array as `sessionStack`
  state and pushes `?problem`. `displayed = sessionStack ?? (current ? [current] : [])`;
  clear `sessionStack` in an effect when `?problem` clears. `current` resolves the id
  against `sessionStack` first, then `catalogById` (so a deep-link still resolves).
- Render `<Drawer open={current !== undefined} onOpenChange={open => !open && closeDrawer()} showSwipeHandle>`
  with `DrawerContent`, sr-only `DrawerTitle`, scroll container, and — guarded by
  `{current && (...)}` — `<ProblemDetail problem={current} displayed={displayed}
  board={activeBoard} angle={current.angle} favoriteIds={favoriteIds} sentIds={sentIds}
  onNavigate={showProblem} />`. The `{current && ...}` guard is required so
  `current.angle` is never read while the drawer is closed (`current` undefined).
- Pass `onSelect` to `AscentRow` only when the row's catalog entry resolves:
  `onSelect={catalog ? () => openProblem(ascent.sourceCatalogId!, sessionProblems) : undefined}`.

### `web/src/logbook/AscentRow.tsx`
- Change `onSelect?: (ascent: Ascent) => void` to `onSelect?: () => void`.
- Restructure: the content area (thumbnail + info + grade pill) becomes a single
  `<button>` with `aria-label={`Open ${ascent.problemName}`}` when `onSelect` is
  provided, else a plain non-interactive `<div>`; the edit pencil is a sibling button.
  Remove the old thumbnail-only inner button.

## Out of scope
- Cross-day paging (decision 2 — the pager stays within one day-session).
- Pagination surviving a refresh / cold deep-link (session snapshot is state, not URL).
- Opening detail for user-created / uncached rows (decision 3).
- A pending/loading spinner for a deep-linked `?problem` before the cache resolves
  (CatalogScreen has one; the logbook's cache is small and best-effort — v1 skips it).

## Verification
- Browser test on `/logbook`: tap a resolvable row → detail drawer opens with the right
  problem; phone/browser Back closes the drawer and stays on `/logbook`; swipe/backdrop
  also close. No prev/next arrows.
- A user-created / uncached row shows no tap response and still opens edit via pencil.
- `npm run build` / lint clean.
