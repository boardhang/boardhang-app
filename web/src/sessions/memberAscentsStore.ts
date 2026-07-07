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
//   • Revocation is bounded (R16): the cached map carries a max-age, enforced BOTH by a timer
//     that drops it when stale AND by an age check on every read — so even a continuously
//     foregrounded tab that never refocuses drops a departed member's residual data at max-age.
//   • Live-ness: pulled on active-session change, on foreground (visibilitychange→visible), and
//     on explicit refresh() (R6). Not realtime.

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

const EMPTY: MemberAscentsState = { ready: false, bySets: {}, members: [], error: null, stale: false, fetchedAt: null }

let state: MemberAscentsState = EMPTY
const listeners = new Set<() => void>()
let currentSessionId: string | null = null
let staleTimer: ReturnType<typeof setInterval> | null = null

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
    return true
  }
  return false
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
  if (!supabase) {
    // Unconfigured: nothing to project, but mark ready so the predicate treats the (absent)
    // session clause as a no-op rather than blanking the list.
    setState({ ready: true, bySets: {}, members: [], error: null, stale: false, fetchedAt: Date.now() })
    return
  }
  const { data, error } = await supabase.rpc('session_member_ascents', { p_session_id: sessionId })
  if (sessionId !== currentSessionId) return // active session changed mid-flight — drop
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
      if (applyStaleness()) notify()
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

// ─── Reactive bindings ────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): MemberAscentsState {
  applyStaleness() // age check on every read — drops a stale map even if the timer never fired
  return state
}

/** Non-reactive snapshot (tests; imperative callers). */
export function getMemberAscentsSnapshot(): MemberAscentsState {
  applyStaleness()
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
