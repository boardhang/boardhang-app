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
/boards                  → FirstBoard (first-run page); with a board added → redirect to /
/boards/add              → AddBoardPick  (add a board, step 1: which board)
/boards/add/$layoutId    → AddBoardSetup (step 2: angle and hold sets)
/boards/$layoutId/edit   → EditBoard     (angle, hold sets, remove)
/logbook                 → LogbookScreen
/settings                → SettingsScreen (global; appearance/theme, climb previews,
                           catalog cache, logbook export/import, site links; plus the
                           admin-only BLE lab card)
/board/$layoutId/catalog → CatalogScreen  (search params below)
```

The bottom bar (`web/src/shell/Navigation.tsx`) has three tabs clustered left (`Logbook`,
`Lists`, `Settings`) and `Search` pinned rightmost — `[Logbook] [Lists] [Settings] … [Search]`.
On the catalog the same three tabs sit beside the live search field, which takes the rest of
the width: `[Logbook] [Lists] [Settings] [search…]`. Boards have no tab. A screen that belongs
to no tab (the first-run page, the add and edit pages, the join route, the logbook import)
highlights none.

**Boards (`web/src/boards/`).** The active board's full name sits at the left of the header on
every screen (`BoardsDrawer`, mounted in `AppLayout`), and is the one place to switch, add and
manage boards. It renders nothing while no board is added.

- **The drawer** slides up from the bottom over any screen. It is shell state, not a route, so
  it never changes the URL and adds no history entry (browser Back leaves the screen behind
  it). Top to bottom: the "That session has ended." notice, "Resume session" rows, the added
  boards as picture tiles three per row (`BoardTile`: picture with the board's hold sets, short
  name, angle), a dashed "Add a board" tile (hidden once every registry board is added), and a
  "Scan a QR code" row (hidden while a session is active).
- **Tiles.** Tapping an inactive tile makes that board active and keeps the drawer open;
  tapping the active tile (outlined, "Browse") closes the drawer and opens its catalog. The
  pencil in a tile's corner opens that board's edit page. An inactive tile shows a dot when
  its board has unseen new benchmarks. Tile order is frozen while the drawer is open
  (activating a board moves it to the front of the stored order) and re-read on the next open.
- **Closing.** The drawer closes on a route change to anything that is not a catalog, on the
  active tile, and when a resumed session becomes active. A catalog-to-catalog change keeps
  it open.
- **The catalog follows the active board, and the other way round**
  (`useFollowActiveBoard`). When the active board changes while another board's catalog is
  showing, the shell replaces the route with the new active board's catalog. When a catalog
  route shows an added board that is not active (browser Back onto an older entry, a shared
  problem link, "Add this board" on a preview), that board becomes active. So the header never
  names a different board than the catalog shows. Two cases are left alone: the preview of a
  board that is not added (the header keeps naming the active board), and any route that is
  not a catalog. When the routed board already is the active one nothing happens, which
  leaves `?problem`, `?q` and the filters untouched.
- **Adding** is two full pages. `/boards/add` ("Which board?") lists every registry board;
  one that is already added says "You have this one" and opens its edit page.
  `/boards/add/$layoutId` ("How is it set up?") holds the angle and hold sets as a draft,
  starting from the store's values for that board, with an "Add board" bar docked in the
  shell's bottom slot. Nothing is stored until that button is pressed; it then adds the
  board, stores the setup, makes the board active and replaces the step with its catalog.
- **Editing** is `/boards/$layoutId/edit`: the same angle and hold-set controls
  (`BoardSetupFields`), each change written to `boardStore` at once, with no Save. Editing
  does not make a board active. "Remove board" asks first on the page itself; confirming
  removes the board and goes to `/`.
- **First run.** With no board added, `/` lands on `/boards`: one card with one "Add a board"
  button, and the scan row. With a board added, `/boards` redirects to `/`.

**Climb previews:** `web/src/catalog/previewsStore.ts` holds four independent per-surface
toggles (`showClimbPreviews.catalog|logbook|lists|lastOpened` localStorage keys, all default on;
the legacy global `showClimbPreviews` key is ignored). Settings renders a switch per surface;
the catalog list header keeps its inline shortcut button, which flips only the `catalog` toggle.
The recents sheet follows `catalog`; `lastOpened` hides just the thumbnail inside the
last-opened bar, not the bar itself.

**Appearance / theme:** `web/src/shell/themeStore.ts` is a module store (mirrors `previewsStore`)
under the `theme` localStorage key (`light` | `dark` | `system`, default `system`, matching iOS's
appearance setting). It owns the imperative side-effects — toggling `.dark` on `<html>` and
rewriting the `theme-color` meta — resolving `system` via `matchMedia` and re-applying live when the
OS flips. A pre-paint inline script in `web/index.html` applies the saved theme before the bundle
loads so there's no flash of the wrong theme (it duplicates the resolve logic — keep the two in
sync). The light/dark token values live in `web/src/index.css` (`:root` / `.dark`).

**BLE lab (admin only):** `web/src/shell/BleLabSection.tsx` renders at the bottom of Settings
only when `useAuth().isAdmin` (the Supabase `app_metadata.role = "admin"` claim — see
[social-accounts-login-SETUP.md](social-accounts-login-SETUP.md) §5b). It drives two device-local
stores: the lab settings (`ble.lab.v1`: experimental path on/off, device picker, write mode) and
the Bluetooth diagnostics log (`ble.diag.v1`, written only while the lab is on). Changing a
setting disconnects the board first. What the lab changes in the Bluetooth client is in
[ble-hardware.md](ble-hardware.md); nothing else in the app reads these keys.

Guards (route `beforeLoad`): on the catalog, an unknown `layoutId` (not in the board registry)
bounces to `/boards`, which lands on the active board's catalog or the first-run page; a
registry-valid but **un-added** board renders a read-only preview with an "Add this board" CTA
(it does *not* bounce). `/boards/add/$layoutId` sends an unknown id to `/boards/add` and an
already-added board to its edit page; `/boards/$layoutId/edit` sends a board that is not added
to `/boards/add/$layoutId`. Auth stays a header modal, not a route.

**Catalog search params** (`web/src/catalog/catalogSearch.ts`) — the whole catalog view state:
`q` (search), `grade` (ordinal `min-max` into `FONT_GRADES`, both bounds floored at 6A+ —
`GRADE_FILTER_FLOOR` — so stray sub-6A+ catalog grades never surface in the filter; the range
predicate treats them as 6A+), `bench`/`fav` (`1`), `stars`,
`method`/`holds`/`status`/`list` (comma-joined), `setter` (comma-joined, each name
percent-encoded because setter names contain commas), `sort`, `angle`, `problem` (open problem
id), `newSince` (ISO timestamp — see below).
`list` is a CSV of saved-list ids the catalog is filtered by (OR'd — a problem passes if it's in
any); its membership is resolved from the offline lists store and the ids are pruned against the
board's live lists once loaded (a stale/foreign id self-heals out of the URL, but only after the
lists load so a valid deep-link survives a cold launch).
`setter` is the setter facet: an OR over exact (whitespace-trimmed, case-kept) setter names, picked
in a searchable sheet whose per-setter counts are *faceted* — each is the number of that setter's
problems that pass every other active filter, so zero-count setters stay listed but dimmed. The
sheet shows the top 100 by count until you type (`web/src/catalog/SetterFilterSheet.tsx`,
`setterOptions` in `filters.ts`). Each name is percent-encoded before the comma join, so a
hand-written link must encode it too: `?setter=Sev-Ron%2010%2C000` (the address bar shows it
encoded once more by the router). A name that sets nothing on the slab stays selected — captioned
"No problems match" and removable — rather than self-healing out of the URL like `list`.
Every param is **omitted at its default**
via a `stripSearchParams` middleware so URLs stay clean; `validateSearch` re-fills defaults on read.
`sortSecondary` is deliberately *not* in the URL (fixed tie-breaker).

**Load-bearing rules:**

- **URL, not localStorage, is truth for explicit routes.** Per-`(board,angle)` filters live in
  localStorage only as a **cold-launch seed** (`web/src/catalog/filterSeed.ts`) — the sole reader is
  the bare-`/` redirect. `CatalogScreen` writes the seed through on every filter change but never
  renders from it. There is no `searchStore`; the transient search query rides `?q`.
- **`AppLayout`** (`web/src/shell/AppLayout.tsx`) is the router-aware shell that owns the persistent
  search field: a debounced (`replace`) `?q` writer, the URL→input resync (Back/deep-link/board
  switch), and dropping a pending write on board switch. `Navigation` is fully prop-driven.
- **Sticky header**: the account chrome is a frosted `position: sticky` bar (first child of the
  `.app-scroll` container, so content scrolls under it and blurs through — `bg-background/50` +
  `backdrop-blur`, with an opaque `@supports` fallback where blur is unsupported; a hairline border
  plus a shadow that lifts once scrolled). It's a three-slot stack: a **top slot** for the
  environment banners (below), the **navbar** (right-aligned `AccountMenu`), and a **bottom slot**
  for the `SessionPill` (shown when a session is active, except on the catalog where `SessionBar`
  owns it), then two portal slots the catalog fills: the **filter-pill slot** (`headerFilterSlot`)
  and the **session-bar slot** (`headerSessionSlot` — `SessionBar` portals in while a session for
  the routed board is active, so the crew controls stay reachable as the list scrolls, issue #98.
  Past ~120px of scroll the full bar folds away and a floating `SessionBarPill` (docked
  centered below the header) takes over — lit problem + Queue/Share + a chevron that
  re-expands the bar in place; see `catalog/useScrollCollapse.ts` for the hysteresis and
  gesture rules, and [collaboration-sessions.md](collaboration-sessions.md) for the pill's
  behavior).
  Empty slots collapse (`.app-header-slot:empty`). The bottom `Navigation` stays a solid
  grid-row bar. Stacking convention: the header (and everything hanging off it, like the
  session pill) sits at `z-40` — above in-page floating chrome such as the catalog's
  sticky FAB cluster (`z-30`), below portaled overlays (drawers/dialogs/popovers, `z-50`).
- **Angle** comes from `?angle` (never a fresh `getAngle()` in render); `CatalogScreen` mirrors the
  resolved angle back into `boardStore` so the boards drawer and the edit page stay coherent
  with a deep link. One exception: an angle just set on the board's edit page beats the URL.
  Browser Back from that page lands on a catalog entry that still carries the old `?angle`,
  and mirroring it would undo the edit, so the edit page marks the board in memory
  (`web/src/boards/angleEdited.ts`) and the catalog, finding the mark with a differing URL
  angle, replaces its URL with the stored angle instead. The mark clears once the two agree.
- **Problem drawer**: opening pushes history (Back closes it), paging/swiping `replace`s (URL tracks
  the current problem). A deep-linked problem resolves against the **full slab**, so it opens even
  when the active filters exclude it (prev/next then disable). The drawer's beta strip caps at 4
  cards — more clips collapse into a "+N View all" tile opening a grid sheet of all of them
  (`web/src/beta/BetaGridSheet.tsx`). Sheets stacked over the drawer (the beta player, and the
  grid sheet it can sit on) each push their own history entry via
  `web/src/beta/useHistoryBackClose.ts`, so Back unwinds player → grid → drawer instead of
  popping `?problem=`.
- **Share button** (drawer header, top-right, the same `Share2` glyph as the session share):
  hands a friend the canonical deep link `/board/{layout}/catalog?angle={angle}&problem={id}`,
  built by `web/src/catalog/problemShareUrl.ts` from the problem **row** (`layout_id`, `angle`,
  `source_catalog_id`) with `window.location.origin` — never from the address bar, which
  carries the sharer's filters and, on the logbook/list hosts, isn't a catalog URL at all.
  `shareProblem` calls `navigator.share` synchronously in the tap (Safari revokes the gesture
  across an `await`) with the link as `url` and "Name Grade" as `title` only — no `text`, which
  chat apps would post as a second bubble beside the link card; cancel is silent, any other rejection or a
  missing share API copies the link and toasts "Link copied", and with no clipboard either an
  error toast carries the link. The button dims while a share is in flight. Because
  `ProblemDetail` is shared, the button exists on the catalog, logbook and list-detail drawers.
  The recipient lands on the ordinary deep-link path (spinner until the slab syncs, "Add this
  board" banner if needed, angle mirrored into `boardStore`). Chat apps unfurl these URLs with a
  per-problem card served by Vercel functions on www — see
  [content-site.md](content-site.md#link-previews-for-shared-problem-urls-www).
- **Logbook problem drawer**: `/logbook` reuses the same `ProblemDetail` in its own `?problem`
  drawer (`web/src/logbook/logbookSearch.ts` — one param, same `stripSearchParams` + push-on-open /
  `router.history.back()` close as the catalog). It's history-integrated precisely *because*
  `/logbook` is a tab root (a pure-local-state drawer would make Back leave the tab). The pager
  **domain is the tapped row's day-session** — its resolvable problems, deduped by
  `source_catalog_id` in on-screen order — so prev/next stays within that date and never crosses
  into another day. Like CatalogScreen's recents `pagerStack`, the session is a state snapshot
  captured at tap time (the id in `?problem` can't name the session, since a problem logged on two
  days shares one id); a cold deep-link/refresh has no snapshot and falls back to the single open
  problem (prev/next off). Rows whose ascent has no resolvable catalog entry (user-created or
  uncached) aren't tappable.
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
- **New-benchmark surfaces** (`web/src/catalog/benchmarkNewsStore.ts`) — a public-read events
  table (`benchmark_events`, migration 0018) drives three UI surfaces off the same source:
  the catalog banner ("N new benchmarks — view/dismiss") on the active slab, a small dot on
  every other added board's tile in the boards drawer, and the `?newSince=<iso>` deep-link view that
  renders only problems promoted after that timestamp. The device-local watermark (one per
  slab, `benchmarkSeen_${layoutId}_${angle}` localStorage) defaults to now-on-first-touch so
  a fresh install / first-ever sync never presents pre-existing benchmarks as new. "View",
  "Dismiss", and the R3 silent-advance (every unseen event on the slab is filtered out by
  uninstalled hold sets) all advance the watermark, which drops the banner + dot in the same
  frame. `newSince` lives OUTSIDE `FilterState` — `filtersToSearch` and `filterSeed` skip it
  — so a filter tweak inside the deep-link view doesn't rewrite the URL and the seed never
  re-opens a stale `?newSince` on cold launch. The catalog forces one `syncSlab` when the
  events resolve to ids the slab doesn't yet have (events row can precede slab rows locally).
- **Deferred**: scroll restoration (accepts jump-to-top on Back for now); the `holds` param is
  reserved but its picker UI is not built yet.

## Gotchas summary

- `TabRouter` is session-only; app always starts on Home. Use it (not global state) for cross-tab jumps.
- `SearchTab` is keyed by board id — changing the active board rebuilds it entirely.
- Active board is written by Home only; everything else reads it. Deleting it falls back to MRU front.
- Deleting/editing a board cascades: clears/updates its per-board keys and prunes the catalog hold filter.
- Recently-viewed is recorded only from the catalog source and ignores filters when displayed.
- Grade range is clamped to the board's actual grade list; catalogs load async off the main thread.
