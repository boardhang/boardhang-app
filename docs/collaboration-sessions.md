# Collaboration Sessions (web)

A **collaboration session** lets a crew of signed-in climbers filter the catalog against
*each other's* logbooks — "a project none of us has sent", "one Alice can coach me up". It is
an ephemeral, join-by-link grouping scoped to **one board**. Everyone keeps their own device
and catalog view; the session only changes what the *filters* can target. Web PWA only (no
iOS in v1).

Backend: [`supabase/migrations/0007_collaboration_sessions.sql`](../supabase/migrations/0007_collaboration_sessions.sql).
Client: [`web/src/sessions/`](../web/src/sessions/) plus the catalog + shell touch-points below.

## Session model

- **`sessions`** — one row per session: `owner_id`, `name` (≤60 chars), `board_layout_id`,
  `invite_token` (unguessable share secret), `expires_at`, soft-delete `deleted`.
- **`session_members`** — composite PK `(session_id, user_id)`; membership is the unit of
  sharing. Joining consents to sharing your sent/tried status for that board; leaving (row
  delete) revokes it.
- **Liveness** = `deleted = false AND expires_at > now()`. The **server is the authority**;
  the client's `expires_at` check is only a soft hint with a skew margin.

## The privacy boundary (load-bearing)

`ascents` RLS stays **owner-only** (migration 0002) — it is never relaxed. Cross-member
reads go through one minimal-projection `SECURITY DEFINER` RPC that projects **status only**:

- `session_member_ascents(p_session_id)` → rows `{ user_id, source_catalog_id, status }` with
  `status ∈ {sent, attempted}`, board-scoped, gated on caller membership **and** liveness.
  **Never** returns comments, dates, tries, grade votes, or stars. It is a **pure read** —
  it does not bump `expires_at`.
  - It `LEFT JOIN`s members to their ascents so **every member yields ≥1 row**: a member with
    no matching ascents emits a single marker row `(user_id, NULL, NULL)`. The result
    therefore carries the full, **server-consistent member set** in one call — the client
    seeds per-member Set-pairs from it, and a just-departed member is simply absent.
  - `unlogged` is inferred client-side by *absence* of a problem from a member's rows.

Because filtering is client-side, a member can effectively see another member's whole
sent/tried list for the board (not only aggregate matches). This is accepted — it's what
climbing partners tell each other out loud (R9).

## The four RPCs

| RPC | Gate | Purpose |
| --- | --- | --- |
| `join_session_by_token(token)` | token is **live** | The only sanctioned membership INSERT. Seats the caller, bumps `expires_at`, returns the session row **without** `invite_token`. |
| `session_member_ascents(p_session_id)` | member **and** live | The status-only cross-member projection (above). Pure read. |
| `touch_session(p_session_id)` | member **and** live | Bumps `expires_at` for manual refresh + rename. Members can't `UPDATE` `sessions` directly (owner-only), so this is their sanctioned expiry-bump path. |
| `session_invite_token(p_session_id)` | member (**no** liveness check) | Re-fetch the share secret on demand — so the token never enters the client cache/pointer. Membership-only so a still-member can retrieve it even for an ended session; harmless because `join_session_by_token` refuses the ended token. |

RLS: `session_members` has **no member-facing INSERT policy** (joins go only through the RPC);
the creator is seated by an owner-seat trigger. DELETE is self-leave **or** owner-removes-member.

## Expiry & liveness (KTD-6)

`expires_at` is bumped **only on explicit intent** — `create`/`join` inline, and manual
refresh/rename via `touch_session`. The projection RPC never bumps it, and passive foreground
refetches never bump it. That is deliberate: if passive activity kept the clock alive, the 24h
privacy backstop would never fire. Expiry is **per-session** — any member's explicit activity
keeps it alive for everyone; the 24h backstop only fires once *all* members go quiet.

## Client architecture

- **`sessionsStore.ts`** — the active session (lifecycle: create / join / leave /
  removeMember / rename / refresh), the roster, `selfId`, and per-member chip selections
  (`memberStatus`). The active-session pointer and `memberStatus` persist to `localStorage`
  keyed by session id (survive navigation + reload); `invite_token` **never** persists —
  it lives in volatile memory (creator) or is re-fetched via `session_invite_token`.
  `SESSION_COLUMNS` never selects `invite_token`. Identity-switch clear is wired from
  `AuthProvider.onAuthStateChange` (a shared device never inherits another user's session).
- **`memberAscentsStore.ts`** — the projection: per-member `{ sentIds, loggedIds }` Set-pairs,
  seeded from the server-consistent snapshot (marker rows → empty Sets, so a zero-ascent
  member is never dropped from the AND-across predicate). Refetched on active-session change,
  on foreground (`visibilitychange`), and on manual refresh. A **max-age** (5 min) drops the
  cached map — enforced by both a timer and an on-read age check — bounding a departed
  member's residual exposure.
- **`filters.ts`** (`matchesSessionStatus`) — the predicate: **OR within a member's row, AND
  across member rows, empty row = ignore**. When a session is active it replaces the
  single-user status clause (self is member row #1), gated on the projection's single atomic
  readiness flag so the list is never blanked mid-load.
- **UI** — `catalog/MemberStatusRow.tsx` + `FilterControls` (per-member rows in the Filters
  sheet), `catalog/useMemberSenders.ts` (the **sends pill**: in a session, a row with ≥1 sender
  gains a third row — a neutral pill with a green "sent" check + an `AvatarGroup` of the crew
  who sent it, **self included** and first, capped at 3 + `+K`. The name-line self-check is
  suppressed in a session since the pill is the sole home for send status; solo browsing is
  unchanged. Dimmed when the projection is paused/stale so it never shows crisp "who" the filter
  itself no longer trusts), `catalog/SessionBar.tsx`
  (in-context bar: rename, members, refresh, Share, Leave;
  a single **Session** button when solo), `sessions/ShareSession.tsx` (QR +
  copy/share of the join link), `shell/SessionPill.tsx` (global pill on every non-catalog route,
  with roster + owner remove-member + Leave), `sessions/JoinSession.tsx` (`/session/join/$token`
  — sign-in → consent → join → land in the board catalog).
- **`sessions/joinUrl.ts`** — `buildJoinUrl` / `parseJoinUrl`, the single owner of the join-URL
  shape so the QR writer and the scan/paste readers can't drift. `parseJoinUrl` matches
  `/session/join/:token` on **any** origin (prod/preview/localhost QRs interop) and only ever
  yields the token — the scanned origin is never navigated to.

## Starting or joining: the scanner-first launcher

`sessions/ScanToJoin.tsx` is a centered **`Dialog`** that opens straight to the camera: a joiner
doesn't need their phone's camera app — a friend's session QR in frame **auto-joins**. It's a thin
**decode → parse → navigate** layer: it lifts the token via `parseJoinUrl` and navigates to the
existing `/session/join/$token` route, which still owns consent and the join RPC unchanged.

- **Scanner-first, host demoted.** The catalog's single "Session" button opens the launcher
  on the camera (joining is the time-sensitive at-the-wall act); "Start your own session" sits
  below an "or" divider as the host path. `ScanToJoin` takes an optional `onStart`/`starting`/
  `canStart` — the boards overview (`shell/MyBoards.tsx`, via `ScanToJoinButton`) omits it and is
  camera-only, since there's no board context to host in. Joining works signed-out (`JoinSession`
  owns sign-in); only hosting needs an account. Tradeoff: opening the dialog prompts for camera
  permission even for a would-be host — mitigated by the always-visible Start button and the paste
  fallback.
- **`sessions/qrDecoder.ts`** is the dynamic-import boundary: the `@yudiel/react-qr-scanner`
  wrapper and the ~433 kB `zxing-wasm` reader load only when the dialog opens (the app's first
  code-split). iOS Safari still ships `BarcodeDetector` disabled, so a WASM decoder is mandatory.
- The reader WASM is **self-hosted** (bundled via Vite `?url`, never fetched from jsDelivr) and
  **excluded from the SW precache** (`globIgnores` + a CacheFirst runtime route in
  `vite.config.ts`) — it would bloat every install, and scanning needs the network anyway.
- WASM prep is a **retryable** runtime step (`ensureDecoder`), not a top-level await: a failed
  offline fetch clears its memo so a later retry recovers, rather than leaving the module record
  permanently errored. Any load failure routes to the paste-link fallback, which reuses the same
  `parseJoinUrl` — so a camera-less or offline joiner is never stuck.
- The visible body branches on `phase` (scanning / fallback), and only the live camera mount is
  gated on the dialog being open — so closing tears the stream down without flashing the fallback
  card during the close animation. Rear camera (`facingMode: 'environment'`); re-acquired on
  foreground (iOS standalone PWAs freeze the stream when backgrounded).

## Security posture (read before changing)

- **`invite_token` is a bearer capability.** Anyone holding the link/QR can join. v1 revokes
  only by **ending the session** (`deleted = true`, which makes both live-gated RPCs refuse)
  or the **owner removing a member**. Token **rotation** (invalidating a leaked link while
  keeping the session) is a deferred follow-up — removing a member does **not** stop them
  rejoining with the same link.
- **Expiry only bumps on explicit intent**, so an active crew must Leave/end to stop sharing;
  the 24h backstop fires only once everyone stops acting.
- **A departed member's residual exposure on peers is bounded** by the projection max-age
  (peers hold a last-good map until their next pull or the max-age drop).

## v1 / v2 boundary

**v1 (this):** on-demand pull (open / foreground / manual refresh); static roster;
board-scoped; status-only projection.

**Deferred to v2:** realtime cross-member updates and online-now presence; shared "crew
projects" list; friend graph / standing groups; multi-board sessions; iOS; member avatars;
a scheduled hard-delete sweep of expired sessions (v1 makes them inert via the RPC guards);
`invite_token` rotation.
