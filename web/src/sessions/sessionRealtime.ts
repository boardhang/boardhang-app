// Real-time nudge subscriber for the active collaboration session. Subscribes to the private
// `session:<id>` Broadcast channel and, on a co-member's send, debounce-refetches the
// cross-member projection via refreshMemberAscents(). The nudge is a content-free doorbell —
// the actual sent/tried sets still arrive only through session_member_ascents() (0007), so this
// module never trusts the payload as data (KTD-5).
//
// Load-bearing invariants:
//   • Push is ADDITIVE (R6). This layers on top of memberAscentsStore's pull model (activation /
//     foreground / manual refresh / 5-min max-age). If Realtime is unconfigured or the socket
//     drops, activation no-ops / receives nothing and behavior degrades to exactly today's pull.
//   • Private channel (KTD-4): the socket must carry the user JWT before the channel joins, so we
//     resolve the session and setAuth() BEFORE creating + subscribing the channel. A stale async
//     resolution that lands after a session switch is dropped by the currentSessionId guard.
//   • Bursts coalesce (R7): many nudges within NUDGE_DEBOUNCE_MS collapse to one refetch.
//   • Self-sends are skipped: our own send never changes the cross-member projection for us.
//   • Clean teardown (R8): switching sessions or deactivating removes the channel; no leak.

import { useEffect } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { supabase } from '../supabase/client'
import { refreshMemberAscents, removeMemberFromProjection } from './memberAscentsStore'
import { refreshQueue } from './queueStore'
import {
  endActiveSessionLocally,
  getSessionsSnapshot,
  refreshLitProblem,
  reloadActiveRoster,
  removeMemberFromRoster,
} from './sessionsStore'
import { memberLabel } from './sessionsTypes'

/** Coalesce a burst of nudges into a single refetch. */
export const NUDGE_DEBOUNCE_MS = 600

/** Broadcast event names — must match the triggers' realtime.send(... event ...) in 0012/0013. */
const NUDGE_EVENT = 'ascents-changed'
const MEMBER_JOINED_EVENT = 'member-joined'
const MEMBER_LEFT_EVENT = 'member-left'
const SESSION_ENDED_EVENT = 'session-ended'
// Must match 0015's session_queue trigger: realtime.send(... event => 'queue-changed'). A data-free
// doorbell — the queue itself still arrives only through queueStore's direct RLS select (KTD5).
const QUEUE_CHANGED_EVENT = 'queue-changed'
// Must match 0017's sessions lit trigger: realtime.send(... event => 'lit-changed'). Same doorbell
// pattern — the lit pointer itself arrives only through refreshLitProblem's RLS select.
const LIT_CHANGED_EVENT = 'lit-changed'

interface NudgePayload {
  author?: string
}

interface MembershipPayload {
  user_id?: string
}

let currentSessionId: string | null = null
let channel: RealtimeChannel | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let selfId: string | null = null
// Monotonic activation counter. The async setup below must gate on THIS, not on the session id:
// an id check cannot tell a still-current activation from a superseded one for the SAME id (e.g.
// S1 → null → S1 with two getSession() promises in flight), which would orphan a channel.
let activationToken = 0

function scheduleRefetch(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void refreshMemberAscents()
  }, NUDGE_DEBOUNCE_MS)
}

function onNudge(author: string | undefined): void {
  // Skip our own send: it never changes the cross-member projection for us, and our own row is
  // already updated locally. Unknown author (selfId not yet resolved) → refetch to be safe.
  if (author && selfId && author === selfId) return
  scheduleRefetch()
}

/**
 * A member joined or left: reload the roster (live avatars in SessionBar) and toast the delta by
 * name — "<name> joined" for new members, "<name> left" for departed ones — skipping ourselves.
 * Toasting off the actual roster delta (not the event name) means a burst that adds and removes
 * in one reload still narrates both. Best-effort — a failed reload keeps the last-good roster.
 */
async function onMembershipChange(leftUserId: string | undefined, token: number): Promise<void> {
  const snap = getSessionsSnapshot()
  // Fall back to the module's own resolved id: the store's selfId can still be null in a narrow
  // window, and misclassifying a kick as an ordinary leave would strand me in a session I can no
  // longer read (RLS).
  const self = snap.selfId ?? selfId
  // A member-left about MYSELF while my session is still active means the owner kicked me (a
  // voluntary leave already retired the session locally before this echo arrives). End the
  // session for me — otherwise the bar lingers with a roster I can no longer read (RLS).
  if (leftUserId && leftUserId === self && snap.activeSession) {
    endActiveSessionLocally()
    toast('You were removed from the session')
    return
  }
  // A member-left nudge carries the departed user_id: drop them from the roster immediately so
  // their avatar disappears at once, instead of lingering for the reload round-trip. Toast from
  // the entry captured before removal.
  if (leftUserId) {
    const gone = removeMemberFromRoster(leftUserId)
    // Drop them from the projection in the SAME tick, so the "who sent this" pills don't briefly
    // render them profile-less (an initials ghost) while the roster is ahead of the projection.
    removeMemberFromProjection(leftUserId)
    if (gone && gone.userId !== self) toast(`${memberLabel(gone)} left the session`)
  }
  // Reconcile with the server (adds joiners, confirms the removal) and refetch the projection so
  // the catalog's "who sent this" tracks the roster — a joiner brings a sent/tried set the cache
  // doesn't have yet, a leaver's should drop. Debounced + no-op off-catalog. Joiners surface as
  // new roster entries; a leave with no payload (shouldn't happen) falls back to the `left` diff.
  const { joined, left } = await reloadActiveRoster()
  if (token !== activationToken) return // a session switch/teardown superseded us mid-reload
  scheduleRefetch()
  for (const m of joined) {
    // Skip self, and the just-departed member — a lagging reload must not re-toast a leaver as a
    // joiner (their optimistic removal makes them absent from the pre-reload roster diff).
    if (m.userId !== self && m.userId !== leftUserId) toast(`${memberLabel(m)} joined the session`)
  }
  if (!leftUserId) {
    for (const m of left) {
      if (m.userId !== self) toast(`${memberLabel(m)} left the session`)
    }
  }
}

/**
 * The owner ended the session for everyone (0014). Retire it locally. The owner who ended it has
 * already retired (endSession clears it before this echo arrives), so the activeSession guard
 * makes this a no-op for them — only other still-active members retire and see the toast.
 */
function onSessionEnded(): void {
  if (!getSessionsSnapshot().activeSession) return
  endActiveSessionLocally()
  toast('The session ended')
}

function teardown(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (channel && supabase) supabase.removeChannel(channel)
  channel = null
  selfId = null // don't let a previous account's id linger and cause a false self-skip
}

/**
 * Point the subscriber at a session (or null to clear). Tears down any prior channel, then —
 * when a session id and a configured client are present — resolves the user JWT, authorizes the
 * socket, and opens the private `session:<id>` channel. Idempotent on the same id.
 */
export function activateSessionRealtime(sessionId: string | null): void {
  if (sessionId === currentSessionId) return
  const myToken = ++activationToken
  currentSessionId = sessionId
  teardown()
  if (!sessionId || !supabase) return // deactivated, or unconfigured → pull model only (R6)

  const client = supabase
  // Resolve the session first: a private channel's join must carry the JWT (setAuth) BEFORE
  // subscribe, and we want our own id for the self-send skip. Best-effort — never throw.
  void client.auth
    .getSession()
    .then(({ data }) => {
      if (myToken !== activationToken) return // a newer activation superseded this one
      selfId = data.session?.user.id ?? selfId
      const token = data.session?.access_token
      if (token) client.realtime.setAuth(token)

      const ch = client.channel(`session:${sessionId}`, { config: { private: true } })
      ch.on('broadcast', { event: NUDGE_EVENT }, (msg: { payload?: NudgePayload }) => {
        if (myToken !== activationToken) return // a late message after a fast switch
        onNudge(msg.payload?.author)
      })
      ch.on('broadcast', { event: MEMBER_JOINED_EVENT }, () => {
        if (myToken !== activationToken) return
        void onMembershipChange(undefined, myToken)
      })
      ch.on('broadcast', { event: MEMBER_LEFT_EVENT }, (msg: { payload?: MembershipPayload }) => {
        if (myToken !== activationToken) return
        void onMembershipChange(msg.payload?.user_id, myToken)
      })
      ch.on('broadcast', { event: SESSION_ENDED_EVENT }, () => {
        if (myToken !== activationToken) return
        onSessionEnded()
      })
      // A queue write broadcasts a data-free 'queue-changed' nudge; refetch the queue. refreshQueue
      // is debounced internally, so a reorder's burst of N nudges collapses to one refetch (KTD4) —
      // no debounce of our own here (unlike the ascents nudge, whose debounce lives in this module).
      ch.on('broadcast', { event: QUEUE_CHANGED_EVENT }, () => {
        if (myToken !== activationToken) return
        refreshQueue()
      })
      // "Now on the wall" (#97): a lit-pointer write broadcasts a data-free 'lit-changed' nudge;
      // refetch just the lit columns. No self-skip — our own write already updated optimistically
      // and the narrow reconcile is cheap and confirms server truth. Dropped-nudge backstop: the
      // full-row pulls (activation / foreground / manual refresh) carry the lit columns anyway.
      ch.on('broadcast', { event: LIT_CHANGED_EVENT }, () => {
        if (myToken !== activationToken) return
        void refreshLitProblem()
      })
      // Broadcast is best-effort with no replay, so a 'queue-changed' nudge dropped while the socket
      // was down would strand a stale queue. On reconnect (a second+ SUBSCRIBED after a drop — the
      // first is the initial join, already covered by the store's activation fetch), reconcile it
      // (KTD5). memberAscents reconciles on foreground/active-session change instead; the queue adds
      // reconnect here because its nudge, not just its pull, can be missed mid-disconnect.
      let hasSubscribed = false
      ch.subscribe((status) => {
        if (myToken !== activationToken) return
        if (status !== 'SUBSCRIBED') return
        if (hasSubscribed) refreshQueue()
        hasSubscribed = true
      })
      channel = ch
    })
    .catch(() => {}) // getSession/subscribe failure → stay on the pull model (R6)
}

/**
 * Mount the realtime subscriber for the given active session id. Mirrors useMemberAscents's
 * lifecycle so push is active exactly when the cross-member projection is, and dies with it.
 */
export function useSessionRealtime(sessionId: string | null): void {
  useEffect(() => {
    activateSessionRealtime(sessionId)
  }, [sessionId])
}
