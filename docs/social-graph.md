# Social graph — profiles, follow graph, blocking (web)

The **friends** subsystem: an asymmetric follow graph and profile pages where you view another
user's sends — their **grade pyramid**, **latest climbing session**, and full send history. It
is **additive** to the membership-based sharing of collaboration sessions and collaborative lists
— following is a persistent relationship independent of any list or session. Web-first; the
Supabase backend is platform-agnostic for a later iOS client.

Plan of record: `docs/plans/2026-07-20-001-feat-web-friends-feed-plan.md` (R1–R24, KTD1–KTD12).
A follow **feed** was scoped and built, then removed before launch in favour of profile-centric
viewing — the `get_follow_feed` RPC and its web surface are both gone. The plan of record still
describes the feed as historical context.

## Shape at a glance

- **Follow** is asymmetric (`follows`, statuses `pending`/`active`). Following a **public** account
  is instant; following an **effectively-private** one creates a request the target approves.
- **Sends are viewed on a profile** (`/u/:handle`), not in a feed: the grade pyramid and the
  keyset-paged sends grouped into day-sessions, rendered exactly like the logbook. Read-only in v1
  (no reactions).
- **Blocking** is a bidirectional cut threaded through *every* social read.
- **Privacy** is per-account, with an explicit public/private choice made by every user.

## Data model (migration `supabase/migrations/0017_social_graph.sql`)

| Table / column | Purpose |
| --- | --- |
| `follows(follower_id, followee_id, status)` | The edge. PK `(follower, followee)` (one edge, R5); `status ∈ {pending, active}`; `check(follower <> followee)`. **No client INSERT/UPDATE policy** — created only via `request_follow`, status changed only via `respond_to_follow`. SELECT/DELETE: either party. |
| `blocks(blocker_id, blocked_id)` | A directed block row; `is_blocked(a,b)` treats it as **bidirectional**. No client INSERT (via `block_user`); SELECT/DELETE own. |
| `notifications(user_id, type, actor_id, read_at, …)` | Fire-and-forget activity (`follow`, `follow_accepted`). No client INSERT (RPCs only); SELECT/UPDATE/DELETE own. Requests are **not** here (see below). |
| `profiles.is_private` | Account privacy flag (default `false`). |
| `profiles.privacy_choice_at` | When the user made the explicit public/private choice; `null` = never chose. |
| `ascents.first_sent_at` | **Server-stamped** arrival time — the sends sort key. |

All FKs are `ON DELETE CASCADE` on **both** sides, so the existing `public.delete_user()` (0001)
sweeps a deleted user's edges/blocks/notifications with no RPC change.

### `first_sent_at` — the sends sort key (KTD3)

A `BEFORE INSERT OR UPDATE` trigger (`set_first_sent_at`) stamps `first_sent_at` the first time a
row is seen `sent = true` and **never moves it thereafter**, via a single server-authoritative
assignment:

```sql
new.first_sent_at := coalesce(old.first_sent_at, case when new.sent then now() end);
```

The client value is ignored on **every** branch (an unsent row with a spoofed future stamp cannot
survive the sent-flip — that would pin a fake send atop the list). Ordering by arrival (not by
climb `date`, not by `updated_at`) gives: fresh on late sync, no edit-spam, no clock-gaming, no
backfill-invisibility. Profile sends **display** the climb `date` but **sort** by `first_sent_at`.
Backfill of pre-existing sends runs *before* the trigger is created (or it would re-stamp `now()`).
A partial index `ascents (user_id, first_sent_at desc, id desc) where sent and not deleted` serves the `get_user_sends` keyset — leading with `user_id` so a single actor's sends page as a per-actor index scan.

## Access control (migration `0018_social_rpcs.sql`)

Cross-user reads of owner-only `ascents` (0002) **never relax `ascents` RLS** — they go through a
minimal-projection SECURITY DEFINER core, exactly like 0004's list group-status RPC.

- **The projection core `_sends_for_actors` is granted to NO client role** (`revoke all from
  public`, no grant). It carries no gate; only the SECURITY-DEFINER wrapper
  `get_user_sends` (same owner) may call it. "Internal" is a naming
  convention — the revoke is the access control (KTD4). A direct client call is denied.
- **`is_blocked(a,b)` (bidirectional) is applied in every social read**: `request_follow`,
  `get_profile_card`, `get_user_sends`, `get_follow_list`,
  `get_follow_requests`, `get_notifications`, `search_profiles` (KTD5). `block_user` also deletes
  edges both ways **and** purges cross-pair notifications in one transaction.
- **Effective privacy = `is_private OR privacy_choice_at IS NULL`** (KTD9a — *private-until-chosen*).
  A user who hasn't made the explicit choice is gated as private, so an existing user is never
  followable-as-public before their one-time notice. `is_active_follower(f,t)` is the follower gate.

### RPC catalog (all SECURITY DEFINER, `search_path=''`, `grant execute to authenticated`)

| RPC | Does |
| --- | --- |
| `request_follow(target)` | The only edge writer. Self/block reject; effective-private → `pending`, else `active`; on-conflict-do-nothing; `follow` notification when it lands active. |
| `respond_to_follow(follower, accept)` | Followee-only, pending-only. Accept → active + `follow_accepted`; decline → delete. |
| `unfollow(target)` / `remove_follower(follower)` | Delete the follower-side / followee-side edge (unfollow also cancels a pending request). |
| `block_user(target)` / `unblock_user(target)` | Block: delete edges both ways + purge cross-pair notifications + insert block, one tx. |
| `get_profile_card(handle)` | Block-aware handle→card (the `/u/:handle` screen has no id); empty for a blocked pair. |
| `search_profiles(q, limit)` | Prefix match on handle/display_name, min 2 chars (anti-scrape), block-filtered, returns the caller's edge status per row. |
| `suggest_co_members(limit)` | People sharing a `list_members` (0003) or `session_members` (0007) row with the caller, minus followed/blocked/self. |
| `get_follow_list(target, kind, limit)` / `get_follow_counts(target)` | Follower/following lists + counts, block- + effective-private-gated (`can_view_social_graph`). |
| `get_follow_requests(limit)` | Pending requests toward the caller (requester cards) — sourced from `follows`, not notifications. |
| `_sends_for_actors(ids, limit, cursor…)` | **Revoked** projection core: minimal columns, keyset. |
| `get_user_sends(target, limit, cursor…, board_layout_id)` | Single actor after the R6/R12 gate → core, optionally scoped to one board (`p_board_layout_id`, null = all). Powers the profile page (`ProfileSends`); the only wrapper over the core. |
| `get_notifications(limit)` / `mark_notifications_read(ids)` | Block-aware activity read / mark read. |

**Requests are sourced from `follows` (status='pending'), never duplicated into `notifications`**
(KTD7): `respond_to_follow` mutates the edge, so the request list *is* the edge. `notifications`
carries only fire-and-forget events (new follower, request accepted).

## Web client (`web/src/social/`)

Network-only stores (KTD10 — no IndexedDB mirror, no offline mutation queue; social is *others'*
read data). Module-level state + `useSyncExternalStore`, cleared on identity change via
`AuthProvider`.

- **`followStore`** — per-target edge map; optimistic `follow`/`unfollow`/`respondToFollow`/
  `block`/`unblock` over the RPCs, rolling back on error so the caller toasts loudly (KTD10).
  `seedEdge` primes status from `search_profiles` rows.
- **`ProfileSends`** — one keyset fetch over `get_user_sends` (via the shared `sendsPage.ts`),
  scoped to the **viewer's active board** (`p_board_layout_id`, filtered server-side so keyset
  paging stays correct — changing board refetches), mapped to `Ascent` and rendered **exactly like
  the logbook**: a **grade pyramid** (the logbook's
  own `GradePyramid`/`pyramid()`, try-bucket-split flash/2nd/3rd/4+) then the sends grouped into
  **day-sessions** (the same `sessions()` grouping + date headers, e.g. "Tue, Jul 21 — 2
  problems"). "Load more" appends more keyset pages into the day groups. Rows are the shared
  `AscentRow` (board thumbnail, stars, tries, setter, comment — the projection carries
  `tries`/`stars`/`comment` so the row matches the logbook), read-only: no edit pencil, and
  `showSentIndicator={false}` (every row is a send by this user, so an always-on green check would
  misread as "you sent it"). Rows resolvable in the viewer's synced catalog open the same
  **`?problem` detail drawer** the logbook/catalog use (`useProblemDrawer` + `ProblemDetail`); the
  drawer's green check reflects the *viewer's* own sends ("you've also done this").
- **`notificationsStore`** — requests (from `get_follow_requests`) + activity (`get_notifications`);
  `badgeCount` = pending requests + unread activity (a request has no `read_at` and is the most
  actionable item, so it counts even with zero unread activity).

### Screens & routes (`web/src/router.tsx`)

| Route | Component |
| --- | --- |
| `/people` | `DiscoverScreen` — search + co-members + follow-back. |
| `/notifications` | `NotificationsScreen` — requests (approve/decline) + activity. |
| `/u/$handle` | `ProfileScreen` — card + relationship button + block + `ProfileSends` (grade pyramid + day-session-grouped sends, tappable → `?problem` drawer); block-gated "unavailable" state. |

`RelationshipButton` is the visible follow state machine (Follow / Requested→cancel /
Following→confirm-then-unfollow). `PersonRow` (avatar + identity link + button) is shared across
discovery and notifications.

**Entry point:** the social surfaces live in the **account menu** (`AccountMenu`) — Find people,
Notifications, View profile — with an **unread badge on the header avatar** driven by
`notificationsStore.badgeCount`.

## Privacy cohorts (U7)

Every user makes an **explicit** public/private choice (KTD9), and it's enforced server-side by the
private-until-chosen gate (KTD9a):

- **New users** — a required step in handle onboarding (`ProfileSetup` + shared `PrivacyChoice`);
  `saveProfile` sets `is_private` + stamps `privacy_choice_at`.
- **Existing users** — `PrivacyChoiceNotice`, a one-time **non-dismissible forced-choice** modal
  (mounted in `AppLayout`), gated on `privacy_choice_at === null` so it shows exactly once;
  `setPrivacyChoice` records it.
- A forward-looking **"Private account"** toggle lives in Settings (R9).

## Testing

No local Supabase — migrations are validated on throwaway Postgres via
`supabase/migrations/tests/run_rls_test.sh` (the `0002 → 0003 → 0007 → 0017 → 0018` chain for the
RPC case). The `stub_supabase.sql` stub adds `citext` + a `handle` column for `search_profiles`.
`0017_social_graph_rls.sql` covers the `first_sent_at` gaming path + RLS; `0018_social_rpcs_rls.sql`
covers the follow/block/gate matrix — including that the projection core is **not** client-callable.
Web: vitest unit tests per store + screen; `npm run build` (`tsc -b`) + `npm run lint` (oxlint).

## Security boundary — what is and isn't hard-enforced

The **sends/activity gate is the real privacy boundary and is hard-enforced**: the projection
core `_sends_for_actors` is executable by no client role (revoked from `public`, `anon`,
`authenticated`, `service_role` — a `revoke from public` alone is insufficient under Supabase's
default function privileges), and `is_blocked` (both directions) + the effective-private gate are
applied in every sends read. A client cannot read another user's private/blocked sends.

The **profile-card and search gates are UI-deep, not hard boundaries** (accepted v1 limitation).
`profiles` is world-readable to any authenticated user (`0001` SELECT `using (true)`) because
AuthProvider and the session-member UI read it directly. So a determined client can bypass
`get_profile_card`/`search_profiles` and read any handle/display_name/`is_private` — or page the
whole profile table — straight from PostgREST. R11's "blocked → profile appears absent" and KTD8's
anti-scrape floor therefore hold in the app UI but not at the API layer. This is accepted for v1:
profile handle/display_name are low-sensitivity in a signed-in app, and no *activity* leaks.
Narrowing the `profiles` policy (routing session-member + card reads through gated RPCs) is a
tracked follow-up.

## Gotchas

- **`handle` is returned as `text`** from every RPC (`handle::text`) — the `citext` type isn't
  resolvable under `search_path=''`, and case-insensitive matching uses `lower(...::text)`.
- **The projection core must stay revoked.** If a future RPC needs it, keep it wrapper-only; a
  grant to `authenticated` reopens the gate-bypass hole the DoD tests against.
- **`first_sent_at` is server-authoritative** like `updated_at`; never write it from the client.
- **Blocking is a predicate on the whole surface**, not one feature — any new social read must
  apply `is_blocked` (both directions) and, for activity behind a private account, the effective-
  private gate.
