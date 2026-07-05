---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: grill-me
execution: code
date: 2026-07-04
---

# Saved Lists — Plan (cloud, off `main`)

**Companion ideation:** [`docs/ideation/2026-07-04-saved-lists-ideation.html`](../ideation/2026-07-04-saved-lists-ideation.html).
**Base branch:** `main` (fresh `feat/saved-lists`).
**Storage:** **cloud** — extract PR #10's lists backend onto this branch (decided).

---

## Summary

Build **Saved Lists**: a personal way to save catalog problems into named lists (projects,
ticklists, warmups) plus a **Favorites** view. It's a new feature on `main` — which has no
Lists tab today — built by **extracting the cloud backend from PR #10** (migration `0003`,
`ListsManager`, `ListsDTO`) rather than building on #10's branch. A personal list is simply a
cloud list with one member (you), seated by the existing owner trigger. Collaboration
(sharing, members, group status) is a later layer that adds the deferred migrations and
un-hides the sharing UI.

Ships as **small PRs off `main`**.

---

## Problem Frame

There's no way to save a catalog problem into a personal collection. PR #10 built this
collaborative-first — every list a membership-scoped cloud object — and bundled it with
sharing, group status, and a group-lens catalog. Saved Lists keeps #10's **backend** (it's
sound) but re-sequences the **product**: ship the personal cloud list first, defer everything
multiplayer.

**Primary actor:** a signed-in solo climber curating problems.
**Core outcome:** save a problem into a named cloud list (and see Favorites) in a couple of
taps; lists sync across the user's devices via the account they already use for the logbook.

---

## Product Contract

- **R1** Create, rename, and delete Saved Lists from a new Lists tab.
- **R2** Add a catalog problem to a list; remove it; open a list to see its problems.
- **R3** A **Favorites** entry: a live, board-filtered view of favorited problems
  (multi-select board pills), auto-populated by the existing catalog heart button.
- **R4** No sharing / members / sections / group status in this phase.
- **KTD1** Storage: **cloud (Supabase)**, extracting #10's `lists` / `list_problems` backend.
  Reuse `main`'s existing auth + Supabase foundation (merged cloud-logbook PR #8).
- **KTD2** New top-level **Lists tab** in `RootTabView`; `ListsManager` injected app-wide.
- **KTD3** Lists require sign-in (like the cloud logbook); the tab shows a sign-in prompt when
  signed out. **Favorites is local and needs no auth.**

---

## What to extract from #10 (and what to leave)

**Bring:**
- `supabase/migrations/0003_collaborative_lists.sql` — `lists`, `list_members`,
  `list_problems`, RLS, the `is_list_member` helper, and the owner-seat trigger (which makes a
  new list immediately a valid one-member "personal" list). Depends only on `0001`/`0002`,
  already on `main`.
- `ios/.../Services/Supabase/ListsManager.swift` and `ListsDTO.swift` — the cloud CRUD.
  `ListsManager`'s personal methods (`loadMyLists`, `createList`, `deleteList`, `loadDetail`,
  `reloadPile`, `addProblem`, `removeProblem`) are what Phase 1 wires up.

**Leave for the collaboration layer:**
- `0004_list_rpcs.sql` (join + group-status RPCs) and `0005_list_invite_preview.sql`.
- `ListsManager`'s sharing methods (`join`, `previewInvite`, `refreshGroupStatus`, …) come
  across but stay **dormant** — no Phase-1 UI calls them, so the un-applied `0004`/`0005` RPCs
  are never hit. `ListInviteLink` and the members/invite/group UI are not surfaced.

**Add:** `ListsManager.renameList(_:name:)` (a one-column update under the existing owner
policy — #10 never needed rename).

Favorites reuse local `FavoriteProblem` (`Models/Ascent.swift`), `ProblemRow`,
`CatalogProblemRow`, `CatalogProblemPager`, and `CatalogIndex`.

---

## Phase 1 — Saved Lists (3 PRs)

### P1a — Foundation: extract backend + Lists tab + index
- Bring migration `0003`, `ListsManager`, `ListsDTO`; register/inject `ListsManager`
  app-wide (mirror `AuthManager`/`LogbookSyncManager` wiring); add `renameList`.
- New **Lists tab** in `RootTabView`; sign-in prompt when signed out.
- List index: your lists (newest-first), **create / rename / delete**, empty state.
- **Verify:** signed in, create → rename → delete a list; persists (reload from cloud);
  signed out shows the prompt. Migration `0003` applied to the Supabase project first.

### P1b — List detail + add/remove problems  *(builds on P1a)*
- List detail: name, board, its problems (`source_catalog_id` → problem via `CatalogIndex`),
  `CatalogProblemRow`; tap opens `CatalogProblemPager`.
- **Add to list** from the catalog (reuse `addProblem`); **remove** from the pile (reuse
  `removeProblem` + `reloadPile`). No members/invite/group UI.
- **Verify:** add a catalog problem → shows in the list; remove → gone; re-add clean (DB
  unique-live index); reflects across a reload.

### P1c — Favorites  *(builds on P1a's tab; otherwise independent)*
- `FavoritesView`: live `@Query` of `FavoriteProblem`, resolved across boards via
  `CatalogIndex`, **board-filtered with a multi-select pill row** styled like the catalog's
  filter chips (default = active board; clearing pills = all boards). Taps open the pager.
- `Board.shortName` / `MoonBoardSetup.shortName` for compact pill labels.
- Pinned **Favorites** card at the top of the Lists tab.
- **Verify:** heart a catalog problem → Favorites updates live; pills switch/stack boards.

---

## Later — Collaboration (separate future plan)

Apply `0004`/`0005`, then un-hide what #10 already built: Personal/Collaborative sections (a
stored `kind`), member roster + avatars, invite/share, one-way promotion, and per-member
group status + the catalog group lens. Most of #10's UI can be revived rather than rewritten.

---

## Scope Boundaries

- **Dependency:** P1b and P1c build on P1a (the backend + tab). After P1a, P1b and P1c are
  independent siblings.
- **Not in scope:** sharing, members, sections, group status, promotion, invite; migrations
  `0004`/`0005`.
- **Relationship to PR #10:** #10 is superseded as the delivery vehicle — its backend is
  extracted here; its collaborative UI is revived in the later layer. #10 can be closed.

---

## Verification Contract

- Apply migration `0003` to the Supabase project (SQL Editor / `supabase db push`) before P1a.
- `xcodebuild -project ios/MoonBoardLED.xcodeproj -scheme MoonBoardLED -destination
  'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO` —
  green per PR.
- Manual, signed in on device/simulator: run each PR's **Verify** bullet; confirm lists
  survive a relaunch (cloud) and Favorites works signed-out (local).

---

## Definition of Done (Phase 1)

- A signed-in user can create/rename/delete cloud Saved Lists, add/remove catalog problems,
  and use a board-filtered Favorites view — as a new Lists tab on `main` — with no
  collaborative UI on screen and the sharing backend deferred.
