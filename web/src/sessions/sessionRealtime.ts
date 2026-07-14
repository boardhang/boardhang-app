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
import { refreshMemberAscents } from './memberAscentsStore'
import { getSessionsSnapshot, reloadActiveRoster } from './sessionsStore'
import { memberLabel } from './sessionsTypes'

/** Coalesce a burst of nudges into a single refetch. */
export const NUDGE_DEBOUNCE_MS = 600

/** Broadcast event names — must match the triggers' realtime.send(... event ...) in 0011/0012. */
const NUDGE_EVENT = 'ascents-changed'
const MEMBER_JOINED_EVENT = 'member-joined'
const MEMBER_LEFT_EVENT = 'member-left'

interface NudgePayload {
  author?: string
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
async function onMembershipChange(): Promise<void> {
  const { joined, left } = await reloadActiveRoster()
  const self = getSessionsSnapshot().selfId
  for (const m of joined) {
    if (m.userId !== self) toast(`${memberLabel(m)} joined the session`)
  }
  for (const m of left) {
    if (m.userId !== self) toast(`${memberLabel(m)} left the session`)
  }
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
        void onMembershipChange()
      })
      ch.on('broadcast', { event: MEMBER_LEFT_EVENT }, () => {
        if (myToken !== activationToken) return
        void onMembershipChange()
      })
      ch.subscribe()
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
