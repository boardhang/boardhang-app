---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: grill-me
execution: code
date: 2026-07-04
---

# Saved Lists — Plan (local-first, off `main`)

**Companion ideation:** [`docs/ideation/2026-07-04-saved-lists-ideation.html`](../ideation/2026-07-04-saved-lists-ideation.html).
**Base branch:** `main` (fresh `feat/saved-lists` — **not** built on the collaborative-lists PR #10).

> **One open decision — storage.** This plan is written around **local-first SwiftData**
> (recommended). It was chosen while the user was away; it reverses an earlier "cloud" pick
> that assumed we'd stay on PR #10's branch. Off `main` that assumption no longer holds, so
> local-first is the clean fit. **Confirm before P1a lands.** Alternatives, in order of
> preference: (2) extract #10's cloud backend onto this branch; (3) rebuild cloud fresh.
> Only the storage layer changes if this flips — the UI/UX plan is largely the same.

---

## Summary

Build **Saved Lists**: a simple, personal, **local-first** way to save catalog problems
into named lists (projects, ticklists, warmups) plus a **Favorites** view. It's a brand-new
feature on `main` — the app currently has **no Lists tab** there — deliberately **decoupled
from PR #10**'s cloud/collaborative machinery. Collaboration (sharing, group status) becomes
a later cloud-sync layer, mirroring how the logbook is local-first with a sync spine on top.

Ships as **small PRs off `main`**.

---

## Problem Frame

There's no way to save a catalog problem into a personal collection. PR #10 explored this
collaborative-first — every list a membership-scoped cloud object — which put auth,
membership, and RLS in front of the simplest act: *save a problem to a list*. Saved Lists
inverts that: the personal, offline, single-user object is the foundation; multiplayer is a
later enhancement of it.

**Primary actor:** a solo climber curating problems.
**Core outcome:** save a problem into a named list (and see Favorites) in a couple of taps —
no sign-in, no network, works offline like the logbook and favorites already do.

---

## Product Contract

- **R1** Create, rename, and delete Saved Lists from a new Lists tab.
- **R2** Add a catalog problem to a list; remove it; open a list to see its problems.
- **R3** A **Favorites** entry: a live, board-filtered view of favorited problems
  (multi-select board pills), auto-populated by the existing catalog heart button.
- **R4** Fully local and offline — no auth, no Supabase, no dependency on PR #10.
- **KTD1** Storage: local **SwiftData** models (like `FavoriteProblem`, `Ascent`).
- **KTD2** New top-level **Lists tab** added to `RootTabView` (none exists on `main`).
- **KTD3** Independent PRs off `main`; a small dependency on the foundation PR (P1a) only.

---

## Model & surfaces

- **New:** `SavedList` (`@Model`: `id`, `name`, `boardLayoutId`, `createdAt`, ordered
  `items`) and `SavedListItem` (`@Model`: `catalogID`, `addedAt`, back-ref to list). Register
  in the SwiftData container in `MoonBoardApp.swift` alongside `FavoriteProblem`.
- **New tab:** a "Lists" tab in `ios/MoonBoardLED/Views/RootTabView.swift`.
- **Reuse:** local `FavoriteProblem` (`Models/Ascent.swift`), `ProblemRow`,
  `CatalogProblemRow`, `CatalogProblemPager`, `CatalogIndex` (cross-board resolution). No
  Supabase, no migration.

---

## Phase 1 — Saved Lists (3 PRs)

### P1a — Foundation: model + tab + list index
- `SavedList` / `SavedListItem` SwiftData models; container registration.
- New **Lists tab** in `RootTabView`.
- List index UI: your lists (newest-first), **create / rename / delete** (swipe + menu),
  empty state. Pure local `@Query` + `modelContext` writes.
- **Verify:** create → rename → delete a list; persists across app relaunch.

### P1b — List detail + add/remove problems  *(builds on P1a)*
- List detail: name, board, its problems (resolve `catalogID` → problem via `CatalogIndex`),
  rendered with `CatalogProblemRow`; tap opens `CatalogProblemPager`.
- **Add to list** from the catalog problem view/row; **remove** from the list (swipe).
- **Verify:** add a catalog problem to a list → shows in the list; remove → gone; survives
  relaunch; adding a dup is a no-op.

### P1c — Favorites  *(builds on P1a's tab; otherwise independent)*
- `FavoritesView`: live `@Query` of `FavoriteProblem`, resolved across boards via
  `CatalogIndex`, **board-filtered with a multi-select pill row** styled like the catalog's
  filter chips (default = active board; clearing pills = all boards). Taps open the pager.
- `Board.shortName` / `MoonBoardSetup.shortName` for compact pill labels ("Mini 2025",
  "MoonBoard 2019").
- A pinned **Favorites** card at the top of the Lists tab.
- **Verify:** heart a catalog problem → Favorites updates live; pills switch/stack boards;
  unheart removes it.

---

## Later — Collaboration (separate future plan)

Once Saved Lists feels right, add sharing as a **cloud-sync layer** (the logbook's
local-first + sync-spine pattern), reusing or adapting PR #10's Supabase schema:
Personal/Collaborative distinction, member roster + avatars, invite/share, one-way
promotion, and per-member group status. Specced separately when we get there.

---

## Scope Boundaries

- **Dependency:** P1b and P1c build on P1a (the tab + model). After P1a lands, P1b and P1c
  are independent siblings.
- **Not in scope:** anything cloud/collaborative — members, sharing, sections, group status,
  auth. No Supabase, no migration.
- **Relationship to PR #10:** intentionally independent. If Saved Lists becomes the direction,
  #10's collaborative work is either superseded or folded into the later collaboration layer.

---

## Verification Contract

- `xcodebuild -project ios/MoonBoardLED.xcodeproj -scheme MoonBoardLED -destination
  'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO` —
  green per PR.
- Manual on device/simulator: run each PR's **Verify** bullet; confirm persistence across a
  relaunch (local storage, so no account needed).

---

## Definition of Done (Phase 1)

- A user can create/rename/delete Saved Lists, add/remove catalog problems, and use a
  board-filtered Favorites view — entirely offline, no sign-in — as a new Lists tab on `main`.
