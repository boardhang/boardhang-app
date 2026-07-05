---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
type: feat
title: "feat: Global board switcher on board-scoped surfaces"
date: 2026-07-05
depth: lightweight
---

# feat: Global board switcher on board-scoped surfaces

## Summary

Add a shared `BoardSwitcher` control to the two board-scoped surfaces — the Search catalog (`CatalogListView`) and the Lists tab (`ListsView`) — so a user can re-scope the active board **in place**, without leaving the screen. Today the active board (`@AppStorage("activeBoardId")`) can only be changed on Home, and changing it there force-jumps the user to the Search tab. This makes re-scoping Lists (or Search) to another board a four-step detour (leave → Home → tap → thrown to Search → tab back). The switcher writes the same state Home's `activate()` writes, minus the tab jump, and the existing reactive plumbing re-scopes the current screen automatically.

This is the no-regret first slice of a broader navigation/IA exploration (see `scratchpad/nav-ia-exploration.md`). The larger Boards / Lists / You restructure is **deferred** — this plan is the switcher only.

**Product Contract preservation:** N/A — direct planning (`ce-plan-bootstrap`), no upstream requirements doc.

---

## Problem Frame

- `activeBoardId` is a global mode scoping Search, Lists, and Favorites (`RootTabView.swift` `ActiveBoard`, `SearchTab`; `ListsView.swift` `activeBoard`/`boardLists`).
- It is written in exactly one place: `HomeView.activate(_:)` (`ios/MoonBoardLED/Views/HomeView.swift:151`) and its twin in `AllBoardsView.activate(_:)` (`:230`). Both do three writes: `addedCSV = AddedBoards.promoting(board.id, in: addedCSV)`, `activeBoardId = board.id`, then `router.selection = .search` + `router.listResetToken += 1`.
- The last two writes are what yank the user to Search. There is no way to change the active board *from* Search or Lists.
- Both target screens already **display the active board name** in their title area — `CatalogListView.swift:533` (`.navigationTitle(board.name)`) and the read-only board-name section header in `ListsView.swift`. The switcher replaces a static label with an interactive one in the same spot; it is not new chrome.

Because `SearchTab` is keyed `.id(activeBoard.id)` (`RootTabView.swift`) and `ListsView` derives everything off `activeBoardId`, writing that key from anywhere rebuilds the current screen reactively. The fix is: expose those writes from a control on the board-scoped surfaces, omitting the router jump.

---

## Requirements

- **R1** From the Search catalog and the Lists tab, the user can open a control listing their added boards and select one to make it the active board.
- **R2** Selecting a board re-scopes the current screen in place — no tab change, no navigation to Search.
- **R3** Selecting a board promotes it to MRU-front (same `AddedBoards.promoting` behavior Home uses), so board ordering stays consistent across the app.
- **R4** The control also offers a way to reach board management (add/remove/configure) on Home.
- **R5** Home is unchanged — tapping a board there still activates-and-jumps (that gesture means "open this board").

---

## Key Technical Decisions

**KTD1 — One shared component, mounted twice.** A single `BoardSwitcher` SwiftUI view is placed in `ToolbarItem(placement: .principal)` on both surfaces. Identical behavior on both; no per-surface forks. Rationale: the two screens already show the board name centrally, the trailing toolbar slots are occupied (Search: climb-preview toggle; Lists: `+`), and `.principal` is the natural home for a title-as-switcher.

**KTD2 — Reuse the exact state writes Home uses, minus the jump.** The switcher's selection action performs `addedCSV = AddedBoards.promoting(board.id, in: addedCSV)` then `activeBoardId = board.id`, reading/writing the same `@AppStorage(ActiveBoard.storageKey)` and `@AppStorage(AddedBoards.storageKey)` keys as `HomeView`. It deliberately does **not** touch `TabRouter.selection` or `listResetToken`. Rationale: the reactive rebuild (`.id(activeBoard.id)` on Search, `boardLists`/`activeBoard` recompute on Lists) already handles re-scoping; the jump is the only thing to drop.

**KTD3 — `Menu`, not a sheet.** A native SwiftUI `Menu` labeled with the current board name + `chevron.down`, its items the added boards plus a "Manage boards…" row. Rationale: lightest-weight picker, no presentation-state to manage, reads as a title dropdown. A sheet would be over-engineered for a short list.

**KTD4 — "Manage boards…" routes to Home via `TabRouter`.** The management row sets `router.selection = .home` (the one place board add/remove/config lives). Rationale: don't duplicate board management; point at it.

---

## Implementation Units

### U1. Create the shared `BoardSwitcher` component

**Goal:** A reusable nav-bar control that shows the active board and re-scopes it in place.

**Requirements:** R1, R2, R3, R4

**Dependencies:** none

**Files:**
- `ios/MoonBoardLED/Views/BoardSwitcher.swift` (new)

**Approach:**
- A `View` reading `@AppStorage(ActiveBoard.storageKey)` (`activeBoardId`) and `@AppStorage(AddedBoards.storageKey)` (`addedCSV`), plus `@Environment` access to the `TabRouter` for the "Manage boards…" action (mirror how `HomeView` obtains the router).
- Body is a `Menu`:
  - Label: current board name (`Board.with(layoutId: activeBoardId).name`) + `chevron.down`. Start text-only (see Open Questions on thumbnail).
  - Items: `ForEach(AddedBoards.boards(from: addedCSV))` — each selects that board via the KTD2 writes (a small private `select(_:)` mirroring `HomeView.activate` minus the router lines). Mark the active board (e.g. checkmark).
  - A trailing "Manage boards…" item that sets `router.selection = .home`.
- No forced `router.selection = .search`, no `listResetToken`.
- Keep the write logic in one private method so both mount sites get identical behavior.

**Patterns to follow:** `HomeView.activate(_:)` (`ios/MoonBoardLED/Views/HomeView.swift:151-158`) for the writes; `AddedBoards.promoting`/`boards(from:)` (`ios/MoonBoardLED/Board/Board.swift:115,133`); `Board.with(layoutId:)` for name resolution.

**Test scenarios:** `Test expectation: none — the project has no unit-test target (no XCTest target in `ios/MoonBoardLED.xcodeproj`); this is a SwiftUI view verified via build + manual behavior (see Verification). Behavioral expectations: menu lists exactly the added boards; the active board is marked; selecting a non-active board updates `activeBoardId` and promotes it in `addedCSV`; "Manage boards…" switches the tab to Home.`

**Verification:** Component compiles; when embedded, the menu shows added boards and the active one is marked.

---

### U2. Mount the switcher on the Search catalog

**Goal:** Replace the static board-name title on Search with the switcher.

**Requirements:** R1, R2

**Dependencies:** U1

**Files:**
- `ios/MoonBoardLED/Views/CatalogListView.swift` (modify — toolbar/title area around `:533`, `:543`)

**Approach:**
- Add `ToolbarItem(placement: .principal) { BoardSwitcher() }` to the existing `.toolbar` block (`:543`).
- The current `.navigationTitle(board.name)` (`:533`) becomes redundant as the visible title; keep it as `""` or leave as an accessibility/back-title fallback — pick whichever renders cleanly with `.inline` display mode. Do not remove the climb-preview toggle at `:544`.
- No behavioral change to the catalog itself — `SearchTab`'s `.id(activeBoard.id)` keying already rebuilds it when `activeBoardId` changes.

**Patterns to follow:** existing `ToolbarItem(placement: .topBarTrailing)` in the same block (`CatalogListView.swift:544`).

**Test scenarios:** `Test expectation: none — UI wiring, no test target. Behavioral expectations: switcher appears centered in the Search nav bar; selecting another board rebuilds the catalog for that board without leaving the Search tab.`

**Verification:** On Search, the nav bar shows the switcher; picking a different board swaps the catalog in place, staying on Search.

---

### U3. Mount the switcher on the Lists tab

**Goal:** Replace the read-only board-name header on Lists with the switcher.

**Requirements:** R1, R2

**Dependencies:** U1

**Files:**
- `ios/MoonBoardLED/Views/Lists/ListsView.swift` (modify — toolbar + the board-name section header added in the prior board-scoping change)

**Approach:**
- Add `ToolbarItem(placement: .principal) { BoardSwitcher() }` to `ListsView`'s existing `.toolbar` (which already holds the `+` / New list action).
- Remove (or reduce) the read-only `activeBoard.name` section header now that the switcher states the scope interactively. Keep `.navigationTitle("Lists")` behavior consistent with the switcher occupying the principal slot — verify the title/switcher don't visually collide under `.inline`; if they do, drop the static "Lists" title in favor of the switcher.
- `boardLists`/`activeBoard` already recompute off `activeBoardId`, so lists re-scope live on selection.

**Patterns to follow:** the existing `.toolbar { ToolbarItem(placement: .primaryAction) { ... } }` in `ListsView.swift`; the board-scoping logic added in the prior change (`boardLists`).

**Test scenarios:** `Test expectation: none — UI wiring, no test target. Behavioral expectations: switcher appears in the Lists nav bar; selecting another board swaps "Your lists" and the Favorites card count to that board without leaving Lists; the create-list sheet still targets the (now newly-active) board.`

**Verification:** On Lists, the nav bar shows the switcher; picking a different board swaps the visible lists + Favorites count in place, staying on Lists.

---

## Scope Boundaries

**In scope:** the shared `BoardSwitcher` and its two mount points (Search, Lists).

### Deferred to Follow-Up Work
- The broader **Boards / Lists / You** navigation restructure (`scratchpad/nav-ia-exploration.md`).
- Harmonizing Home's activate-and-jump with the in-place switcher (dropping the forced jump from `HomeView.activate`). Left as-is per R5.
- Surfacing Profile/account (the second IA seed).
- Adding the switcher to any other surface (Favorites detail, etc.).

---

## Open Questions (non-blocking, resolve during implementation)

- **Label form:** text-only ("Mini 2025 ▾") vs. board thumbnail + name. Start text-only; add a thumbnail only if it reads well in the `.inline` nav bar on iPhone (a thumbnail + long name can crowd the principal slot).
- **Single / zero added boards:** with one added board the menu has nothing to switch to — show it disabled, or render a plain title? With zero added boards (Search already shows a "go to Home" empty state) the switcher likely shouldn't appear. Pick the least-surprising behavior when wiring U2/U3; default suggestion: show a non-interactive board name when there is 0–1 board, full menu when ≥2.

---

## Verification

The project has **no unit-test target** (verified: no XCTest target in `ios/MoonBoardLED.xcodeproj`), so verification is build + manual behavior, matching how recent changes in this area were verified:

1. **Build (no signing):**
   ```
   xcodebuild -project ios/MoonBoardLED.xcodeproj -scheme MoonBoardLED \
     -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO
   ```
   Expect `** BUILD SUCCEEDED **`.
2. **Manual, on a simulator with ≥2 boards added:**
   - On **Search**, tap the switcher → pick another board → the catalog rebuilds for that board and you stay on the Search tab (no jump).
   - On **Lists**, tap the switcher → pick another board → "Your lists" and the Favorites card count swap to that board, still on Lists.
   - "Manage boards…" switches to the Home tab.
   - On **Home**, tapping a board still activates-and-jumps to Search (unchanged).
   - Board order after a switch reflects MRU promotion consistently across Home/Search/Lists.
