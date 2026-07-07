# Navigation & UI Flows

The app's navigation shell, the "active board" concept that drives every screen, and the main UI
flows (add/edit board, filter catalog, recently-viewed). Read this before changing tab wiring,
Home board management, or catalog filter state — these are cross-cutting and easy to break.

**Key files:** `MoonBoardApp.swift`, `RootTabView.swift`, `HomeView.swift`, `AddBoardFlow.swift`,
`HoldSetEditorView.swift`, `CatalogListView.swift`, `CatalogProblemDetailView.swift`,
`HoldFilterPickerView.swift`, `SettingsView.swift`.

## Navigation shell

`MoonBoardApp` creates the single `MoonBoardBLEManager` (`@StateObject` → `.environmentObject`),
attaches the SwiftData `.modelContainer`, and shows `RootTabView` in a `WindowGroup`.

`RootTabView` is a **three-tab** bottom nav (native `Tab` on iOS 18+, fallback below):
- **Home** — board management + logbook.
- **Settings** — global display & LED config.
- **Search** — the active board's problem catalog (`CatalogListView` inside a `NavigationStack`).

### TabRouter (cross-tab navigation)

```swift
@Observable final class TabRouter {
    var selection: RootTab = .home
    var listResetToken = 0   // bump to pop the Search catalog back to its list
}
```

Injected via `.environment(router)` so any descendant can switch tabs programmatically (e.g. Home
activating a board jumps to Search). It's **session-only** — never persisted, so the app always
launches on Home. `listResetToken` is incremented when a board is tapped while already active,
signaling `CatalogListView` to dismiss any open problem and return to the list.

The `SearchTab` is **keyed by the active board's id** (`.id(activeBoard.id)`), so switching the
active board fully rebuilds it. Each board's angle comes from `@AppStorage(board.angleKey)`.

## The active-board concept

*Which board Search browses and Home marks "Active".* Stored globally at
`@AppStorage("activeBoardId")` (`ActiveBoard.storageKey`, default Mini 2025 = 7). Resolved in
`RootTabView.activeBoard`: match it within the added-boards list, else fall back to the first added
board (so deleting the active board degrades gracefully). See
[multi-board-model.md](multi-board-model.md) for `AddedBoards` and how boards are registered.

- **Read by**: Home (green "Active" marker), Search (which catalog to show), Logbook/pyramid
  (indirectly, via board filter).
- **Written by**: Home only — on activate, and reassigned to the MRU front when the active board is
  deleted; the first board added becomes active, later adds don't change it.

## Key flows

### Add board (`AddBoardFlow`) — two steps

Triggered by Home's "Add board". Sheet shows available boards → tap one → `ConfigureStep` (which
reuses `BoardConfigForm`) → "Add board" fires `onAdd(board)`. Home then: sets it active if it's the
first, promotes it to the MRU front of `addedBoards`, dismisses. Note angle/hold-set choices in
`BoardConfigForm` are written to `@AppStorage` **live**; only the board's *membership* in
`AddedBoards` is committed on confirm.

### Edit board config (`HoldSetEditorView` → `BoardConfigForm`)

Triggered by swipe-to-edit on a Home board row. `BoardConfigForm` (shared with the add flow) mutates
`@AppStorage(board.activeHoldSetsKey)` and `@AppStorage(board.angleKey)` with a live board preview.
Changes save immediately; "Done" just dismisses. Deactivating a hold set makes the catalog re-filter
(problems needing that set disappear), and the catalog **prunes** any hold-filter positions that no
longer sit on an active set so the filter can't reference orphaned holds.

### Filter the catalog (`CatalogListView`)

A floating **FAB** (bottom-right): **tap** opens the full filter sheet; **long-press** fans the
status/attribute filters out in a radial menu. The sheet covers grade range (two-thumb slider),
min stars, status/attribute toggles (benchmarks, my ascents, not completed, not logged, favorites),
method, sort order, and a full-screen `HoldFilterPickerView` for the holds filter. Active filters
render as dismissible chips above the list. Changing the filter "signature" resets pagination.
Hold-set filtering itself is driven by the board config (above), via
`HoldSetMembership.isClimbable`.

### Recently-viewed (`CatalogListView` + `CatalogProblemPager`)

Swiping to a problem **in the catalog** (not the logbook) records it via `recordRecent`: move-to-
front, dedup, capped at 5, stored per board+angle. `CatalogProblemPager.Source` distinguishes
`.catalog(angle:)` (records recents) from `.logbook` (recentKey nil → never records). A pinned
"Recently viewed" section sits above the list (2 shown by default, expandable, with Clear) and
**ignores all filters** — it resolves stored ids against the full catalog.

## Settings (`SettingsView`)

Global-only config: appearance (System/Light/Dark), "show beta" (all 5 hold types vs. 3),
auto-light-on-swipe, show climb previews, and LED connection status (which opens `ConnectionView`;
calibration lives there now, not in Settings — see [ble-hardware.md](ble-hardware.md)).

## `@AppStorage` state key catalog

**Global:**

| Key | Type | Purpose |
| --- | --- | --- |
| `activeBoardId` | Int | active board (Search / Home marker) |
| `addedBoards` | CSV(Int), MRU | boards the user has added |
| `logbookBoardFilter` | CSV(Int) | which boards' ascents to show (empty = all added) |
| `appAppearance` | enum | theme |
| `showBeta` | Bool | show all 5 hold types |
| `autoLightOnSwipe` | Bool | auto-light while swiping catalog |
| `showClimbPreviews` | Bool | board thumbnail in list rows |
| `catalogMinStars` | Int | min rating filter |
| `catalogFilters` | CSV | status/attribute filters |
| `catalogMethods` | CSV | method filters |
| `catalogSortOrder` | enum | sort order |

**Per board (`_<boardId>`):** `activeHoldSets_<id>`, `flipped_<id>`, `angle_<id>`,
`catalogHoldFilter_<id>` (CSV of `"col-row"`, angle-independent).

**Per board+angle (`_<boardId>_<angle>`):** `catalogLowerGrade_…`, `catalogUpperGrade_…`,
`catalogRecentProblems_…` (CSV of problem ids, max 5, MRU).

## Web PWA routing

The `web/` PWA uses **TanStack Router** (`web/src/router.tsx`, code-based route tree, history
mode). Unlike iOS's session-only `TabRouter`, **the URL is the sole source of truth** for what the
catalog shows — browser back/forward works and every meaningful view is deep-linkable.

**Route tree:**

```
/                        → redirect: no added boards → /boards, else the last-active
                           board's catalog (URL built from the localStorage seed)
/boards                  → MyBoards
/logbook                 → LogbookScreen
/settings                → SettingsScreen (global; appearance/theme)
/board/$layoutId/catalog → CatalogScreen  (search params below)
```

The bottom bar (`web/src/shell/Navigation.tsx`) is four tabs: three home tabs clustered left
(`Boards`, `Logbook`, `Settings`) and `Search` pinned rightmost — `[Boards] [Logbook] [Settings]
… [Search]`. On the catalog the bar collapses to just the **origin** (the last home screen
visited, now including Settings) plus the live search field: e.g. `[Settings] [search…]`.

**Appearance / theme:** `web/src/shell/themeStore.ts` is a module store (mirrors `previewsStore`)
under the `theme` localStorage key (`light` | `dark` | `system`, default `system`, matching iOS's
appearance setting). It owns the imperative side-effects — toggling `.dark` on `<html>` and
rewriting the `theme-color` meta — resolving `system` via `matchMedia` and re-applying live when the
OS flips. A pre-paint inline script in `web/index.html` applies the saved theme before the bundle
loads so there's no flash of the wrong theme (it duplicates the resolve logic — keep the two in
sync). The light/dark token values live in `web/src/index.css` (`:root` / `.dark`).

Guards (route `beforeLoad`): an unknown `layoutId` (not in the board registry) bounces to `/boards`;
a registry-valid but **un-added** board renders a read-only preview with an "Add this board" CTA
(it does *not* bounce). Auth stays a header modal, not a route.

**Catalog search params** (`web/src/catalog/catalogSearch.ts`) — the whole catalog view state:
`q` (search), `grade` (ordinal `min-max` into `FONT_GRADES`), `bench`/`fav` (`1`), `stars`,
`method`/`holds` (comma-joined), `sort`, `angle`, `problem` (open problem id). Every param is
**omitted at its default** via a `stripSearchParams` middleware so URLs stay clean; `validateSearch`
re-fills defaults on read. `sortSecondary` is deliberately *not* in the URL (fixed tie-breaker).

**Load-bearing rules:**

- **URL, not localStorage, is truth for explicit routes.** Per-`(board,angle)` filters live in
  localStorage only as a **cold-launch seed** (`web/src/catalog/filterSeed.ts`) — the sole reader is
  the bare-`/` redirect. `CatalogScreen` writes the seed through on every filter change but never
  renders from it. There is no `searchStore`; the transient search query rides `?q`.
- **`AppLayout`** (`web/src/shell/AppLayout.tsx`) is the router-aware shell that owns the persistent
  search field: a debounced (`replace`) `?q` writer, the URL→input resync (Back/deep-link/board
  switch), and dropping a pending write on board switch. `Navigation` is fully prop-driven.
- **Angle** comes from `?angle` (never a fresh `getAngle()` in render); `CatalogScreen` mirrors the
  resolved angle back into `boardStore` so `/boards` stays coherent with a deep link.
- **Problem drawer**: opening pushes history (Back closes it), paging/swiping `replace`s (URL tracks
  the current problem). A deep-linked problem resolves against the **full slab**, so it opens even
  when the active filters exclude it (prev/next then disable).
- **Logbook problem drawer**: `/logbook` reuses the same `ProblemDetail` in its own `?problem`
  drawer (`web/src/logbook/logbookSearch.ts` — one param, same `stripSearchParams` + push-on-open /
  `router.history.back()` close as the catalog). Two deliberate differences: it's history-integrated
  precisely *because* `/logbook` is a tab root (a pure-local-state drawer would make Back leave the
  tab), and it passes `displayed={[current]}` so there's **no pager** — a logbook row is a single
  event, and a deduped cross-problem sequence would map to no on-screen order. Rows whose ascent has
  no resolvable catalog entry (user-created or uncached) aren't tappable.
- **PWA**: `vite.config.ts` sets `navigateFallback: '/index.html'` (+ `/assets/` denylist) so deep
  links and the OAuth return survive a hard load. `AppLayout` also mounts two iOS-only, environment-
  gated shell banners (`web/src/shell/{BleBrowserBanner,InstallBanner}.tsx`), driven by the detection
  helpers in `web/src/lib/pwa.ts`. Three mutually-exclusive banners:
    - **`BleBrowserBanner`** — non-dismissable, shown on any browser **without** Web Bluetooth (the
      board can't connect). Recommendation branches on `isIosLike()`: **Bluefy** on iOS, **Chrome**
      elsewhere (Android Firefox, desktop Safari/Firefox).
    - **`InstallBanner`** — real one-tap PWA install driven by `beforeinstallprompt` (Chrome/Edge/
      Samsung on Android + desktop Chromium). iOS never fires the event, so it's absent there.
    - **`FullscreenTipBanner`** — iOS-only (has Web Bluetooth, i.e. Bluefy): a dismissable tip to hide
      the browser bars via Bluefy's **☰ → Enter fullscreen** (Bluefy has no "Add to Home Screen";
      that's Safari-only and would lose Web Bluetooth). Auto-hides if the page reports fullscreen.
  Exclusivity: `BleBrowserBanner` needs no BLE; the other two need BLE. `InstallBanner`
  (`beforeinstallprompt`) never fires on iOS, where `FullscreenTipBanner` lives. All suppress once
  `isStandalone()`.
- **Deferred**: scroll restoration (accepts jump-to-top on Back for now); the `holds` param is
  reserved but its picker UI is not built yet.

## Gotchas summary

- `TabRouter` is session-only; app always starts on Home. Use it (not global state) for cross-tab jumps.
- `SearchTab` is keyed by board id — changing the active board rebuilds it entirely.
- Active board is written by Home only; everything else reads it. Deleting it falls back to MRU front.
- Deleting/editing a board cascades: clears/updates its per-board keys and prunes the catalog hold filter.
- Recently-viewed is recorded only from the catalog source and ignores filters when displayed.
- Grade range is clamped to the board's actual grade list; catalogs load async off the main thread.
