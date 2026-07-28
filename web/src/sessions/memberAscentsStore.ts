// Cross-member ascent-status projection store. Fetches the status-only projection for the
// active session via the session_member_ascents RPC (U1) and exposes per-member
// { sentIds, loggedIds } Set-pairs — the same shape CatalogScreen derives for self — so the
// per-member filter predicate (U4) can intersect across members.
//
// Load-bearing invariants:
//   • The map is SEEDED from the server-consistent membership snapshot the RPC carries: every
//     member yields ≥1 row (real ascent rows, or a single (user_id, NULL, NULL) marker), so a
//     zero-ascent / fully-unlogged member arrives with EMPTY Sets rather than missing — which
//     keeps them in U4's members.every(...) instead of silently widening results.
//   • Single atomic readiness flag: member ids and their status arrive in one RPC, so there is
//     no per-member partial-load state. U4/U5 gate on this one flag.
//   • Revocation is bounded (R16), worst case max-age, by two mechanisms that must both hold:
//     the cached map is DROPPED at max-age (enforced by a timer AND by an age check on every
//     read — a read-path drop schedules a notify so subscribers that did not trigger it still
//     learn), and any successful pull re-derives the member set from live `session_members`, so
//     a departed member is purged by a refresh exactly as they would be by the drop. The drop is
//     the SOLE purge when a session has ended or expired, because the RPC then refuses to serve
//     and no refresh can ever succeed — which is why the timer evaluates the drop BEFORE the
//     pre-expiry refresh, and why a failed fetch must never advance `fetchedAt`.
//   • Live-ness: pulled on active-session change, on foreground (visibilitychange→visible), on
//     realtime reconnect, on explicit refresh() (R6), and — while the tab is visible AND
//     something is actually subscribed — once the map passes REFRESH_AFTER_MS, so an in-use
//     projection is replaced rather than dropped. Realtime is a nudge, never the source of
//     truth: every path above ends in the same RPC pull.

import { useEffect } from 'react'
import { useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'

export interface MemberSets {
  /** `source_catalog_id`s this member has ≥1 send on (this board). */
  sentIds: Set<string>
  /** `source_catalog_id`s this member has any ascent on (sent OR attempt). */
  loggedIds: Set<string>
}

/** Per-member Set-pairs, keyed by user-id. */
export type MemberAscentsMap = Record<string, MemberSets>

/**
 * Return `bySets` with the self member's set replaced by the LOCAL logbook sets, so every session
 * surface reads self's sends from the authoritative local store instead of the round-trip
 * projection (which is stale for your own just-logged send). Presence stays projection-driven:
 * self is overridden ONLY when already present in `bySets` (i.e. in the projection's member set);
 * a not-yet-loaded self is not synthesised. Pure — returns a new map, never mutates the input.
 *
 * CAVEAT: the "self surfaces can't drift" guarantee is contingent on self being in the projection
 * member set. While the projection is empty (first load, or a max-age drop → `members: []`), the
 * pill and the session Sent-filter predicate — both of which iterate `members` — drop self, while
 * the row green-check (fed directly from local `sentIds`) still shows it. This is masked in
 * practice (the pill renders nothing during `loading`; the list is widened while `paused`), but
 * the surfaces are only provably aligned once the projection has loaded self.
 */
export function withSelfSends(
  bySets: MemberAscentsMap,
  selfId: string | null,
  sentIds: Set<string>,
  loggedIds: Set<string>,
): MemberAscentsMap {
  if (!selfId || !(selfId in bySets)) return bySets
  return { ...bySets, [selfId]: { sentIds, loggedIds } }
}

export interface MemberAscentsState {
  /** Roster known AND projection fetched (single atomic flag — U3). */
  ready: boolean
  /** Per-member Set-pairs (seeded for every member, empty Sets for zero-ascent members). */
  bySets: MemberAscentsMap
  /** Server-consistent membership snapshot (the member set U4/U5 iterate). */
  members: string[]
  /** Non-fatal error from the last fetch (keeps the last-good map). */
  error: string | null
  /** The map was dropped by max-age after having loaded (KTD-5) — distinguishes "cross-member
   *  filtering paused, list widened" from a first-load "loading". */
  stale: boolean
  /** When the current map was fetched (ms) — drives max-age. Null when empty/dropped. */
  fetchedAt: number | null
}

/** Max age of a cached projection before it is dropped even without a successful refetch
 *  (KTD-5) — bounds a departed member's residual exposure (R16). */
export const MAX_AGE_MS = 5 * 60_000
const STALE_CHECK_MS = 30_000
/** Refresh a still-good map once it passes this age, so it is REPLACED rather than dropped.
 *  Derived from STALE_CHECK_MS rather than a bare literal: the headroom only means anything in
 *  units of the tick that enforces it, so tuning the cadence must move this with it. Two ticks —
 *  one to notice, one of slack for a slow round-trip to land before MAX_AGE_MS. The bound itself
 *  is unchanged either way, since a failed refresh leaves the original deadline in place. */
const REFRESH_AFTER_MS = MAX_AGE_MS - 2 * STALE_CHECK_MS
/** How long to wait between attempts once the map has been DROPPED and we are trying to get it
 *  back. Slower than the tick so a sustained outage costs one request a minute, not two. */
const RETRY_AFTER_MS = 2 * STALE_CHECK_MS

const EMPTY: MemberAscentsState = { ready: false, bySets: {}, members: [], error: null, stale: false, fetchedAt: null }

let state: MemberAscentsState = EMPTY
const listeners = new Set<() => void>()
let currentSessionId: string | null = null
let staleTimer: ReturnType<typeof setInterval> | null = null
/**
 * Monotonic fetch counter — the same guard sessionRealtime's `activationToken` uses, and for the
 * same reason: a session-id check cannot tell a current response from a superseded one for the
 * SAME session. Bumped when a fetch starts AND whenever the map is invalidated (max-age drop,
 * re-activation), so a response already in flight when the map was purged cannot land afterwards
 * and resurrect it — which would restore a departed member's rows AND stamp them with a fresh
 * `fetchedAt`, extending their exposure by another full max-age past the bound (R16).
 */
let fetchToken = 0
/** When the last fetch was ATTEMPTED (success or failure) — rate-limits the post-drop retry. */
let lastAttemptAt = 0

/**
 * Is anything actually using the projection right now? Both halves matter, and neither implies
 * the other: `listeners.size` because the store stays activated for the whole session (the hook's
 * effect has no teardown), so without it a user sitting on Settings would keep pulling the crew's
 * ascent data for no reader — cost on a phone, and residency for data nothing is showing.
 * `visibilityState` because a backgrounded tab should never issue network at all.
 */
function inUse(): boolean {
  return (
    currentSessionId !== null &&
    listeners.size > 0 &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  )
}

function notify(): void {
  for (const l of listeners) l()
}

function setState(next: MemberAscentsState): void {
  state = next
  notify()
}

/** Drop the map if it has aged past MAX_AGE_MS. Idempotent (a dropped map has fetchedAt=null).
 *  Returns whether it changed. */
function applyStaleness(): boolean {
  if (state.fetchedAt !== null && Date.now() - state.fetchedAt > MAX_AGE_MS) {
    state = { ready: false, bySets: {}, members: [], error: state.error, stale: true, fetchedAt: null }
    // Invalidate any in-flight fetch: its response predates this purge, so committing it would
    // undo the drop and re-arm the deadline from now.
    fetchToken += 1
    return true
  }
  return false
}

/**
 * Age-check for the READ path (getSnapshot), which can drop the map during a subscriber's render.
 * The drop must reach the OTHER subscribers, and it is the read path — not the timer — that
 * usually gets there first: whichever component renders first performs the drop, after which the
 * timer's own `applyStaleness()` returns false and its `notify()` never runs. Without this, a
 * subscriber that happens not to re-render keeps a `ready: true` snapshot of a map that no longer
 * exists — a departed member's sends still on the pills, which is the exposure MAX_AGE_MS exists
 * to bound (R16).
 *
 * Scheduled, never synchronous: getSnapshot runs during React's render, and notifying there would
 * set state mid-render.
 */
function applyStalenessOnRead(): void {
  if (applyStaleness()) queueMicrotask(notify)
}

/**
 * Build per-member Set-pairs from the projection rows. Seeds an entry (empty Sets) for every
 * member id seen — including the `(user_id, null, null)` marker rows — then fills real ascent
 * rows: a `sent` row → both sets; an `attempted` row → loggedIds only.
 */
export function buildMemberSets(
  rows: { user_id: string; source_catalog_id: string | null; status: string | null }[],
): { bySets: MemberAscentsMap; members: string[] } {
  const bySets: MemberAscentsMap = {}
  const members: string[] = []
  for (const r of rows) {
    let sets = bySets[r.user_id]
    if (!sets) {
      sets = { sentIds: new Set(), loggedIds: new Set() }
      bySets[r.user_id] = sets
      members.push(r.user_id)
    }
    if (r.source_catalog_id && r.status) {
      sets.loggedIds.add(r.source_catalog_id)
      if (r.status === 'sent') sets.sentIds.add(r.source_catalog_id)
    }
  }
  return { bySets, members }
}

async function fetchMemberAscents(sessionId: string): Promise<void> {
  const myToken = ++fetchToken
  lastAttemptAt = Date.now()
  if (!supabase) {
    // Unconfigured: nothing to project, but mark ready so the predicate treats the (absent)
    // session clause as a no-op rather than blanking the list.
    setState({ ready: true, bySets: {}, members: [], error: null, stale: false, fetchedAt: Date.now() })
    return
  }
  const { data, error } = await supabase.rpc('session_member_ascents', { p_session_id: sessionId })
  // Superseded by a newer fetch, a re-activation, or a max-age drop while this was in flight.
  // The session-id half alone is not enough — see fetchToken.
  if (sessionId !== currentSessionId || myToken !== fetchToken) return
  if (error) {
    // Keep the last-good map (subject to max-age); surface a non-fatal error.
    setState({ ...state, error: error.message })
    return
  }
  const rows = (data ?? []) as { user_id: string; source_catalog_id: string | null; status: string | null }[]
  const { bySets, members } = buildMemberSets(rows)
  setState({ ready: true, bySets, members, error: null, stale: false, fetchedAt: Date.now() })
}

function onVisibility(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && currentSessionId) {
    void fetchMemberAscents(currentSessionId) // passive foreground refetch (no server expiry bump)
  }
}

function startListeners(): void {
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
  if (!staleTimer) {
    staleTimer = setInterval(() => {
      // Drop first, unconditionally: the max-age bound must never be starved by the refresh below.
      if (applyStaleness()) {
        notify()
        return
      }
      // Then, if someone is actually looking at it, replace the map BEFORE it ages out — otherwise a
      // continuously-foregrounded tab (the normal way this app is used at a gym: scrolling the
      // catalog between climbs) never sees a visibilitychange, so nothing refetches and the map
      // dies under them. That drop is not cosmetic: applyFilters skips the whole per-member clause
      // when unready, so the list widens from a filtered handful to every problem mid-scroll.
      //
      // No "already attempted" bookkeeping is needed, because a failed fetch leaves `fetchedAt`
      // untouched (see the error path in fetchMemberAscents): the attempt repeats at most until
      // MAX_AGE_MS, at which point the branch above drops the map, `fetchedAt` becomes null, and
      // this branch stops firing. Bounded by arithmetic rather than by a flag.
      if (!inUse()) return
      if (state.fetchedAt !== null && Date.now() - state.fetchedAt > REFRESH_AFTER_MS) {
        void fetchMemberAscents(currentSessionId!)
        return
      }
      // Already dropped: keep trying, rate-limited. Without this, one bad minute is permanent —
      // both pre-expiry attempts fail, the drop nulls `fetchedAt`, and the branch above can never
      // fire again. A foregrounded tab produces no visibilitychange and a healthy socket produces
      // no reconnect, so the filter would stay off until the user found the manual Refresh, which
      // is exactly the stranding this whole mechanism exists to prevent.
      if (state.fetchedAt === null && state.stale && Date.now() - lastAttemptAt > RETRY_AFTER_MS) {
        void fetchMemberAscents(currentSessionId!)
      }
    }, STALE_CHECK_MS)
  }
}

function stopListeners(): void {
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  if (staleTimer) {
    clearInterval(staleTimer)
    staleTimer = null
  }
}

/** Point the store at a session (or null to clear). Resets the map and fetches; installs the
 *  foreground + max-age machinery while a session is active. */
export function activateMemberAscents(sessionId: string | null): void {
  if (sessionId === currentSessionId) return
  currentSessionId = sessionId
  setState({ ...EMPTY })
  if (sessionId) {
    startListeners()
    void fetchMemberAscents(sessionId)
  } else {
    stopListeners()
  }
}

/** Explicit refresh (manual pull — R6). Re-fetches and replaces the map. */
export function refreshMemberAscents(): Promise<void> {
  if (!currentSessionId) return Promise.resolve()
  return fetchMemberAscents(currentSessionId)
}

/**
 * Optimistically drop a member from the cached projection on a realtime member-left nudge, so the
 * catalog's "who sent this" pills lose them at the same instant the roster does. Without this the
 * roster (removed immediately) and this projection (refetched on a debounce) briefly disagree, and
 * buildSenders renders the departed member with no roster profile — an initials-fallback ghost.
 * refreshMemberAscents reconciles right after. No-op if the member isn't in the current map.
 */
export function removeMemberFromProjection(userId: string): void {
  if (!state.members.includes(userId)) return
  const bySets = { ...state.bySets }
  delete bySets[userId]
  setState({ ...state, members: state.members.filter((m) => m !== userId), bySets })
}

// ─── Reactive bindings ────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): MemberAscentsState {
  applyStalenessOnRead() // age check on every read — drops a stale map even if the timer never fired
  return state
}

/** Non-reactive snapshot (tests; imperative callers). */
export function getMemberAscentsSnapshot(): MemberAscentsState {
  applyStalenessOnRead()
  return state
}

/**
 * Reactive projection for the given active session id. Drives activation on id change; returns
 * the current per-member Set-pairs + readiness. Passing null (no session) clears the store.
 */
export function useMemberAscents(sessionId: string | null): MemberAscentsState {
  useEffect(() => {
    activateMemberAscents(sessionId)
  }, [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot)
}
