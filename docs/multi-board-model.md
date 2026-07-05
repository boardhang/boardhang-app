# Multi-Board Model & Board Registry

How the app represents multiple physical boards, which ones the user has "added", which one is
"active", and how per-board hold-set selection drives catalog filtering and rendering.

**Key files:** `Board.swift` (`Board`, `AddedBoards`, `CatalogIndex`, `Ascent` extension),
`MoonBoardSetup.swift` (physical setup definitions), `HoldSetMembership.swift`
(`ActiveHoldSets`, membership), `BoardFilter.swift` (logbook board filter).

## Layers of identity

There are three nested concepts — keep them distinct:

1. **`MoonBoardSetup`** (in `MoonBoardSetup.swift`) — the _physical_ board: `id` (the layout id,
   1–7), name, art folder, background asset, `MoonBoardGeometry`, and its list of `MoonBoardHoldSet`s.
2. **`Board`** (in `Board.swift`) — a _supported/registered_ board = a `MoonBoardSetup` plus the
   angles it has catalogs for, catalog resource prefix, and hold-set membership resource name.
   `Board.all` is the registry the app exposes. The **`id` is the layout id** — `Board` is a
   wrapper, the integer layout id is the true key used in storage and ascents.
3. **added / active** — runtime user state layered on top (below).

### Board / layout id table

layout ids 1–7. The app currently **registers 5** of them in `Board.all`:

| Layout id | Board          | slug                   | Registered?            |
| --------- | -------------- | ---------------------- | ---------------------- |
| 1         | MoonBoard 2010 | `moonboard2010`        | no                     |
| 2         | MoonBoard 2016 | `moonboard2016`        | yes                    |
| 3         | MoonBoard 2024 | `moonboard2024`        | yes                    |
| 4         | Masters 2017   | `moonboardmasters2017` | yes                    |
| 5         | Masters 2019   | `moonboardmasters2019` | yes                    |
| 6         | Mini 2020      | `minimoonboard2020`    | no                     |
| 7         | **Mini 2025**  | `minimoonboard2025`    | yes (the user's board) |

Mini boards have `rowTop = 12`; standard boards `rowTop = 18`.

## Added boards & active board

Two separate pieces of runtime state, both global `@AppStorage`:

- **`AddedBoards`** — the boards the user has added, persisted at `@AppStorage("addedBoards")` as
  a `"|"`-joined CSV of layout ids in **MRU order** (most recently used/added at the front).
  `AddedBoards.ids(from:)` parses, de-duplicates, and filters to _currently supported_ boards;
  `AddedBoards.boards(from:)` resolves to `Board` instances; `AddedBoards.promoting(_:in:)` moves
  an id to the front. **Empty CSV = no boards yet** (first-launch onboarding state).

- **Active board** — `@AppStorage("activeBoardId")` (`ActiveBoard.storageKey`), default
  `Board.mini2025.id` (7). This is _which board the Search tab browses_ and which Home marks
  "Active". Resolved by `RootTabView.activeBoard`: find the added board whose id matches, else
  fall back to the first added board (so a deleted active board degrades gracefully). See
  [navigation-and-ui-flows.md](navigation-and-ui-flows.md) for who reads/writes it.

## Per-board settings keys

Each board namespaces its settings by layout id:

| Accessor                  | Key example (Mini 2025) | Meaning                                             |
| ------------------------- | ----------------------- | --------------------------------------------------- |
| `board.activeHoldSetsKey` | `activeHoldSets_7`      | which hold sets are installed (CSV of set ids)      |
| `board.flippedKey`        | `flipped_7`             | LED strip wiring orientation (set in `LEDTestView`) |
| `board.angleKey`          | `angle_7`               | selected wall angle (multi-angle boards only)       |

## Angles & catalog resources

- Single-angle boards (Mini 2025): catalog resource = the prefix, e.g. `MiniMoonBoard2025Catalog`.
- Multi-angle boards: `board.catalogResource(angle:)` appends the angle, e.g.
  `MoonBoardMasters2019Catalog_40`. The angle suffix is only applied when `board.hasAngleChoice`.
- Default angle is the first entry in the board's `angles` array.

The catalog is **server-distributed**, not bundled: a resource name now identifies a board+angle
"slab" that `CatalogSyncManager` syncs from Supabase into a local disk cache
(`Application Support/CatalogCache/<resource>.json`), which `Catalog.load` reads. A slab syncs
lazily — when its board is added/activated or its catalog list opens. See
[catalog-data-pipeline.md](catalog-data-pipeline.md) for the pipeline and file naming.

## Hold-set membership & filtering

A board's hold sets split into two kinds (`HoldSetMembership.swift`, `Board` helpers):

- **`filterableHoldSets`** — sets that own ≥1 numbered grid hold. These appear in the board config
  editor and participate in catalog filtering.
- **`alwaysOnHoldSetIDs`** — sets that own _zero_ grid holds (e.g. "Screw-on Feet"). These are pure
  art: always rendered as overlays, never shown in the filter UI. A set is in one bucket or the
  other, never both.

`membership: [String: Int]` maps a `"col-row"` position to the hold-set id that owns it (loaded
from the board's bundled `…HoldSets.json`). `ActiveHoldSets` parses the user's per-board selection
from `@AppStorage(board.activeHoldSetsKey)` (`"|"`-joined ids; **empty = all filterable sets
active**). `HoldSetMembership.isClimbable(holds:activeSetIDs:)` returns true only if every hold in
a problem is owned by an active set — this is what filters the catalog when a hold set is
uninstalled. For rendering, the visible set = active ids ∪ `alwaysOnHoldSetIDs`.

## BoardFilter (logbook / pyramid)

`BoardFilter` (in `BoardFilter.swift`) is the _logbook_ board filter, persisted at
`@AppStorage("logbookBoardFilter")` as a `"|"`-joined CSV of layout ids. Semantics differ from
`AddedBoards`: **empty CSV = all added boards shown**. The selection is always intersected with the
added set, so removing a board silently drops it from the filter. UI: `BoardFilterMenu` and
`BoardFilterPills`. It's only surfaced when more than one board is added.

## Lists & Favorites (active-board scoped)

The **Lists tab** is scoped to the **active board** — the layout id in
`@AppStorage(ActiveBoard.storageKey)` (default Mini 2025), the one the Search tab is
browsing. Everything on the page is tied to it; switching the active board on the Home tab
swaps what's shown. Boards never mix on this page.

- **Your lists**: `ListsView` filters `ListsManager.myLists` to `board_layout_id ==
  activeBoardId`. Lists on other boards still exist in the cloud — they're hidden until that
  board is active again (never deleted). The active board's name is shown once in the page
  header as a read-only caption.
- **Create list**: `CreateListSheet` is name-only, no board picker — new lists always use the
  active board. To make a list for another board, switch the active board first.
- **Favorites**: `FavoriteProblem` stores only a catalog id; the board is derived via
  `CatalogIndex`. `FavoritesView` is hard-scoped to the active board (no board pills), and the
  pinned Favorites card's problem count on the Lists page is board-scoped to match.

This is single-board selection, unlike the logbook's multi-select `BoardFilter` above — don't
conflate the two.

## Resolving a logged ascent's board: `effectiveBoardLayoutId`

Catalog problems are shared identifiers that may exist on multiple boards, so an `Ascent`'s stored
`boardLayoutId` can be stale/ambiguous. The `Ascent.effectiveBoardLayoutId` extension (in
`Board.swift`) resolves it:

1. If `sourceCatalogID` is set, look it up in `CatalogIndex` → the authoritative board's id.
2. Otherwise fall back to the stored `boardLayoutId` (used for user-created problems).

`CatalogIndex` maps every catalog problem id → `{board, problem}` across all synced catalog slabs
(first occurrence wins). It's built lazily from the on-disk cache and rebuilt when
`CatalogSyncManager` invalidates it after a pull, so a problem resolves once its slab has synced;
an un-synced id returns nil and the ascent still renders from its denormalized name/grade snapshot.
Stored `boardLayoutId` **defaults to 7**
(Mini 2025), which backfills pre-multi-board ascents. The logbook filters by
`effectiveBoardLayoutId`, not the raw stored value — see [data-model-and-logging.md](data-model-and-logging.md).

## Web port

The PWA (`web/`) mirrors this model in TypeScript, keyed by the same layout ids and
`localStorage` keys so state is traceable across apps:

- `web/src/board/boards.ts` — the board registry + render geometry (the `Board`/`MoonBoardSetup` port).
- `web/src/board/boardStore.ts` — added/active/per-board state on `localStorage`, using the same
  `addedBoards` / `activeBoardId` / `angle_<id>` / `flipped_<id>` / `activeHoldSets_<id>` keys.
- `web/src/board/holdSetMembership.ts` — the `HoldSetMembership` + `ActiveHoldSets` port.
  Membership JSON is bundled under `web/src/board/membership/` (generated by
  `scripts/derive_holdset_membership.py`, which writes both the iOS and web copies).

The browse UI that consumes this state lands in later phases; see
[`docs/plans/2026-07-04-001-feat-pwa-catalog-browser-plan.md`](plans/2026-07-04-001-feat-pwa-catalog-browser-plan.md).

## Gotchas summary

- Layout id (Int) is the real key; `Board`/`MoonBoardSetup` are wrappers around it.
- `AddedBoards` empty = none added; `BoardFilter` empty = all boards. Different meanings.
- Per-board settings are namespaced by id (`activeHoldSets_<id>`, `flipped_<id>`, `angle_<id>`).
- Active-hold-sets empty = _all_ filterable sets active (not "none").
- Always-on hold sets (feet) are rendered but never filterable.
- Use `effectiveBoardLayoutId`, not `boardLayoutId`, when grouping/filtering ascents by board.
- Lists/Favorites are single-board (the active board); the logbook's `BoardFilter` is multi-select. Don't conflate.
