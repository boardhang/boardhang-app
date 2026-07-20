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

## The session RPCs

The 0007 core is four RPCs; `list_my_live_sessions` (0016) is a later addition for cross-device
resume (see below).

| RPC | Gate | Purpose |
| --- | --- | --- |
| `join_session_by_token(token)` | token is **live** | The only sanctioned membership INSERT. Seats the caller, bumps `expires_at`, returns the session row **without** `invite_token`. |
| `session_member_ascents(p_session_id)` | member **and** live | The status-only cross-member projection (above). Pure read. |
| `touch_session(p_session_id)` | member **and** live | Bumps `expires_at` for manual refresh + rename. Members can't `UPDATE` `sessions` directly (owner-only), so this is their sanctioned expiry-bump path. |
| `session_invite_token(p_session_id)` | member (**no** liveness check) | Re-fetch the share secret on demand — so the token never enters the client cache/pointer. Membership-only so a still-member can retrieve it even for an ended session; harmless because `join_session_by_token` refuses the ended token. |
| `list_my_live_sessions()` (0016) | caller is a member | Enumerate the caller's **live** sessions (`deleted = false AND expires_at > now()`) for cross-device resume. Returns the `SESSION_COLUMNS` shape **without** `invite_token`. **Pure read** — never bumps `expires_at`, so listing on an idle second device can't revive a dying crew. |

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
  (in-context bar: rename, members, Share, Leave, plus stacked cross-device Resume rows for
  this board above StartBar; a single **`+`** launcher button when solo), `sessions/ShareSession.tsx` (QR +
  copy/share of the join link), `shell/SessionPill.tsx` (global pill on every non-catalog route,
  with roster + owner remove-member + Leave), `sessions/JoinSession.tsx` (`/session/join/$token`
  — sign-in → consent → join → land in the board catalog).
- **`sessions/joinUrl.ts`** — `buildJoinUrl` / `parseJoinUrl`, the single owner of the join-URL
  shape so the QR writer and the scan/paste readers can't drift. `parseJoinUrl` matches
  `/session/join/:token` on **any** origin (prod/preview/localhost QRs interop) and only ever
  yields the token — the scanned origin is never navigated to.

## Starting or joining: the session launcher

`sessions/ScanToJoin.tsx` is a centered **`Dialog`** titled "Session with friends" that opens on a
**chooser**: scan a friend's QR, paste their link, or start your own. A joiner doesn't need their
phone's camera app. It's a thin **decode → parse → navigate** layer: it lifts the token via
`parseJoinUrl` and navigates to the existing `/session/join/$token` route, which still owns consent
and the join RPC unchanged.

- **Chooser-first, camera on demand.** The camera starts only when the user taps "Scan a QR code",
  so merely opening the launcher never triggers the OS camera-permission prompt (an earlier
  scanner-first variant did, for everyone including would-be hosts). Paste is a first-class peer of
  scanning — always visible on the chooser — which also makes it the natural fallback when the
  camera is denied or the decoder can't load offline (scanning drops back to the chooser with a
  "Camera unavailable" note). "Start your own session" sits below an "or" divider. `ScanToJoin`
  takes an optional `onStart`/`starting`/`canStart`: the catalog's `+` button passes it; the boards
  overview (`shell/MyBoards.tsx`, via `ScanToJoinButton`, a "Join a session" button) omits it and
  is join-only, since there's no board context to host in. Joining works signed-out (`JoinSession`
  owns sign-in); only hosting needs an account.
- **`sessions/qrDecoder.ts`** is the dynamic-import boundary: the `@yudiel/react-qr-scanner`
  wrapper and the ~433 kB `zxing-wasm` reader load only when the dialog opens (the app's first
  code-split). iOS Safari still ships `BarcodeDetector` disabled, so a WASM decoder is mandatory.
- The reader WASM is **self-hosted** (bundled via Vite `?url`, never fetched from jsDelivr) and
  **excluded from the SW precache** (`globIgnores` + a CacheFirst runtime route in
  `vite.config.ts`) — it would bloat every install, and scanning needs the network anyway.
- WASM prep is a **retryable** runtime step (`ensureDecoder`), not a top-level await: a failed
  offline fetch clears its memo so a later retry recovers, rather than leaving the module record
  permanently errored. A load failure drops back to the chooser, whose paste field reuses the same
  `parseJoinUrl` — so a camera-less or offline joiner is never stuck.
- The body branches on `phase` (`menu` / `scanning`); the camera mounts only in `scanning`, so
  leaving it (Back, close, or a failure) tears the stream down. Rear camera
  (`facingMode: 'environment'`); re-acquired on foreground (iOS standalone PWAs freeze the stream
  when backgrounded).

## Cross-device resume

The active session is **device-local**: the pointer lives only in the originating device's
`localStorage` (`sessionsStore.ts`), and the client otherwise never enumerates a user's sessions.
So a second device signed into the same account could not see a session created/joined on the
first. **Resume** closes that gap without changing the sharing model — it is discovery, not a new
join.

Backend: [`supabase/migrations/0016_session_resume.sql`](../supabase/migrations/0016_session_resume.sql)
— the `list_my_live_sessions()` RPC (see the RPC table above).

- **`sessionsStore.ts`** — `listMyLiveSessions()` calls the RPC and maps rows to `Session` (returns
  `[]` on error/unconfigured, so an offline fetch just renders nothing). `resumeSession(session)`
  adopts a listed session as this device's active session — the tail of `joinSession` **without**
  the join RPC, consent, or an `expires_at` bump (the caller is already a member; resuming is a pure
  adopt). It **awaits** the server reconcile (`refreshActiveSession`) and returns `{ live }` so the
  caller navigates only when the session is still live; a dead-on-arrival session (ended/expired
  between list and tap) is retired and returns `{ live: false }`.
- **`sessions/useResumableSessions.ts`** — the shared fetch-and-adopt hook consumed by both surfaces
  below. Owns the `signedIn && !activeSession` gating, the `visibilitychange` + `online` self-heal,
  the empty→empty no-op guard, the dead-on-arrival branch, and the post-resume `navigateToSessionBoard`
  call. Optional `boardLayoutId` narrows the list to a single board (used by SessionBar). Explicit
  tap only — the hook never auto-adopts (R1).
- **`sessions/ResumableSessionRow.tsx`** — the presentational one-row button (session name + board
  name + "Resume"/"Resuming…" pill). Accepts a `className` override so callers can skin it for their
  chrome (card in MyBoards, slim in-bar in SessionBar).
- **`shell/MyBoards.tsx`** — the **"Resume session"** list across ALL boards, rendered only when
  signed-in with no active session (the idle surface, above "Join a session"). Consumes
  `useResumableSessions()` with no filter. Ended notice is a card-style block.
- **`catalog/SessionBar.tsx`** — in-context Resume for **this board**: when idle on a catalog and a
  live session exists on the server for that same board (e.g. started on another device), stacks the
  Resume row(s) above the StartBar in the same slim chrome family. Consumes
  `useResumableSessions({ boardLayoutId: board.layoutId })`. Ended notice is a slim in-bar row.
  StartBar (start/join) stays visible below, so a stale/wrong-crew Resume never blocks starting fresh.
- **`sessions/sessionNav.ts`** — `navigateToSessionBoard(navigate, session)`, the single canonical
  "session → board catalog" landing shared by `JoinSession` (post-join), `MyBoards` (post-resume),
  and `SessionBar` (post-in-context-resume) so all three can't drift. Resolves the board from the
  static catalog by layout id (no board-add step needed), **activates the board** (promotes it to
  the MRU + persisted `activeBoard` pointer so the device's active board and the URL-scoped catalog
  don't silently disagree), and falls back to `/boards` for a board this build doesn't ship — never
  route a session tap through the fallback-less board-browse `onActivated`.

Non-goals (v1): realtime "you have a new session" push, auto-resume on sign-in (explicit tap only),
iOS, and rejoining an *ended* session (ended = gone).

## Session queue (playlist)

A session also carries a shared, ordered **queue** of problems the crew wants to try — its
short-term memory for "what's next", distinct from the sent-status projection above. Any member
adds, reorders, checks off, and removes; changes push to co-members over the session's existing
private Broadcast channel.

Backend: [`supabase/migrations/0015_session_queue.sql`](../supabase/migrations/0015_session_queue.sql).

- **`session_queue`** — one row per queued problem occurrence: `session_id` (FK, cascade),
  `source_catalog_id`, `board_layout_id`, `added_by`, `position`, lifecycle `done_at` / `done_by`,
  soft-delete `deleted`. Modeled on `list_problems` (0003) plus ordering and a done lifecycle.
- **Lifecycle** — *active* (`done_at` null) / *done* (`done_at` set, kept in a "Done" group for
  the life of the session) / *removed* (`deleted`). A partial unique index on
  `(session_id, source_catalog_id) WHERE deleted = false AND done_at IS NULL` makes a problem
  active at most once, while allowing a checked-off problem to be re-added as a fresh active item.
- **Ordering** — integer `position` among active rows; every read sorts `position, created_at,
  id` (a deterministic tiebreak, so an add racing a reorder still resolves to one identical order
  on every client). Reorder is one `SECURITY DEFINER` RPC
  `reorder_session_queue(p_session_id, p_ordered_ids)` that rewrites positions in a single
  transaction. Because a DEFINER RPC bypasses RLS, it both checks caller membership **and**
  constrains the write to `session_id = p_session_id` — a member of one session cannot reorder
  another's rows.
- **Attribution is server-authoritative** — `added_by` is pinned on INSERT and immutable on
  UPDATE; `done_by` is pinned to the checker at check-off (a `BEFORE UPDATE` trigger). A member
  cannot spoof who added or checked off an item.
- **RLS** — members-only read/write via `is_session_member`; no DELETE policy (removal is a
  soft-delete UPDATE). Access goes **direct through RLS** (no projection RPC) — the queue has no
  cross-user privacy constraint, unlike `ascents`.
- **Realtime** — a data-free `queue-changed` broadcast on the row's own `session:<id>` channel
  (reusing 0012's `realtime.messages` receive policy — no new policy); clients debounce-refetch.
  Because Broadcast is best-effort, the store also reconciles on foreground, active-session
  change, and reconnect, so a dropped nudge never strands a stale queue.

Client: `sessions/queueStore.ts` (reactive store + optimistic mutations), `sessions/QueueDrawer.tsx`
+ `QueueItemRow.tsx` (the drawer, opened from the catalog `SessionBar`; Edit mode reorders via the
dnd-kit `components/ui/sortable.tsx`, and a row swipes left to remove). Add entry points:
`catalog/ProblemDetailAddToQueue.tsx` (the detail's blue queue icon — tap to add, tap again to
remove) and `catalog/useSwipeToQueue.ts` (swipe a catalog row left to add). Membership is surfaced
on the catalog row as a soft-blue leading rail (`CatalogRow`, driven by a `queuedIds` set), and the
sent-marker on a queue row reuses `useMemberSenders`. Queue confirmations toast **top-center**
(`sessions/queueToast.ts`) so they clear the bottom nav/FAB controls; successful add/remove stay
silent (the rail + count convey them), only failures toast.

### Surfacing on the problem detail — the paging decision (load-bearing)

The problem-detail drawer shows a horizontal **queue strip** above the beta section, and it is a
deliberate two-control model — one we chose over having a single control mean different things by
context. The strip reads the **live** queue (`sessions/useActiveQueueProblems.ts`, the no-prop-drill
idiom), so it is independent of the pager domain and shows whenever the board's session queue is
non-empty — even on a climb that isn't itself queued. It is **catalog-only**: the strip renders only
on the host that wires the queue paging hand-off (`onPageOverQueue`, from `CatalogScreen`), so the
logbook and list-detail drawers — which reuse `ProblemDetail` but don't wire it — show no strip. That
one prop is both the hand-off and the strip's visibility gate; there is no separate flag.

Two navigators, each with one fixed meaning:

- **prev/next chevrons + board-swipe** walk the *pager domain* — the list you opened the drawer from
  (the queue when opened from the queue, else the catalog/recents/list).
- **the strip** always walks the *queue*. Tapping a card **hands paging off to the queue**:
  `useProblemDrawer.pageOver` swaps the pager domain to the queue's order, so from then on the
  chevrons follow the queue too.

This is why there is no `fromQueue`/origin flag on the detail: the strip's visibility keys on the
live queue plus the host's hand-off, not on how the drawer was opened.

```mermaid
flowchart TD
    Open[Open problem detail] --> Host{Host wires onPageOverQueue?<br/>(catalog only)}
    Host -- no logbook/list --> NoStrip1[No strip · chevrons page the source list]
    Host -- yes --> Q{Board session<br/>queue non-empty?}
    Q -- no --> NoStrip2[No strip · chevrons page the source list]
    Q -- yes --> Strip[Show queue strip · chevrons still page the source list]
    Strip --> Tap{User action}
    Tap -- prev/next or board-swipe --> Domain[Page the current pager domain]
    Tap -- tap a strip card --> Handoff[pageOver: swap pager domain → queue<br/>chevrons now follow the queue]
```

**Persistence dependency (load-bearing):** `session_queue.session_id` is `ON DELETE CASCADE`,
which never fires today (sessions are only soft-deleted). If the deferred hard-delete sweep of
expired sessions ever ships, it must preserve or relocate queue rows first — a future sessions
logbook is intended to read queue history, and the cascade would otherwise erase it.

## Security posture (read before changing)

- **`invite_token` is a bearer capability.** Anyone holding the link/QR can join. v1 revokes
  only by **ending the session** (`deleted = true`, which makes the live-gated RPCs refuse — a
  dead session neither joins, projects, nor lists for resume) or the **owner removing a member**. Token **rotation** (invalidating a leaked link while
  keeping the session) is a deferred follow-up — removing a member does **not** stop them
  rejoining with the same link.
- **Expiry only bumps on explicit intent**, so an active crew must Leave/end to stop sharing;
  the 24h backstop fires only once everyone stops acting.
- **A departed member's residual exposure on peers is bounded** by the projection max-age
  (peers hold a last-good map until their next pull or the max-age drop).

## v1 / v2 boundary

**v1 (this):** on-demand pull (open / foreground / manual refresh) for the status projection;
realtime `queue-changed` / sent-status nudges; a shared session queue (playlist); static roster;
board-scoped; status-only projection.

**Deferred to v2:** online-now presence; a sessions logbook (post-session history, reading queue
rows); friend graph / standing groups; multi-board sessions; iOS; member avatars; a scheduled
hard-delete sweep of expired sessions (v1 makes them inert via the RPC guards — a sweep must
preserve `session_queue` rows first); `invite_token` rotation.
