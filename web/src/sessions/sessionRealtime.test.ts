import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface RosterMember {
  userId: string
  displayName: string | null
  handle: string | null
  avatarUrl: string | null
  joinedAt: string
}

interface FakeChannel {
  name: string
  opts: { config?: { private?: boolean } }
  handlers: Record<string, (msg: { payload?: { author?: string; user_id?: string } }) => void>
  subscribed: boolean
  statusCb: ((status: string) => void) | null
}

const h = vi.hoisted(() => ({
  nullClient: false,
  session: { access_token: 'tok', user: { id: 'self' } } as
    | { access_token: string; user: { id: string } }
    | null,
  channels: [] as FakeChannel[],
  removed: [] as FakeChannel[],
  setAuthCalls: [] as (string | undefined)[],
  refetchCalls: 0,
  rosterReloads: 0,
  joined: [] as RosterMember[],
  left: [] as RosterMember[],
  roster: [] as RosterMember[],
  rosterRemovals: [] as string[],
  projectionRemovals: [] as string[],
  activeSession: null as { id: string } | null,
  endedLocally: false,
  selfId: 'self' as string | null,
  toasts: [] as string[],
  queueRefreshCalls: 0,
  litRefreshCalls: 0,
}))

vi.mock('./memberAscentsStore', () => ({
  refreshMemberAscents: () => {
    h.refetchCalls += 1
    return Promise.resolve()
  },
  removeMemberFromProjection: (id: string) => h.projectionRemovals.push(id),
}))

vi.mock('./sessionsStore', () => ({
  reloadActiveRoster: () => {
    h.rosterReloads += 1
    return Promise.resolve({ joined: h.joined, left: h.left })
  },
  getSessionsSnapshot: () => ({ selfId: h.selfId, roster: h.roster, activeSession: h.activeSession }),
  removeMemberFromRoster: (id: string) => {
    const m = h.roster.find((r) => r.userId === id) ?? null
    if (m) h.rosterRemovals.push(id)
    return m
  },
  endActiveSessionLocally: () => {
    h.endedLocally = true
  },
  refreshLitProblem: () => {
    h.litRefreshCalls += 1
    return Promise.resolve()
  },
}))

vi.mock('./sessionsTypes', () => ({
  memberLabel: (m: RosterMember) => m.displayName ?? m.handle ?? m.userId,
}))

vi.mock('./queueStore', () => ({
  refreshQueue: () => {
    h.queueRefreshCalls += 1
  },
}))

vi.mock('sonner', () => ({ toast: (msg: string) => h.toasts.push(msg) }))

vi.mock('../supabase/client', () => ({
  get supabase() {
    if (h.nullClient) return null
    return {
      auth: { getSession: () => Promise.resolve({ data: { session: h.session } }) },
      realtime: { setAuth: (t?: string) => h.setAuthCalls.push(t) },
      channel: (name: string, opts: FakeChannel['opts']) => {
        // One object carries both the recorded fields and the chained API, so the same
        // reference the module stores is what removeChannel() receives. Handlers are keyed by
        // broadcast event so the module can register several (ascents / member-joined / -left).
        const ch = { name, opts, subscribed: false, statusCb: null, handlers: {} } as FakeChannel & {
          on: (t: string, f: { event: string }, cb: FakeChannel['handlers'][string]) => typeof ch
          subscribe: (cb?: (status: string) => void) => typeof ch
        }
        ch.on = (_type, filter, cb) => {
          ch.handlers[filter.event] = cb
          return ch
        }
        // Mirror supabase's subscribe(status => …): store the status callback and fire the initial
        // SUBSCRIBED once (as the real client does on a successful join). Tests re-invoke statusCb
        // to simulate a reconnect (a second SUBSCRIBED after a drop).
        ch.subscribe = (cb) => {
          ch.subscribed = true
          ch.statusCb = cb ?? null
          cb?.('SUBSCRIBED')
          return ch
        }
        h.channels.push(ch)
        return ch
      },
      removeChannel: (ch: unknown) => h.removed.push(ch as FakeChannel),
    }
  },
  isConfigured: true,
}))

import { NUDGE_DEBOUNCE_MS, activateSessionRealtime } from './sessionRealtime'

/** Flush the getSession().then microtask chain that sets up the channel (and async handlers). */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** Fire a broadcast for the given event on the (only) open channel. */
function fire(event: string, payload?: { author?: string; user_id?: string }): void {
  h.channels[0].handlers[event]?.({ payload })
}

/** Re-invoke the subscribe status callback on the (only) open channel — simulates a reconnect. */
function fireStatus(status: string): void {
  h.channels[0].statusCb?.(status)
}

beforeEach(() => {
  vi.useFakeTimers()
  h.nullClient = false
  h.session = { access_token: 'tok', user: { id: 'self' } }
  h.channels = []
  h.removed = []
  h.setAuthCalls = []
  h.refetchCalls = 0
  h.rosterReloads = 0
  h.joined = []
  h.left = []
  h.roster = []
  h.rosterRemovals = []
  h.projectionRemovals = []
  h.activeSession = null
  h.endedLocally = false
  h.selfId = 'self'
  h.toasts = []
  h.queueRefreshCalls = 0
  h.litRefreshCalls = 0
})

afterEach(() => {
  activateSessionRealtime(null)
  vi.useRealTimers()
})

describe('sessionRealtime', () => {
  it('opens a private session:<id> channel, authorizes the socket, and subscribes', async () => {
    activateSessionRealtime('S1')
    await flush()
    expect(h.channels).toHaveLength(1)
    expect(h.channels[0].name).toBe('session:S1')
    expect(h.channels[0].opts.config?.private).toBe(true)
    expect(h.channels[0].subscribed).toBe(true)
    expect(h.setAuthCalls).toEqual(['tok'])
  })

  it('debounce-refetches once on a co-member nudge', async () => {
    activateSessionRealtime('S1')
    await flush()
    fire('ascents-changed', { author: 'other' })
    expect(h.refetchCalls).toBe(0) // debounced, not yet
    vi.advanceTimersByTime(NUDGE_DEBOUNCE_MS)
    expect(h.refetchCalls).toBe(1)
  })

  it('coalesces a burst of nudges into a single refetch', async () => {
    activateSessionRealtime('S1')
    await flush()
    fire('ascents-changed', { author: 'other' })
    fire('ascents-changed', { author: 'other' })
    fire('ascents-changed', { author: 'other' })
    vi.advanceTimersByTime(NUDGE_DEBOUNCE_MS)
    expect(h.refetchCalls).toBe(1)
  })

  it('skips our own send (self author) — no refetch', async () => {
    activateSessionRealtime('S1')
    await flush()
    fire('ascents-changed', { author: 'self' })
    vi.advanceTimersByTime(NUDGE_DEBOUNCE_MS)
    expect(h.refetchCalls).toBe(0)
  })

  it('tears down the channel on deactivate and does not leak on switch', async () => {
    activateSessionRealtime('S1')
    await flush()
    activateSessionRealtime('S2')
    await flush()
    // Previous channel removed; a fresh channel opened for S2.
    expect(h.removed).toHaveLength(1)
    expect(h.removed[0].name).toBe('session:S1')
    expect(h.channels).toHaveLength(2)
    expect(h.channels[1].name).toBe('session:S2')

    activateSessionRealtime(null)
    expect(h.removed).toHaveLength(2)
    expect(h.removed[1].name).toBe('session:S2')
  })

  it('is idempotent on the same id (no duplicate channel)', async () => {
    activateSessionRealtime('S1')
    await flush()
    activateSessionRealtime('S1')
    await flush()
    expect(h.channels).toHaveLength(1)
  })

  it('does not leak a channel on same-id re-activation with overlapping getSession', async () => {
    // S1 → null → S1 with two getSession() promises in flight. An id-based guard would let the
    // superseded first activation create a second, orphaned channel; the activation-token guard
    // must drop it so exactly one channel exists and it tears down cleanly.
    activateSessionRealtime('S1') // token 1, getSession #1 queued
    activateSessionRealtime(null) // token 2, teardown (no channel yet)
    activateSessionRealtime('S1') // token 3, getSession #2 queued
    await flush()
    expect(h.channels).toHaveLength(1)
    expect(h.channels[0].name).toBe('session:S1')
    activateSessionRealtime(null)
    expect(h.removed).toHaveLength(1) // the one real channel removed; no orphan left behind
  })

  it('no-ops when the client is unconfigured (pull-model fallback)', async () => {
    h.nullClient = true
    activateSessionRealtime('S1')
    await flush()
    expect(h.channels).toHaveLength(0)
    expect(h.refetchCalls).toBe(0)
  })

  it('does not skip when self id is unresolved (refetches to be safe)', async () => {
    h.session = null // no session → selfId stays null
    activateSessionRealtime('S1')
    await flush()
    fire('ascents-changed', { author: 'other' })
    vi.advanceTimersByTime(NUDGE_DEBOUNCE_MS)
    expect(h.refetchCalls).toBe(1)
  })

  it('member-joined reloads the roster and toasts the joiner by name', async () => {
    h.joined = [{ userId: 'other', displayName: 'Sofia', handle: null, avatarUrl: null, joinedAt: '' }]
    activateSessionRealtime('S1')
    await flush()
    fire('member-joined')
    await flush()
    expect(h.rosterReloads).toBe(1)
    expect(h.toasts).toEqual(['Sofia joined the session'])
    // The projection must refetch too, so the joiner's sent/tried status shows without a refresh.
    vi.advanceTimersByTime(NUDGE_DEBOUNCE_MS)
    expect(h.refetchCalls).toBe(1)
  })

  it('member-joined does not toast for our own join (still reloads the roster)', async () => {
    h.joined = [{ userId: 'self', displayName: 'Me', handle: null, avatarUrl: null, joinedAt: '' }]
    activateSessionRealtime('S1')
    await flush()
    fire('member-joined')
    await flush()
    expect(h.rosterReloads).toBe(1)
    expect(h.toasts).toEqual([])
  })

  it('member-left with a user_id removes the member instantly and toasts by name', async () => {
    // The optimistic path: the payload names the leaver, so their avatar is dropped from the
    // roster at once (before the reload round-trip) and the toast comes from the captured entry.
    h.roster = [{ userId: 'other', displayName: 'Bob', handle: null, avatarUrl: null, joinedAt: '' }]
    activateSessionRealtime('S1')
    await flush()
    fire('member-left', { user_id: 'other' })
    await flush()
    expect(h.rosterRemovals).toEqual(['other'])
    // Dropped from the projection in the same tick, so the sender pills don't ghost an initial.
    expect(h.projectionRemovals).toEqual(['other'])
    expect(h.toasts).toEqual(['Bob left the session'])
    // The projection refetches on a leave too, so the departed member's sends drop out.
    vi.advanceTimersByTime(NUDGE_DEBOUNCE_MS)
    expect(h.refetchCalls).toBe(1)
  })

  it('ends the session for me when I am the one removed (member-left about self, still active)', async () => {
    h.activeSession = { id: 'S1' } // still active → I was kicked (a voluntary leave already retired)
    activateSessionRealtime('S1')
    await flush()
    fire('member-left', { user_id: 'self' })
    await flush()
    expect(h.endedLocally).toBe(true)
    expect(h.toasts).toEqual(['You were removed from the session'])
    expect(h.rosterRemovals).toEqual([]) // returned early — no roster churn, no reload
    expect(h.rosterReloads).toBe(0)
  })

  it('ends the session for a member when the owner ends it (session-ended, still active)', async () => {
    h.activeSession = { id: 'S1' }
    activateSessionRealtime('S1')
    await flush()
    fire('session-ended')
    await flush()
    expect(h.endedLocally).toBe(true)
    expect(h.toasts).toEqual(['The session ended'])
  })

  it('session-ended is a no-op when already retired (the owner who ended it)', async () => {
    h.activeSession = null // owner's endSession already retired locally before this echo
    activateSessionRealtime('S1')
    await flush()
    fire('session-ended')
    await flush()
    expect(h.endedLocally).toBe(false)
    expect(h.toasts).toEqual([])
  })

  it('member-left with no payload falls back to the roster diff for the toast', async () => {
    h.left = [{ userId: 'other', displayName: 'Bob', handle: null, avatarUrl: null, joinedAt: '' }]
    activateSessionRealtime('S1')
    await flush()
    fire('member-left') // no payload → no optimistic removal; reconcile via the diff
    await flush()
    expect(h.rosterRemovals).toEqual([])
    expect(h.rosterReloads).toBe(1)
    expect(h.toasts).toEqual(['Bob left the session'])
  })

  it('does not toast our own departure', async () => {
    h.left = [{ userId: 'self', displayName: 'Me', handle: null, avatarUrl: null, joinedAt: '' }]
    activateSessionRealtime('S1')
    await flush()
    fire('member-left')
    await flush()
    expect(h.rosterReloads).toBe(1)
    expect(h.toasts).toEqual([])
  })

  it('refetches the queue on a queue-changed nudge', async () => {
    activateSessionRealtime('S1')
    await flush()
    fire('queue-changed')
    // refreshQueue is the store's own (internally-debounced) refetch; the module calls it directly
    // with no debounce of its own, so the nudge invokes it right away.
    expect(h.queueRefreshCalls).toBe(1)
  })

  it('refetches the lit pointer on a lit-changed nudge (#97)', async () => {
    activateSessionRealtime('S1')
    await flush()
    fire('lit-changed')
    // A narrow refetch (lit columns only) — no roster reload, no ascents refetch.
    expect(h.litRefreshCalls).toBe(1)
    expect(h.rosterReloads).toBe(0)
  })

  it('reconciles the queue on reconnect (a second SUBSCRIBED after a drop)', async () => {
    activateSessionRealtime('S1')
    await flush()
    // The initial SUBSCRIBED (fired by subscribe() on join) is not a reconnect — no refetch yet.
    expect(h.queueRefreshCalls).toBe(0)
    fireStatus('SUBSCRIBED') // socket recovered — a queue-changed nudge may have been missed (KTD5)
    expect(h.queueRefreshCalls).toBe(1)
  })
})
