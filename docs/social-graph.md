# Social graph — follow feed, profiles, blocking (web)

The **friends** subsystem: an asymmetric follow graph and a read-only activity feed of friends'
sends. It is **additive** to the membership-based sharing of collaboration sessions and
collaborative lists — following is a persistent relationship independent of any list or session.
Web-first; the Supabase backend is platform-agnostic for a later iOS client.

Plan of record: `docs/plans/2026-07-20-001-feat-web-friends-feed-plan.md` (R1–R24, KTD1–KTD12).

## Shape at a glance

- **Follow** is asymmetric (`follows`, statuses `pending`/`active`). Following a **public** account
  is instant; following an **effectively-private** one creates a request the target approves.
- The **feed** is a pull (fan-out-on-read) of the caller's actively-followed accounts' sends,
  keyset-ordered by a server-stamped arrival time. Read-only in v1 (no reactions).
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
| `ascents.first_sent_at` | **Server-stamped** arrival time — the feed's sort key. |

All FKs are `ON DELETE CASCADE` on **both** sides, so the existing `public.delete_user()` (0001)
sweeps a deleted user's edges/blocks/notifications with no RPC change.

### `first_sent_at` — the feed's sort key (KTD3)

A `BEFORE INSERT OR UPDATE` trigger (`set_first_sent_at`) stamps `first_sent_at` the first time a
row is seen `sent = true` and **never moves it thereafter**, via a single server-authoritative
assignment:

```sql
new.first_sent_at := coalesce(old.first_sent_at, case when new.sent then now() end);
```

The client value is ignored on **every** branch (an unsent row with a spoofed future stamp cannot
survive the sent-flip — that would pin a fake send atop every feed). Ordering by arrival (not by
climb `date`, not by `updated_at`) gives: fresh on late sync, no edit-spam, no clock-gaming, no
backfill-invisibility. The feed **displays** the climb `date` but **sorts** by `first_sent_at`.
Backfill of pre-existing sends runs *before* the trigger is created (or it would re-stamp `now()`).
A partial index `ascents (first_sent_at desc, id desc) where sent and not deleted` serves the keyset.

## Access control (migration `0018_social_rpcs.sql`)

Cross-user reads of owner-only `ascents` (0002) **never relax `ascents` RLS** — they go through a
minimal-projection SECURITY DEFINER core, exactly like 0004's list group-status RPC.

- **The projection core `_sends_for_actors` is granted to NO client role** (`revoke all from
  public`, no grant). It carries no gate; only the two SECURITY-DEFINER wrappers
  (`get_follow_feed`, `get_user_sends`, same owner) may call it. "Internal" is a naming
  convention — the revoke is the access control (KTD4). A direct client call is denied.
- **`is_blocked(a,b)` (bidirectional) is applied in every social read**: `request_follow`,
  `get_profile_card`, `get_follow_feed`, `get_user_sends`, `get_follow_list`,
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
| `get_follow_feed(limit, cursor…)` | The caller's active, non-blocked followees → core. |
| `get_user_sends(target, limit, cursor…)` | Single actor after the R6/R12 gate → core. |
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
- **`feedStore`** — keyset pagination over `get_follow_feed`, with a **user-keyed read-through
  cache** of the last first page so re-opening (esp. offline) paints instantly. States: `loading`
  / `loaded` / `stale` (offline, painting cache + "last updated" banner) / `offline` / `error`.
- **`feedGrouping.groupFeed`** — collapses a **same-arrival burst** (consecutive same-actor run
  within `BURST_WINDOW_MS` = 5 min, length ≥ `BURST_MIN` = 3) into one expandable "Ana logged N
  sends" entry, so a bulk logbook import can't bury the feed. **Client-side presentation only** —
  the server keyset still pages raw rows (R17 holds).
- **`notificationsStore`** — requests (from `get_follow_requests`) + activity (`get_notifications`);
  `badgeCount` = pending requests + unread activity (a request has no `read_at` and is the most
  actionable item, so it counts even with zero unread activity).

### Screens & routes (`web/src/router.tsx`)

| Route | Component |
| --- | --- |
| `/feed` | `FeedScreen` — the follow feed (burst-collapsed, read-cached). |
| `/people` | `DiscoverScreen` — search + co-members + follow-back. |
| `/notifications` | `NotificationsScreen` — requests (approve/decline) + activity. |
| `/u/$handle` | `ProfileScreen` — card + relationship button + block; block-gated "unavailable" state. |

`RelationshipButton` is the visible follow state machine (Follow / Requested→cancel /
Following→confirm-then-unfollow). `PersonRow` (avatar + identity link + button) is shared across
discovery and notifications. Feed/profile sends open a problem via the board catalog `?problem`
drawer.

**Entry point:** the social surfaces live in the **account menu** (`AccountMenu`) — Feed, Find
people, Notifications, View profile — with an **unread badge on the header avatar** driven by
`notificationsStore.badgeCount`. (The bottom nav is at capacity; a dedicated Feed tab is possible
future nav polish.)

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

## Gotchas

- **`handle` is returned as `text`** from every RPC (`handle::text`) — the `citext` type isn't
  resolvable under `search_path=''`, and case-insensitive matching uses `lower(...::text)`.
- **The projection core must stay revoked.** If a future RPC needs it, keep it wrapper-only; a
  grant to `authenticated` reopens the gate-bypass hole the DoD tests against.
- **`first_sent_at` is server-authoritative** like `updated_at`; never write it from the client.
- **Blocking is a predicate on the whole surface**, not one feature — any new social read must
  apply `is_blocked` (both directions) and, for activity behind a private account, the effective-
  private gate.
