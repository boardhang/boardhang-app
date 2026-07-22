import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Stateful supabase mock: a tiny server modeling the sessions RLS + the four RPCs. ──
const h = vi.hoisted(() => ({
  userId: 'user-A' as string | null,
  sessions: [] as Record<string, unknown>[],
  members: [] as { session_id: string; user_id: string; joined_at: string }[],
  profiles: [] as { id: string; handle: string; display_name: string }[],
  seq: 0,
  touched: [] as string[],
  selectCount: 0,
  clientNull: false,
  rpcError: false,
  litCalls: [] as { session: string; problem: string | null }[],
}))

function dayFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

vi.mock('../supabase/client', () => {
  function resolveQuery(table: string, steps: [string, ...unknown[]][]): { data: unknown; error: unknown } {
    const verb = steps.find((s) => ['insert', 'update', 'delete'].includes(s[0]))?.[0] ?? 'select'
    const now = new Date().toISOString()

    if (table === 'sessions') {
      if (verb === 'insert') {
        const p = steps.find((s) => s[0] === 'insert')![1] as Record<string, unknown>
        const id = `srv-${++h.seq}`
        const row = {
          id,
          owner_id: p.owner_id,
          name: p.name ?? '',
          board_layout_id: p.board_layout_id ?? 7,
          invite_token: `tok-${id}`,
          expires_at: dayFromNow(1),
          created_at: now,
          updated_at: now,
          deleted: false,
        }
        h.sessions.push(row)
        h.members.push({ session_id: id, user_id: row.owner_id as string, joined_at: now }) // owner-seat trigger
        return { data: row, error: null }
      }
      if (verb === 'update') {
        const patch = steps.find((s) => s[0] === 'update')![1] as Record<string, unknown>
        const id = steps.find((s) => s[0] === 'eq')?.[2] as string
        const row = h.sessions.find((r) => r.id === id)
        if (row) Object.assign(row, patch)
        return { data: null, error: null }
      }
      // select
      h.selectCount += 1
      const id = steps.find((s) => s[0] === 'eq')?.[2] as string
      const row = h.sessions.find((r) => r.id === id)
      return { data: row ? [row] : [], error: null }
    }

    if (table === 'session_members') {
      if (verb === 'delete') {
        const m = steps.find((s) => s[0] === 'match')![1] as { session_id: string; user_id: string }
        h.members = h.members.filter((x) => !(x.session_id === m.session_id && x.user_id === m.user_id))
        return { data: null, error: null }
      }
      const sid = steps.find((s) => s[0] === 'eq')?.[2] as string
      const rows = h.members.filter((x) => x.session_id === sid).map((x) => ({ user_id: x.user_id, joined_at: x.joined_at }))
      return { data: rows, error: null }
    }

    if (table === 'profiles') {
      const ids = (steps.find((s) => s[0] === 'in')?.[2] as string[]) ?? []
      return { data: h.profiles.filter((p) => ids.includes(p.id)), error: null }
    }
    return { data: null, error: null }
  }

  function makeBuilder(table: string) {
    const steps: [string, ...unknown[]][] = []
    const b: Record<string, unknown> = {}
    for (const m of ['insert', 'update', 'delete', 'select', 'eq', 'in', 'match', 'limit', 'single']) {
      b[m] = (...args: unknown[]) => {
        steps.push([m, ...args])
        return b
      }
    }
    b.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
      try {
        res(resolveQuery(table, steps))
      } catch (e) {
        rej?.(e)
      }
    }
    return b
  }

  function rpc(name: string, args: Record<string, unknown>) {
    const run = (): { data: unknown; error: unknown } => {
      if (name === 'join_session_by_token') {
        const s = h.sessions.find(
          (x) => x.invite_token === args.token && !x.deleted && Date.parse(x.expires_at as string) > Date.now(),
        )
        if (!s) return { data: null, error: { message: 'session not found, ended, or expired' } }
        if (!h.members.some((m) => m.session_id === s.id && m.user_id === h.userId))
          h.members.push({ session_id: s.id as string, user_id: h.userId as string, joined_at: new Date().toISOString() })
        s.expires_at = dayFromNow(1)
        const { invite_token: _omit, ...rest } = s // RPC returns the row WITHOUT invite_token
        return { data: [rest], error: null }
      }
      if (name === 'session_invite_token') {
        const s = h.sessions.find((x) => x.id === args.p_session_id)
        return s ? { data: s.invite_token, error: null } : { data: null, error: { message: 'not a member' } }
      }
      if (name === 'touch_session') {
        h.touched.push(args.p_session_id as string)
        const s = h.sessions.find((x) => x.id === args.p_session_id)
        if (s) s.expires_at = dayFromNow(1)
        return { data: null, error: null }
      }
      if (name === 'set_session_lit_problem') {
        // Mirrors 0017: pins attribution server-side; null clears all three columns.
        h.litCalls.push({ session: args.p_session_id as string, problem: args.p_problem_id as string | null })
        const s = h.sessions.find((x) => x.id === args.p_session_id)
        if (s) {
          const clear = args.p_problem_id == null
          s.lit_problem_id = clear ? null : args.p_problem_id
          s.lit_by = clear ? null : h.userId
          s.lit_at = clear ? null : new Date().toISOString()
        }
        return { data: null, error: null }
      }
      if (name === 'list_my_live_sessions') {
        if (h.rpcError) return { data: null, error: { message: 'boom' } }
        const now = Date.now()
        const rows = h.sessions
          .filter(
            (s) =>
              !s.deleted &&
              Date.parse(s.expires_at as string) > now &&
              h.members.some((m) => m.session_id === s.id && m.user_id === h.userId),
          )
          .sort((a, b) => Date.parse(b.expires_at as string) - Date.parse(a.expires_at as string))
          .map(({ invite_token: _omit, ...rest }) => rest) // RPC never returns invite_token
        return { data: rows, error: null }
      }
      return { data: null, error: null }
    }
    return { then: (res: (v: unknown) => void) => res(run()) }
  }

  const client = {
    from: (t: string) => makeBuilder(t),
    rpc,
    auth: {
      getSession: async () => ({ data: { session: h.userId ? { user: { id: h.userId } } : null } }),
    },
  }
  return {
    get supabase() {
      return h.clientNull ? null : client
    },
    isConfigured: true,
  }
})

import {
  clearSessionsCache,
  createSession,
  endActiveSessionLocally,
  endSession,
  getInviteToken,
  getSessionsSnapshot,
  initSessions,
  joinSession,
  leaveSession,
  listMyLiveSessions,
  reportProblemLit,
  refreshLitProblem,
  resumeSession,
  refreshActiveSession,
  reloadActiveRoster,
  removeMemberFromRoster,
  renameSession,
  setMemberStatus,
  syncSessionsIdentity,
} from './sessionsStore'
import { SESSION_COLUMNS, fromSessionRow, type Session } from './sessionsTypes'

const ACTIVE_KEY = 'sessionsActive'

beforeEach(() => {
  localStorage.clear()
  h.userId = 'user-A'
  h.sessions = []
  h.members = []
  h.profiles = []
  h.seq = 0
  h.touched = []
  h.selectCount = 0
  h.clientNull = false
  h.rpcError = false
  h.litCalls = []
  clearSessionsCache() // reset in-memory module state
  localStorage.clear() // clearSessionsCache may have re-touched keys
})

describe('sessionsStore', () => {
  it('createSession activates the session and persists the pointer', async () => {
    const s = await createSession(7, 'Test crew')
    expect(getSessionsSnapshot().activeSession?.id).toBe(s.id)
    const persisted = JSON.parse(localStorage.getItem(ACTIVE_KEY)!)
    expect(persisted.id).toBe(s.id)
    // KTD-7: the persisted pointer must never carry the invite_token.
    expect(persisted).not.toHaveProperty('invite_token')
    expect(localStorage.getItem(ACTIVE_KEY)).not.toContain('tok-')
  })

  it('SESSION_COLUMNS never includes invite_token', () => {
    expect(SESSION_COLUMNS).not.toContain('invite_token')
  })

  it('joinSession activates on success and getInviteToken uses the RPC (never persisted)', async () => {
    h.sessions.push({
      id: 'S1',
      owner_id: 'owner-x',
      name: 'Crew',
      board_layout_id: 7,
      invite_token: 'tok-join',
      expires_at: dayFromNow(1),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    })
    const s = await joinSession('tok-join')
    expect(s.id).toBe('S1')
    expect(getSessionsSnapshot().activeSession?.id).toBe('S1')
    // No volatile token from a join → getInviteToken must hit the RPC.
    expect(await getInviteToken()).toBe('tok-join')
    expect(localStorage.getItem(ACTIVE_KEY)).not.toContain('tok-join')
  })

  it('joinSession on an invalid token surfaces the error and leaves no active session', async () => {
    await expect(joinSession('nope')).rejects.toThrow()
    expect(getSessionsSnapshot().activeSession).toBeNull()
  })

  it('leaveSession clears the active pointer and removes persisted entries', async () => {
    const s = await createSession(7, 'Crew')
    setMemberStatus('user-A', ['sent'])
    expect(localStorage.getItem(`sessionMemberStatus:${s.id}`)).toBeTruthy()
    await leaveSession()
    expect(getSessionsSnapshot().activeSession).toBeNull()
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
    expect(localStorage.getItem(`sessionMemberStatus:${s.id}`)).toBeNull()
  })

  it('renameSession trims/caps the name and bumps expiry via touch_session', async () => {
    const s = await createSession(7, 'Crew')
    await renameSession('x'.repeat(80))
    expect(getSessionsSnapshot().activeSession?.name).toHaveLength(60)
    expect(h.touched).toContain(s.id)
  })

  it('manual refreshActiveSession bumps expiry via touch_session', async () => {
    const s = await createSession(7, 'Crew')
    h.touched = []
    await refreshActiveSession({ manual: true })
    expect(h.touched).toContain(s.id)
  })

  it('refreshActiveSession retires a server-expired session', async () => {
    const s = await createSession(7, 'Crew')
    h.sessions.find((r) => r.id === s.id)!.expires_at = dayFromNow(-1) // server says expired
    const { live } = await refreshActiveSession()
    expect(live).toBe(false)
    expect(getSessionsSnapshot().activeSession).toBeNull()
  })

  it('initSessions retires a locally-expired cached session with no network call', () => {
    localStorage.setItem(
      ACTIVE_KEY,
      JSON.stringify({
        id: 'OLD',
        ownerId: 'user-A',
        name: 'Stale',
        boardLayoutId: 7,
        expiresAt: dayFromNow(-1),
        createdAt: dayFromNow(-2),
        updatedAt: dayFromNow(-2),
        deleted: false,
      }),
    )
    h.selectCount = 0
    initSessions()
    expect(getSessionsSnapshot().activeSession).toBeNull()
    expect(h.selectCount).toBe(0) // offline retirement — no fetch
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
  })

  it('memberStatus survives a reload (rehydrated from localStorage)', async () => {
    const s = await createSession(7, 'Crew')
    setMemberStatus('user-A', ['sent', 'attempted'])
    setMemberStatus('user-B', ['unlogged'])
    // Simulate a reload: re-init from storage (session still live).
    initSessions()
    expect(getSessionsSnapshot().activeSession?.id).toBe(s.id)
    expect(getSessionsSnapshot().memberStatus).toEqual({
      'user-A': ['sent', 'attempted'],
      'user-B': ['unlogged'],
    })
  })

  it('identity switch clears the session; same-user restore preserves it', async () => {
    syncSessionsIdentity('user-A')
    await createSession(7, 'Crew')
    expect(getSessionsSnapshot().activeSession).not.toBeNull()

    syncSessionsIdentity('user-A') // same user — no clear
    expect(getSessionsSnapshot().activeSession).not.toBeNull()

    syncSessionsIdentity('user-B') // different user — clears
    expect(getSessionsSnapshot().activeSession).toBeNull()
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
  })

  it('no-ops gracefully when supabase is unconfigured', async () => {
    h.clientNull = true
    await expect(createSession(7)).rejects.toThrow()
    await expect(leaveSession()).resolves.toBeUndefined()
    expect(() => initSessions()).not.toThrow()
  })

  it('endSession soft-deletes the session server-side and retires it locally', async () => {
    const s = await createSession(7, 'Crew')
    await endSession()
    expect(getSessionsSnapshot().activeSession).toBeNull() // retired locally
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
    expect(h.sessions.find((r) => r.id === s.id)?.deleted).toBe(true) // soft-deleted server-side
  })

  it('endActiveSessionLocally retires without mutating the server row', async () => {
    const s = await createSession(7, 'Crew')
    endActiveSessionLocally()
    expect(getSessionsSnapshot().activeSession).toBeNull()
    expect(h.sessions.find((r) => r.id === s.id)?.deleted).toBeFalsy() // no server call
  })

  it('reloadActiveRoster returns the joined/left delta vs the previous roster', async () => {
    const s = await createSession(7, 'Crew') // owner user-A seated
    await reloadActiveRoster() // establish roster = [user-A]
    h.members.push({ session_id: s.id, user_id: 'user-B', joined_at: new Date().toISOString() })
    const afterJoin = await reloadActiveRoster()
    expect(afterJoin.joined.map((m) => m.userId)).toEqual(['user-B'])
    expect(afterJoin.left).toEqual([])
    h.members = h.members.filter((m) => m.user_id !== 'user-B')
    const afterLeave = await reloadActiveRoster()
    expect(afterLeave.left.map((m) => m.userId)).toEqual(['user-B'])
    expect(afterLeave.joined).toEqual([])
  })

  it('removeMemberFromRoster drops a member and returns them; no-op for an unknown id', async () => {
    const s = await createSession(7, 'Crew')
    h.members.push({ session_id: s.id, user_id: 'user-B', joined_at: new Date().toISOString() })
    await reloadActiveRoster() // roster = [user-A, user-B]
    const gone = removeMemberFromRoster('user-B')
    expect(gone?.userId).toBe('user-B')
    expect(getSessionsSnapshot().roster.map((m) => m.userId)).not.toContain('user-B')
    expect(removeMemberFromRoster('nope')).toBeNull()
  })

  // ── U2: cross-device resume — listMyLiveSessions + resumeSession ──

  /** Seed a live server session that user-A is a member of, and return the client-shaped
   *  Session candidate (as listMyLiveSessions would yield — camelCase, no invite_token). */
  function seedLiveForA(overrides: Record<string, unknown> = {}): Session {
    const id = (overrides.id as string) ?? `S-${++h.seq}`
    const now = new Date().toISOString()
    const row = {
      owner_id: 'user-A',
      name: 'Crew',
      board_layout_id: 7,
      invite_token: `tok-${id}`,
      expires_at: dayFromNow(1),
      created_at: now,
      updated_at: now,
      deleted: false,
      ...overrides,
      id, // computed above (overrides.id ?? generated); wins over any spread id
    }
    h.sessions.push(row)
    h.members.push({ session_id: id, user_id: 'user-A', joined_at: now })
    return fromSessionRow(row as never)
  }

  it('listMyLiveSessions returns the caller live sessions as camelCase Sessions, no invite_token', async () => {
    seedLiveForA({ id: 'S-live' })
    // A session A is not a member of — must be excluded by the RPC's membership gate.
    h.sessions.push({
      id: 'S-notmine', owner_id: 'other', name: 'x', board_layout_id: 7, invite_token: 't',
      expires_at: dayFromNow(1), created_at: '', updated_at: '', deleted: false,
    })
    const list = await listMyLiveSessions()
    expect(list.map((s) => s.id)).toEqual(['S-live'])
    expect(list[0]).toMatchObject({ boardLayoutId: 7, ownerId: 'user-A' })
    expect(list[0]).not.toHaveProperty('invite_token')
  })

  it('listMyLiveSessions returns [] on RPC error', async () => {
    seedLiveForA()
    h.rpcError = true
    expect(await listMyLiveSessions()).toEqual([])
  })

  it('listMyLiveSessions returns [] when the client is unconfigured', async () => {
    h.clientNull = true
    expect(await listMyLiveSessions()).toEqual([])
  })

  it('resumeSession adopts a live session: active + persisted pointer + { live: true }', async () => {
    const candidate = seedLiveForA({ id: 'S-resume' })
    localStorage.setItem('sessionMemberStatus:S-resume', JSON.stringify({ 'user-A': ['sent'] }))
    const res = await resumeSession(candidate)
    expect(res).toEqual({ live: true })
    expect(getSessionsSnapshot().activeSession?.id).toBe('S-resume')
    expect(JSON.parse(localStorage.getItem(ACTIVE_KEY)!).id).toBe('S-resume')
    // Seeds memberStatus from localStorage for that session id (R3).
    expect(getSessionsSnapshot().memberStatus).toEqual({ 'user-A': ['sent'] })
    // KTD-7: the persisted pointer never carries the invite_token.
    expect(localStorage.getItem(ACTIVE_KEY)).not.toContain('tok-')
  })

  it('resumeSession does not bump expiry (never calls touch_session) — R4', async () => {
    const candidate = seedLiveForA({ id: 'S-notouch' })
    await resumeSession(candidate)
    expect(h.touched).toEqual([])
  })

  it('resumeSession on a dead-on-arrival session returns { live: false } and leaves no active session', async () => {
    const candidate = seedLiveForA({ id: 'S-dead' })
    // The session ended between list and tap: server row now soft-deleted. The candidate itself is
    // not locally expired, so resume adopts then the reconcile retires it.
    h.sessions.find((s) => s.id === 'S-dead')!.deleted = true
    const res = await resumeSession(candidate)
    expect(res).toEqual({ live: false })
    expect(getSessionsSnapshot().activeSession).toBeNull()
  })

  it('resumeSession on a locally-expired session is a no-op — { live: false }, no server read', async () => {
    const candidate = seedLiveForA({ id: 'S-old' })
    const stale = { ...candidate, expiresAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }
    h.selectCount = 0
    const res = await resumeSession(stale)
    expect(res).toEqual({ live: false })
    expect(getSessionsSnapshot().activeSession).toBeNull()
    expect(h.selectCount).toBe(0) // short-circuited before any server reconcile
  })
})

describe('sessionsStore — "now on the wall" (issue #97)', () => {
  it('reportProblemLit no-ops without an active session or on a board mismatch', async () => {
    await reportProblemLit(7, 'p1') // no active session
    expect(h.litCalls).toEqual([])

    await createSession(7)
    await reportProblemLit(99, 'p1') // active session targets board 7, not 99
    expect(h.litCalls).toEqual([])
    expect(getSessionsSnapshot().activeSession?.litProblemId ?? null).toBeNull()
  })

  it('reportProblemLit sets optimistically, calls the RPC, and persists the pointer', async () => {
    const s = await createSession(7)
    await reportProblemLit(7, 'prob-9')
    const active = getSessionsSnapshot().activeSession!
    expect(active.litProblemId).toBe('prob-9')
    expect(active.litBy).toBe('user-A') // optimistic echo of the server pin
    expect(h.litCalls).toEqual([{ session: s.id, problem: 'prob-9' }])
    // Survives reload: the persisted pointer carries the lit fields.
    const persisted = JSON.parse(localStorage.getItem(ACTIVE_KEY)!)
    expect(persisted.litProblemId).toBe('prob-9')
  })

  it('refreshLitProblem merges the server pointer (a co-member lit something)', async () => {
    const s = await createSession(7)
    const row = h.sessions.find((r) => r.id === s.id)!
    row.lit_problem_id = 'from-server'
    row.lit_by = 'user-B'
    row.lit_at = new Date().toISOString()
    await refreshLitProblem()
    const active = getSessionsSnapshot().activeSession!
    expect(active.litProblemId).toBe('from-server')
    expect(active.litBy).toBe('user-B')
  })

  it('joinSession pulls the current lit pointer (join RPC shape predates 0017)', async () => {
    // A session created by another user with a lit problem already recorded server-side.
    const now = new Date().toISOString()
    h.sessions.push({
      id: 'S-lit',
      owner_id: 'user-B',
      name: 'crew',
      board_layout_id: 7,
      invite_token: 'tok-lit',
      expires_at: dayFromNow(1),
      created_at: now,
      updated_at: now,
      deleted: false,
      lit_problem_id: 'already-lit',
      lit_by: 'user-B',
      lit_at: now,
    })
    await joinSession('tok-lit')
    // joinSession fires refreshLitProblem without awaiting it; let it settle.
    await new Promise((r) => setTimeout(r, 0))
    expect(getSessionsSnapshot().activeSession?.litProblemId).toBe('already-lit')
  })
})
