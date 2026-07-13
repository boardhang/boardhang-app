---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
date: 2026-07-13
status: implementation-ready — authored by ce-plan 2026-07-13; design revised via a second grill-me (avatar-group → sends pill)
---

# Catalog "who sent it" sends pill (Collab Sessions) - Plan

> **Product Contract preservation:** New feature, no upstream brainstorm. Product decisions were
> resolved in two `grill-me` design-tree interviews on 2026-07-13: the first landed a name-line
> avatar group; the second (after seeing it live) **replaced** that with a dedicated third-row
> "sends pill." This plan reflects the **final** pill design (P1–P6). Tier: **Routine** (web UI
> only, no migration, no schema, no BLE/geometry).

## Goal Capsule

- **Objective:** When browsing the catalog inside an active **Collab Session**, show on each
  problem row which crew members have sent it — so a crew can see at a glance who's already done
  a climb, not just filter the list down to it.
- **Product authority:** the user (pbs), resolved 2026-07-13.
- **Surface:** the **already-shipped** Collab Sessions catalog
  (`docs/plans/2026-07-07-002-feat-web-collab-sessions-plan.md`, `docs/collaboration-sessions.md`).
  This is **not** the collaborative-lists plan
  (`docs/plans/2026-07-09-001-feat-web-collaborative-lists-plan.md`), which gets its own
  per-member chips in list detail (R4). Both share the `MemberAvatar` visual language.
- **Open blockers:** none. The data is already client-side — no RPC, migration, or schema change.
  `CatalogScreen` already holds `memberAsc.bySets` (per-member `sentIds`) and the session roster
  right where it builds the list transform (`web/src/catalog/CatalogScreen.tsx:113-219`).

## Context — what already exists

- **Row:** `web/src/catalog/CatalogRow.tsx` — one `<button>` (name + benchmark/sent/favorite badges
  on line 1, `ProblemMeta` line below, trailing grade pill). It renders a green self **`CheckCircle2`**
  when `isSent` (self's own send) — a **session-independent, shipped** signal for any signed-in user.
- **List:** `web/src/catalog/CatalogList.tsx` — pass-through to each `CatalogRow`.
- **Screen:** `web/src/catalog/CatalogScreen.tsx` — owns the session read (`useSessions()`,
  `useMemberAscents()`). `memberAsc.bySets` is `Record<userId, { sentIds, loggedIds }>`, roster-seeded;
  `memberAsc.members` is the server-consistent snapshot; `ready | stale | error` drives readiness.
- **Avatars:** `web/src/sessions/MemberAvatar.tsx` wraps the shadcn `Avatar` (photo when `avatarUrl`,
  else `memberInitials`, self-ring via `isSelf`, native `title`). `AvatarGroup` + `AvatarGroupCount`
  are exported from `web/src/components/ui/avatar.tsx`.
- **State-derivation precedent:** `web/src/catalog/useSessionFilterRows.ts:77-81` maps `memberAsc` →
  `'loading' | 'ready' | 'paused'` and orders self-first via `selfId`. Mirror it.

## Planning Contract (resolved design decisions — pill design)

- **P1 — Session-only third row.** Browsing **solo** is unchanged: your send = the green check on
  the name line, two-line row, no pill. In an **active session**, a **third row** appears **only** on
  rows with ≥1 sender, carrying the sends pill.
- **P2 — Pill = one "sent by crew" unit.** A subtle **neutral** (`bg-secondary`) rounded pill: a small
  green `CheckCircle2` as a "sent" label, then an `AvatarGroup`. The only green is the check; avatars
  keep their own colors.
- **P3 — Self is *in* the pill; name-line check suppressed in a session.** When a session is active the
  name-line `isSent` check is **hidden**; your send shows as your own **ringed** avatar
  (`MemberAvatar isSelf`, labeled "You"), sorted **first**, then other senders in roster order.
- **P4 — Cap 3 + `+K`** (self counts as one of the 3), via `AvatarGroupCount`.
- **P5 — Dim on stale.** The pill dims (`opacity-50`) when the projection is `paused`/stale/offline,
  so it never shows crisp "who" the filter itself no longer trusts.
- **P6 — Accessibility.** The row is one big button → **no nested interactive elements**: native
  `title` per avatar + an `aria-label` on the pill ("Sent by You, B, +2").
- **Sent only** — no "tried"/attempts.
- **Avatar sizing.** The pill uses an **18px `xxs`** avatar. `xs` (20px) and `xxs` (18px) are added to
  `avatar.tsx` as real size presets (not per-use overrides); `MemberAvatar` forwards a `size` prop
  (default `sm`). The initials fallback is composited over an opaque `bg-background` base so overlapping
  avatars are never see-through.

## Non-goals (this phase)

- The **collaborative-lists** list-detail chips (owned by that separate plan, R4).
- Surfacing **tries/attempts** (sent only).
- Any **backend** change — no new RPC, migration, or projection field.
- **iOS** parity — web-only, mirrors Sessions' web-only scope.
- Making the pill/avatars **interactive** (tap-for-names) — incompatible with the one-button row (P6).

## High-Level Technical Design

```
CatalogScreen (owns session reads)
  memberAsc.bySets ─┐
  roster, selfId   ─┼─► useMemberSenders(board) ─► senders: Map<catalogId, SenderChip[]>  (self INCLUDED, self first)
  memberAsc.ready/ ─┘                               state: 'loading'|'ready'|'paused'
   stale/error
        │  props: senders={map}, sendersDimmed={state==='paused'}
        ▼
   CatalogList  (sessionActive = senders !== undefined)
        │  per row: senders={map.get(id)}, sendersDimmed, sessionActive
        ▼
   CatalogRow
     name line: self-check shown only when !sessionActive          ← P3
     third row (when senders?.length): sends pill                  ← P1/P2
       <div bg-secondary rounded-full aria-label="Sent by …">
         <CheckCircle2 text-success />                             ← P2
         <AvatarGroup>  MemberAvatar size="xxs" isSelf … ×≤3  + AvatarGroupCount +K  ← P4
```

## Implementation Units

### U1 — Per-problem sender projection (self included, self first)
**Files:** `web/src/catalog/useMemberSenders.ts`, `web/src/catalog/useMemberSenders.test.ts`,
`web/src/catalog/CatalogScreen.tsx`

- `SenderChip = { userId, isSelf, label, initials, avatarUrl }`.
- `useMemberSenders(board)` mirrors `useSessionFilterRows`' store reads; returns
  `{ senders: Map<string, SenderChip[]>, state } | undefined` (undefined when no session on this board).
- Pure `buildSenders(members, selfId, bySets, roster)`: iterate members **self-first**, **include self**
  (marked `isSelf`, labeled "You"), fold each member's `sentIds` into the per-problem map; roster supplies
  label/initials/avatar with a synthetic fallback (never blank).
- `state` = `ready ? 'ready' : stale||error ? 'paused' : 'loading'`.
- `CatalogScreen`: call the hook; pass `senders={memberSenders?.senders}` and
  `sendersDimmed={memberSenders?.state === 'paused'}` to the primary `<CatalogList>` (loading ⇒ empty map ⇒ no pills).

**Tests:** self included + first + flagged; self-alone pill; other-members ordering after self; zero-ascent skip;
missing-roster deterministic initials; multi-send fan-out; empty map when nobody sent; roster label/avatar used.

### U2 — Sends pill on the row (+ suppress name-line check in a session)
**Files:** `web/src/catalog/CatalogRow.tsx`, `web/src/catalog/CatalogRow.test.tsx`

- Props `sessionActive?`, `senders?: SenderChip[]`, `sendersDimmed?`.
- Name-line check gated `isSent && !sessionActive` (P3).
- Third row after `ProblemMeta` when `senders?.length`: a `bg-secondary` rounded pill (`py-1` so the 18px
  avatars are contained) with `aria-label` (P6) = `CheckCircle2 text-success` + `AvatarGroup` of
  `MemberAvatar size="xxs" isSelf` (cap 3) + `AvatarGroupCount` `+K`. Dim via `opacity-50` when `sendersDimmed`.

**Tests:** solo shows name-line check; session suppresses it (send moves to pill); one-avatar pill + aria-label +
green check; cap 3 + `+2`; no pill when empty/absent; dim toggles; native `title` per avatar; row stays a single button.

### U3 — Thread senders through `CatalogList`
**Files:** `web/src/catalog/CatalogList.tsx`, `web/src/catalog/CatalogList.test.tsx`

- Props `senders?: Map<string, SenderChip[]>`, `sendersDimmed?`. Derive `sessionActive = senders !== undefined`.
- Forward `senders={senders?.get(id)}`, `sendersDimmed`, `sessionActive` to each `CatalogRow`.

**Tests:** matched row gets its chips (unmatched none); `sendersDimmed` propagates; name-line self-check suppressed
when a session is active (empty senders map + `sentIds`).

### U4 — Avatar sizing primitives (`xs`/`xxs`) + opaque fallback
**Files:** `web/src/components/ui/avatar.tsx`, `web/src/sessions/MemberAvatar.tsx`

- `avatar.tsx`: add `xs` (`size-5`, 20px) and `xxs` (`size-4.5`, 18px) to the `Avatar` size union + `data-[size=…]`
  classes; scale `AvatarFallback` text and `AvatarGroupCount` size/text for both.
- `MemberAvatar.tsx`: forward a `size` prop (default `sm`); composite the translucent `bg-primary/15` fallback over
  an opaque `bg-background` base so overlapping avatars are never see-through. Existing callers (roster, SessionBar,
  SessionPill) are untouched (default `sm`, identical composite on near-black surfaces).

## Verification Contract

- `npm run build` (`tsc -b` + `vite build`) green — the canonical typecheck. Verify with `oxlint`; **no Prettier** in `web/`.
- `npm test` green (new + existing `catalog/*` and session tests).
- **Browser (done):** in a live 2-member session on the session's board, a sent problem renders the third-row pill
  `[✓ (You)(B)]`; solo rows keep the name-line check; the pill is contained (no overflow) and avatars are opaque
  (no see-through). Non-session catalog unchanged, no console errors.

## Definition of Done

- P1–P6 honored on the shipped Collab Sessions catalog; solo catalog untouched.
- No backend/migration/schema change; no new npm dependency.
- `tsc -b`, tests, and `oxlint` green; house style (single-quote, no-semi) preserved.
- `docs/collaboration-sessions.md` notes the sends pill in the same change.

## Risks & Mitigations

- **Row height in a session** — a third row only appears on sent rows; solo rows stay two-line. Verified in browser.
- **Stale "who" after someone leaves** — bounded by the existing `memberAscentsStore` max-age drop; `state` → `paused`
  dims the pill (P5); no new exposure path.
- **Global `MemberAvatar` change** — the opaque-base + `size` forwarding are additive; default `sm` keeps every other
  surface identical (verified against the session roster header).

## Sources & Research

- `docs/plans/2026-07-07-002-feat-web-collab-sessions-plan.md`, `docs/collaboration-sessions.md` — the surface.
- `web/src/catalog/useSessionFilterRows.ts`, `web/src/catalog/CatalogScreen.tsx:113-219`,
  `web/src/sessions/memberAscentsStore.ts` — the data + state-derivation precedent this plan mirrors.
- `web/src/sessions/MemberAvatar.tsx`, `web/src/components/ui/avatar.tsx` — the reused/extended avatar primitives.
