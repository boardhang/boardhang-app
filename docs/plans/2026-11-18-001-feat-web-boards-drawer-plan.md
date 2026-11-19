---
title: Web Boards Drawer - Plan
type: feat
date: 2026-11-18
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Web Boards Drawer - Plan

## Goal Capsule

- **Objective:** Replace the web app's Boards tab with a boards drawer opened from the board name in the header, and replace the settings drawer and plain add list with full-page add and edit screens. Only boards the user sets up on their own device are covered; gym boards come in later phases.
- **Authority:** The approved mockup and the Product Contract below win over today's behaviour. Where the contract is silent, today's behaviour in `web/src/shell/MyBoards.tsx` is kept.
- **Hard limits:** No database change, no `supabase/migrations/**`, no BLE or board-geometry change, no change to the `localStorage` keys or their value formats in `web/src/board/boardStore.ts`. iOS is out of scope.
- **Tier:** Standard (`AGENTS.md`): plan, work in a worktree, review, PR. Docs updated in the same PR.
- **Stop and ask when:** a requirement can only be met by changing stored board state, or by changing session behaviour beyond where its rows are shown.
- **Tail:** the implementer opens the PR. Merging to `main` deploys to production, so the PR is the last gate.

---

## Product Contract

### Summary

The board name in the header becomes the one place to switch, add and manage boards. Tapping it slides a drawer up from the bottom of any screen. The drawer shows each board as a small picture tile, an add tile, a "Scan a QR code" row, and any session to resume. The Boards tab leaves the bottom bar, and the app's landing screen is the active board's catalog. Adding a board is a two-step full-page flow, and editing a board is a full page where each change applies at once.

### Problem Frame

This is phase 1 of the "gyms, shared boards and the live wall" effort (GitHub map issue 197). Later phases add gym boards, a live board and a gym finder, and all of them need a boards surface that can hold more than a short list of rows. Today's Boards screen is a tab that is rarely used after setup, its settings live in a cramped drawer, and nothing in the header says which board is active. The Home redesign that follows this phase also needs a free tab slot.

### Requirements

**Header and drawer**

- R1. Every screen shows the active board's full name at the top left with an up-and-down chevron, when at least one board is added. This includes the add and edit pages, where it still names the active board even when another board is being edited. A long name truncates with an ellipsis; the chevron and the account button never shrink.
- R2. Tapping the board name opens a drawer from the bottom of the screen. The drawer scrolls when its content is taller than about three quarters of the screen.
- R3. The drawer lists added boards as picture tiles, three per row, each with the board's picture (showing its active hold sets), its short name and its angle.
- R4. The active board's tile is outlined and shows "Browse" with an arrow.
- R5. Tapping an inactive tile makes that board active and keeps the drawer open. Tile order does not change while the drawer is open. This works during an active session exactly as "Set as active" does today; the session is not touched.
- R6. Tapping the active tile closes the drawer and shows that board's catalog.
- R7. Each tile has a pencil button in its top-right corner that opens that board's edit page.
- R8. An inactive tile shows a dot in its top-left corner when that board has unseen new benchmarks.
- R9. The last tile is a dashed "Add a board" tile that opens the add flow. It is hidden when every board in the registry is already added.
- R10. Removed by the owner on 2026-11-19: the drawer has no "Scan a QR code" row. Joining a session stays on the catalog's `+` button and on the first-run page (R15). Later mentions of the drawer's scan row in this plan no longer apply.
- R11. Above the tiles the drawer shows a "Resume session" section when there are sessions to resume, and the notice "That session has ended." under the same conditions as today.

**Bottom bar and landing**

- R12. The bottom bar has no Boards tab. On non-catalog screens it shows Logbook, Lists, Settings and Search.
- R13. On the catalog the bottom bar shows one tab beside the search field: the last of Logbook, Lists and Settings visited, and Logbook until one has been. (Changed by the owner on the preview build, 2026-11-18; the plan first put all three tabs there.)
- R14. With at least one board, opening the app lands on the active board's catalog.
- R15. With no boards, the app lands on a full page with one card: "Add your first board", a line of explanation, and one filled "Add a board" button, with the "Scan a QR code" row below. The header shows no board name and no add button on this page.

**Adding a board**

- R16. Step 1, "Which board?", shows every board in the registry as a picture tile, two per row, with a progress indicator reading "1 of 2" ("2 of 2" on step 2).
- R17. A board that is already added says "You have this one" in step 1, and tapping it opens its edit page.
- R18. Step 2, "How is it set up?", shows the board's picture, an angle choice when the board has more than one angle, and its hold sets as toggles. The picture follows the chosen hold sets. At least one hold set stays selected.
- R19. Step 2 has a bar docked above the bottom bar with the board's name, a summary line (angle and "all hold sets" or "N of M hold sets"), and one filled "Add board" button.
- R20. Nothing is saved until "Add board" is pressed. Pressing it adds the board with the chosen angle and hold sets, makes it active, and shows its catalog. Going back from step 2 returns to step 1 and discards the choices.

**Editing and removing a board**

- R21. The edit page has a back arrow and the title "Edit {board name}" on one line, then the picture, angle choice and hold-set toggles, as in step 2.
- R22. Each change on the edit page applies at once and survives leaving the page by any route, including browser Back onto a catalog. There is no Save button and no docked bar.
- R23. Below the hold sets, under a divider, is an outlined "Remove board" button with a bin icon.
- R24. Tapping "Remove board" replaces the button with a sentence, a "Cancel" button and a red "Remove board" button. The sentence says the logbook and lists are kept. When the active session is on that board, the sentence instead says that removing the board takes the user out of the session.
- R25. Confirming removes the board, leaves the edit page, and exits any session on that board with the same toasts as today.

### Acceptance Examples

- AE1. **Covers R5, R6.** Given MoonBoard 2024 is active and Mini MoonBoard 2025 is added, when the user opens the drawer on the Logbook screen and taps the Mini tile, then the Mini tile is outlined and shows "Browse", the header reads "Mini MoonBoard 2025", the drawer is still open, the tiles have not moved, and the user is still on the Logbook.
- AE2. **Covers R5.** Given the same boards, when the user opens the drawer on the MoonBoard 2024 catalog and taps the Mini tile, then the catalog behind the drawer changes to the Mini board's catalog.
- AE3. **Covers R17.** Given MoonBoard 2024 is added, when the user taps it in "Which board?", then the edit page for MoonBoard 2024 opens and no second copy is added.
- AE4. **Covers R20.** Given the user is on step 2 for MoonBoard Masters 2019 with 25° chosen, when they press the back arrow and reopen the drawer, then MoonBoard Masters 2019 is not among the tiles.
- AE5. **Covers R25, R14, R15.** Given one board is added, when the user removes it, then the app shows the "Add your first board" page.
- AE6. **Covers R9.** Given all six registry boards are added, when the user opens the drawer, then there is no add tile.
- AE7. **Covers R22.** Given the user is on the MoonBoard 2024 catalog at 40°, when they open the drawer, tap that board's pencil, choose 25° and press browser Back, then the catalog shows 25° problems and the board's stored angle is 25°.

### Scope Boundaries

- Gym boards, home walls, sharing by link, the map and the gym finder are later phases.
- No Home tab. The freed tab slot is left empty in this phase.
- No change to how boards, angles or hold sets are stored, and no change to sessions other than where the resume rows and ended notice are shown.
- The catalog's own "Add this board" preview for an un-added board, and the Lists "add the board back" card, keep working as they do today.
- Wide-screen (desktop) presentation of the drawer is not designed in this phase.

### Sources

- Decision record: GitHub map issue 197 and the resolution of its phase-order ticket (issue 211). The drawer replaced the earlier "boards page plus header switcher" structure in the phase-1 design step; see the 2026-11-18 comment on issue 197.
- Mockup: local branch `prototype/gym-finder`, route `/prototype/gyms?variant=C&phase=1`, code in `web/src/shell/prototype/VariantC.tsx` and `web/src/shell/prototype/GymFinderPrototype.tsx`. It is a visual reference for layout, spacing and copy. It is throwaway code built on a fake store and must not be ported.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Add and edit are routes, the drawer is not.** New routes `/boards/add`, `/boards/add/$layoutId` and `/boards/$layoutId/edit` give the full pages working browser Back and deep links. The drawer is shell state in `web/src/shell/AppLayout.tsx` with no route of its own, so it can open over any screen without changing the URL.
- KTD2. **`/boards` stays as the first-run page only.** With no boards it renders the "Add your first board" page. With boards it redirects to `/`, which already redirects to the active board's catalog. Existing callers that navigate to `/boards` as a fallback (`web/src/sessions/sessionNav.ts`, `web/src/sessions/JoinSession.tsx`, the catalog route's unknown-board redirect in `web/src/router.tsx`) keep working without edits.
- KTD3. **The store is used as-is.** The drawer and pages call the existing `useBoardStore()` actions (`addBoard`, `removeBoard`, `activateBoard`, `setAngle`, `setActiveHoldSetsRaw`). Step 2 of the add flow holds angle and hold sets in component state and writes them only on "Add board", in the order `addBoard`, `setAngle`, `setActiveHoldSetsRaw`, `activateBoard`. `addBoard` does not make a board active when another is already active, so the explicit `activateBoard` is required for R20.
- KTD4. **The catalog and the active board stay in step, in both directions.** When the active board changes while a catalog route for a different board is showing, the shell replaces the route with the new active board's catalog target. The hook compares against the previous active id, never fires on mount, and does nothing when the routed board already is the new active board, so it leaves `?problem`, `?q` and filters alone when the catalog's own "Add this board" banner or a session resume activates the board on screen. In the other direction, a catalog route for an added board that is not active makes that board active, so the header never names a different board than the catalog shows (browser Back to an older catalog entry, a shared problem link). The un-added-board preview is the one exception: the header keeps naming the active board. On non-catalog routes the shell does nothing. The inactive-tile handler therefore contains no routing; the active tile navigates to its catalog itself (R6).
- KTD5. **Tile order is frozen while the drawer is open.** `activateBoard` promotes the board to the front of the stored order. The drawer snapshots the order when it opens and re-reads it on the next open, the same rule `MyBoards` applies per mount today. See `docs/solutions/architecture-patterns/snapshot-reactive-store-array-when-opening-a-view.md`.
- KTD6. **One setup component, two modes.** The picture, angle toggles and hold-set toggles are one controlled component used by step 2 (draft values, committed on "Add board") and the edit page (store values, each change written at once). The hold-set rules move out of `BoardConfigDrawer` unchanged: toggles via `holdSetContext` and the active-set string, and the last selected set cannot be turned off.
- KTD7. **The tile takes its content as props.** Title, second line, corner action (icon, label, handler), active flag and dot are inputs. Phase 2 feeds gym boards into the same tile with a gym name, a wall name and an info action. No gym concept enters this phase's code.
- KTD8. **The collapsed catalog bar keeps its "origin tab".** The catalog shows one remembered tab beside the search field (R13). With no Boards tab, the origin is one of Logbook, Lists and Settings, and starts as Logbook. (Reversed 2026-11-18: this decision first removed the origin tab and showed all three.)
- KTD9. **The docked "Add board" bar uses the shell's bottom slot.** `web/src/shell/bottomSlot.ts` already gives routes a mount point above the bottom bar. Step 2 portals its bar there so it never scrolls away and never overlaps content.
- KTD10. **`MyBoards` is deleted, not adapted.** Its session-exit-on-remove logic (`handleRemove`) moves to the edit page verbatim, its resume section, scan button and benchmark-dot wiring move to the drawer, and `BoardCard` and `BoardConfigDrawer` are removed.
- KTD11. **An angle set on the edit page beats a stale catalog URL.** The catalog treats `?angle` as the truth and writes it into the store on render (`web/src/catalog/CatalogScreen.tsx`, the `getAngle(board) !== angle` mirror). Going Back from the edit page onto a catalog history entry with the old angle would silently undo the edit. The edit page therefore marks the board as "angle edited" in memory, and the catalog, on finding that mark with a differing URL angle, replaces its URL with the stored angle instead of writing the URL angle into the store, then clears the mark. The mark is module state, not `localStorage`.
- KTD12. **The drawer adds no history entry.** It is dismissed by swipe, backdrop tap or its handlers; browser Back leaves the current screen, as it does for the app's other non-beta sheets. `web/src/beta/useHistoryBackClose.ts` is not used, because the drawer replaces and pushes routes while open, which that hook's marker entry does not survive. Making Back close the drawer is deferred.

### Assumptions

- The drawer uses the existing shadcn `Drawer` in `web/src/components/ui/drawer.tsx` in its default bottom orientation, with a screen-reader title "Boards". Its content sits in an inner container with a max height and `overflow-y-auto`, as the app's other sheets do, because the drawer content element itself clips overflow.
- The drawer closes when the pathname changes to anything other than a catalog route, and through its own handlers for the active tile and a successful resume. The KTD4 catalog-to-catalog replace never closes it. Tapping "Scan a QR code" keeps the drawer open under the scan dialog, because `ScanToJoinButton` renders that dialog itself; the drawer closes when the scan navigates to the join route.
- `useResumableSessions` is called inside the drawer content, which mounts on open, so it fetches per open as the Boards screen did per visit.
- Short tile names ("MB 2024", "Mini MB 2025") come from a small display helper. The registry's full names are unchanged and the header uses them.
- Editing a board does not make it active.
- Step 2 starts from the store's values for that board (`getAngle`, `getActiveHoldSetsRaw`), which are the defaults for a board never added and the remembered setup for a board that was removed earlier.

### Sequencing

U1, then U3, then U2 (step 1 and the step-2 route redirect link to U3's edit route), then U4 (its pencil and add tile link to the routes from U3 and U2), then U5, then U6. The router is typed, so a unit that links to a route from a later unit fails `npm run build`.

---

## Implementation Units

### U1. Shared board tile and board setup components

- **Goal:** The two building blocks every other unit uses: a picture tile and the angle and hold-set controls.
- **Requirements:** R3, R4, R7, R8, R18, R21 (KTD6, KTD7).
- **Dependencies:** none.
- **Files:**
  - `web/src/boards/BoardTile.tsx` (new)
  - `web/src/boards/BoardSetupFields.tsx` (new)
  - `web/src/boards/boardDisplay.ts` (new: short name, setup summary line)
  - `web/src/boards/BoardTile.test.tsx`, `web/src/boards/BoardSetupFields.test.tsx`, `web/src/boards/boardDisplay.test.ts` (new)
- **Approach:** The picture is `CatalogBoard` from `web/src/board/CatalogBoard.tsx` with no holds lit and `visibleHoldSetIds` set from the chosen hold sets, as the mockup's `Art` helper does. `BoardTile` takes a title, an optional second line, the angle, the active flag, the dot flag and one corner action. It renders the main button and a separate corner button so the two tap targets never nest. The corner button's hit area is at least 40 by 40 CSS pixels (padding around the 28-pixel visual circle) and has an accessible name passed in by the caller. The active tile sets `aria-current`. The dot carries visually hidden text "New benchmarks". `BoardSetupFields` is controlled: it receives the board, angle, selected hold sets and change handlers, shows angle toggles only when `hasAngleChoice(board)`, and disables the last selected hold set. Keep `data-testid="new-benchmarks-dot-<layoutId>"` on the dot so existing dot tests can move over.
- **Patterns to follow:** hold-set handling in `BoardConfigDrawer` (`web/src/shell/MyBoards.tsx`), `web/src/board/holdSetMembership.ts`, shadcn `Toggle` and `Button`.
- **Test scenarios:**
  - Tile shows the title, second line and angle it is given; the active tile shows "Browse" and the inactive one does not.
  - Tapping the tile body calls the main handler only; tapping the corner button calls the corner handler only.
  - The dot renders only when the dot flag is set, and exposes the text "New benchmarks".
  - The corner button's accessible name is the label it was given; the active tile has `aria-current`.
  - Setup fields hide the angle group for a single-angle board (Mini MoonBoard 2020) and show it for a two-angle board.
  - Toggling a hold set off and on reports the right selection; with one set left, that toggle is disabled.
  - Summary helper returns "40° · all hold sets" for a full selection and "25° · 3 of 7 hold sets" for a partial one.
- **Verification:** the new tests pass and the components render in isolation with every registry board.

### U2. Add-board flow

- **Goal:** The two full-page steps for adding a board.
- **Requirements:** R16, R17, R18, R19, R20 (KTD1, KTD3, KTD9). Covers AE3, AE4.
- **Dependencies:** U1, U3.
- **Files:**
  - `web/src/boards/AddBoardPick.tsx` (new, step 1)
  - `web/src/boards/AddBoardSetup.tsx` (new, step 2)
  - `web/src/router.tsx` (routes `/boards/add`, `/boards/add/$layoutId`)
  - `web/src/boards/AddBoardPick.test.tsx`, `web/src/boards/AddBoardSetup.test.tsx` (new)
- **Approach:** Step 1 lists `BOARDS` two per row; a tile for an added board navigates to its edit route, any other to step 2. Step 2 starts from the store's values for the board (see Assumptions), portals the docked bar into the bottom slot, and commits per KTD3 before navigating to `catalogNavTarget(board)` with `replace`, so Back from the catalog does not re-enter the finished flow. `/boards/add/$layoutId` redirects to `/boards/add` for an unknown layout id and to the edit route for a board that is already added. The back arrow on step 2 goes to step 1; on step 1 it goes back in history.
- **Patterns to follow:** route definitions and `beforeLoad` redirects in `web/src/router.tsx`; `BottomSlotContext` use in the catalog.
- **Test scenarios:**
  - Step 1 lists all six registry boards and marks added ones "You have this one".
  - Tapping an added board navigates to its edit route; tapping another navigates to step 2.
  - Step 2 pre-selects the default angle and all hold sets for a never-added board, the remembered setup for a previously removed one, and the bar's summary updates as they change.
  - Pressing "Add board" adds the board, stores the chosen angle and hold sets, makes it active even when another board was active, and navigates to its catalog, replacing the step-2 history entry.
  - Leaving step 2 without pressing "Add board" changes nothing in the store.
  - An unknown layout id in the URL redirects to step 1.
- **Verification:** a board can be added end to end in the browser, and the stored keys match what today's flow would have written for the same choices.

### U3. Edit-board page with remove

- **Goal:** The full page that replaces the settings drawer.
- **Requirements:** R21, R22, R23, R24, R25 (KTD1, KTD6, KTD10, KTD11). Covers AE5, AE7.
- **Dependencies:** U1.
- **Files:**
  - `web/src/boards/EditBoard.tsx` (new)
  - `web/src/router.tsx` (route `/boards/$layoutId/edit`)
  - `web/src/catalog/CatalogScreen.tsx` (KTD11: honour the "angle edited" mark)
  - `web/src/boards/EditBoard.test.tsx` (new), plus a catalog test for KTD11 beside the existing catalog tests
- **Approach:** The page reads angle and hold sets from the store and writes each change through `setAngle` and `setActiveHoldSetsRaw`. The remove section has two states, idle and confirming, held in component state. The confirm sentence switches on whether the active session's board is this board. Move `handleRemove` from `MyBoards` unchanged: remove the board first, then run `exitSessionOnBoard` and show its toasts. After removal, navigate to `/` with `replace`, which lands on the next board's catalog or on the first-run page. The route redirects to `/boards/add/$layoutId` when the board is not added. The back arrow goes back in history, or to `/` when the page was opened by deep link. A change of angle sets the KTD11 mark. When the confirm state appears, focus moves to "Cancel"; "Cancel" returns focus to "Remove board"; the confirm state resets when the page remounts.
- **Patterns to follow:** `handleRemove` and `BoardConfigDrawer` in `web/src/shell/MyBoards.tsx`; `docs/collaboration-sessions.md` on exit-on-remove.
- **Test scenarios:**
  - Title reads "Edit {board name}"; there is no Save button.
  - Changing the angle writes the stored angle at once; toggling a hold set writes the stored hold sets at once.
  - "Remove board" shows the confirm state; "Cancel" returns to idle with the board intact.
  - Confirming removes the board and navigates away.
  - With the active session on this board, the confirm sentence is the session warning, and confirming exits the session with the "ended" or "left" toast.
  - A failed session exit still removes the board and shows the failure toast (port the existing `MyBoards` cases).
  - Removing the last board navigates to `/` (which shows the first-run page once U5 lands).
  - Catalog at 40°, open edit, choose 25°, go Back: the stored angle stays 25° and the catalog URL is replaced to 25°.
  - Opening the confirm state moves focus to "Cancel", and "Cancel" returns it to "Remove board".
- **Verification:** the session-exit cases ported from `web/src/shell/MyBoards.test.tsx` pass against the new page.

### U4. Boards drawer and header trigger

- **Goal:** The board name in the header and the drawer it opens.
- **Requirements:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11 (KTD4, KTD5). Covers AE1, AE2, AE6.
- **Dependencies:** U1. The pencil and add tile link to routes from U2 and U3.
- **Files:**
  - `web/src/boards/BoardsDrawer.tsx` (new: trigger button plus drawer)
  - `web/src/boards/useFollowActiveBoard.ts` (new: KTD4)
  - `web/src/shell/AppLayout.tsx` (mount the trigger at the left of the navbar row; call the follow hook)
  - `web/src/boards/BoardsDrawer.test.tsx` (new)
- **Approach:** The navbar row in `AppLayout` changes from right-aligned to space-between, with the trigger on the left and `AccountMenu` on the right. The trigger renders nothing when no board is added. Its accessible name includes the board name, and it exposes `aria-haspopup="dialog"` and its expanded state; focus returns to it when the drawer closes. The drawer content, top to bottom: ended notice, "Resume session" section, "My boards" tiles, "Scan a QR code" row. Resume rows, the ended notice and the scan button reuse `useResumableSessions`, `ResumableSessionRow` and `ScanToJoinButton` with the same conditions `MyBoards` uses. Benchmark dots reuse the `refreshBenchmarkNews`, `unseenCount` and `useBenchmarkNewsVersion` wiring from `MyBoards`. Closing follows the rule in Assumptions. Each pencil is labelled "Edit {board name}".
- **Patterns to follow:** `MyBoards` (`orderRef`, benchmark-news effect, session section); `web/src/components/ui/drawer.tsx`; `ScanToJoinButton` in `web/src/sessions/ScanToJoin.tsx`.
- **Test scenarios:**
  - The header shows the active board's name; with no boards the trigger is absent.
  - Opening the drawer shows one tile per added board plus the add tile.
  - Tapping an inactive tile activates it, keeps the drawer open, and leaves tile order unchanged; reopening the drawer shows the stored order.
  - Tapping the active tile closes the drawer and navigates to its catalog.
  - On a catalog route, activating another board replaces the route with that board's catalog and the drawer stays open; on the Logbook route it does not navigate.
  - A catalog URL for an added, inactive board makes that board active and the header names it.
  - Adding the previewed un-added board from the catalog banner as the first board keeps the URL's search params; resuming a session from the catalog produces one navigation.
  - Tapping an inactive tile during an active session switches the board and leaves the session untouched.
  - Tapping "Scan a QR code" opens the scan dialog with the drawer still mounted.
  - The pencil navigates to the edit route and the add tile to `/boards/add`; both close the drawer.
  - With all registry boards added there is no add tile.
  - The scan row is hidden while a session is active and shown otherwise, including when signed out.
  - Resume rows render when sessions are resumable; the ended notice renders under today's condition; resuming adopts the session and lands on its board (port the existing `MyBoards` cases).
  - The dot shows on an inactive tile with unseen benchmarks and never on the active tile.
- **Verification:** AE1 and AE2 pass by hand in the browser at phone width in dark and light themes.

### U5. Remove the Boards tab and the old screen

- **Goal:** The bottom bar, landing and first-run page match the contract, and the old screen is gone.
- **Requirements:** R12, R13, R14, R15 (KTD2, KTD8, KTD10).
- **Dependencies:** U2, U3, U4.
- **Files:**
  - `web/src/shell/Navigation.tsx`, `web/src/shell/Navigation.test.tsx`
  - `web/src/shell/AppLayout.tsx` (drop `origin`, the `'boards'` nav target and view)
  - `web/src/boards/FirstBoard.tsx` (new), `web/src/boards/FirstBoard.test.tsx` (new)
  - `web/src/router.tsx` (`/boards` renders `FirstBoard` or redirects to `/`)
  - `web/src/logbook/LogbookScreen.tsx` and `web/src/logbook/LogbookScreen.test.tsx` (its "Add a board" button goes to `/boards/add`)
  - `web/src/router.test.tsx` (the unknown-board and no-boards cases assert the new landing)
  - `web/src/shell/MyBoards.tsx`, `web/src/shell/MyBoards.test.tsx` (delete)
- **Approach:** Remove `BoardsTab` and the `'boards'` member of `NavView`. `AppLayout` uses `'boards'` today as the catch-all view for every route that is not catalog, logbook, lists or settings, so `NavView` gains a neutral value on which no tab is highlighted, used for `/boards`, the three new `/boards/*` routes, `/session/join/$token` and `/logbook/import`. The catalog branch of `Navigation` renders the three tabs and the search field. Measure the search field at a 360px viewport: if it is narrower than 150px, stop and ask before changing the bar's design. Search for remaining references to `MyBoards`, `onActivated` and the `'boards'` view before deleting.
- **Test scenarios:**
  - Non-catalog screens show Logbook, Lists, Settings and Search and no Boards tab.
  - The catalog shows Logbook, Lists, Settings and the search field.
  - Search stays disabled when no board is added.
  - `/boards` with no boards shows the first-run card with one "Add a board" button and the scan row; with boards it redirects to the active catalog.
  - `/` with boards lands on the active catalog; with none it lands on `/boards`.
  - The first-run "Add a board" button navigates to `/boards/add`.
- **Verification:** `rg "MyBoards|BoardsTab" web/src` returns nothing, and a fresh browser profile lands on the first-run page.

### U6. Docs

- **Goal:** The docs describe the new structure.
- **Requirements:** none directly; `AGENTS.md` doc discipline.
- **Dependencies:** U1 to U5.
- **Files:** `docs/navigation-and-ui-flows.md` (web route tree and the web navigation section), `docs/multi-board-model.md` (the "Web port" section), `docs/collaboration-sessions.md` (every `MyBoards` reference: resume list, scan button, exit-on-remove).
- **Approach:** Describe the current state only. Replace file and component names, add the three new routes, and state the "catalog follows the active board" rule once, in `docs/navigation-and-ui-flows.md`.
- **Test expectation:** none; documentation only.
- **Verification:** `rg "MyBoards" docs --glob '!plans/**' --glob '!solutions/**'` returns nothing.

---

## Verification Contract

| Gate | Command (run in `web/`) | Applies to |
|---|---|---|
| Types and production build | `npm run build` | every unit |
| Lint | `npm run lint` | every unit |
| Unit tests | `npm run test` | U1 to U5 |
| Browser check | `/ce-test-browser` at 390px width, dark and light | U2, U3, U4, U5 |

Do not run Prettier in `web/`. In a fresh worktree, copy `web/.env` from the main checkout before running tests.

The browser check walks: first-run page, add a board, add a second board, switch from the drawer on the Logbook and on the catalog, edit angle and hold sets, remove a board with and without a live session on it, and remove the last board.

## Definition of Done

- Every requirement R1 to R25 is met and AE1 to AE6 pass.
- All gates in the Verification Contract pass.
- A board added, edited or removed through the new screens leaves the same `localStorage` keys and value formats as the old screen did. A profile created before this change opens with its boards, active board, angles and hold sets intact.
- `web/src/shell/MyBoards.tsx`, its test file, `BoardCard`, `BoardConfigDrawer`, `BoardsTab` and the `origin` nav state are removed, with no dead code left from abandoned approaches.
- No file under `web/src/shell/prototype/` is added or imported.
- The three docs in U6 are updated in the same PR.
