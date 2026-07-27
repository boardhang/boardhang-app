// Reactive "active collaboration session" store. Mirrors listsStore.ts: module-level
// state + a listener Set + useSyncExternalStore, snake_case ↔ camelCase mapping, and a
// signed-out/unconfigured (`if (!supabase)`) guard. Unlike lists there is NO IndexedDB
// sync spine — a session is device-local, cloud-authoritative, and small. What persists to
// localStorage is only (a) the active-session pointer (the whole row, so expiry can be
// judged offline — KTD-12) and (b) per-member chip selections keyed by session id (R14/
// KTD-4). The share `invite_token` NEVER persists (KTD-7): it lives in volatile memory
// (creator path) or is re-fetched on demand via the session_invite_token RPC.
//
// Liveness truth is the server (the RPCs refuse a dead session — KTD-12); the client's
// expires_at check is only a soft hint with a skew margin, used to drop a clearly-expired
// session offline so a never-refetching tab doesn't present it as active forever.

import { useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'
import { avatarPublicUrl } from '../auth/avatarStorage'
import type { StatusKey } from '../catalog/filters'
import {
  SESSION_COLUMNS,
  fromSessionMemberRow,
  fromSessionRow,
  trimSessionName,
  type MemberStatus,
  type Session,
  type SessionMember,
  type SessionRow,
} from './sessionsTypes'

export type SessionsStatus = 'idle' | 'loading' | 'active' | 'error'

export interface SessionsState {
  status: SessionsStatus
  /** The device's active session, or null when not in one. */
  activeSession: Session | null
  /** Roster of the active session (display-only; the filtered member set comes from the
   *  projection snapshot in U3, not from here). */
  roster: SessionMember[]
  /** Per-member chip selections for the active session (R3/R14). */
  memberStatus: MemberStatus
  /** The signed-in user's id — identifies the self ("You") member row (R5). */
  selfId: string | null
  error: string | null
}

let state: SessionsState = {
  status: 'idle',
  activeSession: null,
  roster: [],
  memberStatus: {},
  selfId: null,
  error: null,
}
const listeners = new Set<() => void>()

// Identity-switch guard (mirrors listsSync's cacheGeneration): bumped on every clear so a
// late roster/refresh resolving after a sign-out or user switch can't write stale data back.
let generation = 0

// Volatile-only invite tokens (KTD-7): the creator holds one transiently from the insert
// RETURNING; anyone else re-fetches on demand. NEVER written to localStorage.
const volatileTokens: Record<string, string> = {}

/** Soft-hint skew margin (KTD-12): only retire locally when clearly past expiry, so a wrong
 *  device clock can't drop a still-live session. */
const EXPIRY_SKEW_MS = 60_000

const ACTIVE_KEY = 'sessionsActive'
const MEMBER_STATUS_PREFIX = 'sessionMemberStatus:'
const LAST_USER_KEY = 'sessionsLastUserId'

function setState(next: Partial<SessionsState>): void {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

function isLocallyExpired(session: Session): boolean {
  return Date.now() > Date.parse(session.expiresAt) + EXPIRY_SKEW_MS
}

/** Resolve + cache the signed-in user id (identifies the self member row). Best-effort. */
async function ensureSelfId(): Promise<void> {
  if (state.selfId) return
  const id = await currentUserId()
  if (id && !state.selfId) setState({ selfId: id })
}

// ─── Persistence (localStorage; best-effort, private-mode safe) ───────────────

function persistActive(session: Session | null): void {
  try {
    if (session) localStorage.setItem(ACTIVE_KEY, JSON.stringify(session))
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Private mode / quota — the pointer is a convenience, not correctness.
  }
}

function readPersistedActive(): Session | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}

function persistMemberStatus(sessionId: string, ms: MemberStatus): void {
  try {
    localStorage.setItem(MEMBER_STATUS_PREFIX + sessionId, JSON.stringify(ms))
  } catch {
    /* best-effort */
  }
}

// ─── Pending exits (a leave / end whose server call never landed) ─────────────
//
// Retiring a session locally after a failed leave is not the whole story: the membership row
// survives, so the crew still sees the user's status and the session comes back under "Resume
// session" — where tapping it re-adds the very board they removed. Queue the unfinished exit
// and retry it on app start and on reconnect, so the user's decision sticks.

/** A leave/end that still owes the server a write. Keyed per user: on a shared device, user B
 *  must never "retry" (and thereby silently drop) user A's revocation. `queuedAt` bounds how
 *  long the intent stays valid — see the TTL below. */
interface PendingExit {
  sessionId: string
  intent: 'ended' | 'left'
  userId: string
  queuedAt: string
}

const PENDING_EXIT_KEY = 'sessionsPendingExit'
/** A self-heal queue, not an audit log — bound it. */
const MAX_PENDING_EXITS = 5
/**
 * An unfinished exit is only worth replaying while the session it targets could still be live.
 * Past the server's 24h backstop the row is gone anyway, and a stale entry becomes a hazard
 * rather than a repair: `ended` is destructive and the queue must never outlive the decision
 * that justified it.
 */
const PENDING_EXIT_TTL_MS = 24 * 60 * 60 * 1000

function isPendingExit(v: unknown): v is PendingExit {
  const p = v as Partial<PendingExit> | null
  return (
    !!p &&
    typeof p.sessionId === 'string' &&
    typeof p.userId === 'string' &&
    (p.intent === 'ended' || p.intent === 'left') &&
    typeof p.queuedAt === 'string'
  )
}

function readPendingExits(): PendingExit[] {
  try {
    const raw = localStorage.getItem(PENDING_EXIT_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(list)) return []
    // Shape-check every entry (this key is user-writable) and drop anything past its TTL.
    const fresh = Date.now() - PENDING_EXIT_TTL_MS
    return list.filter((p) => isPendingExit(p) && Date.parse(p.queuedAt) > fresh)
  } catch {
    return []
  }
}

function writePendingExits(list: PendingExit[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(PENDING_EXIT_KEY)
    else localStorage.setItem(PENDING_EXIT_KEY, JSON.stringify(list))
  } catch {
    /* best-effort — the retry is a nicety, expiry is the real backstop */
  }
}

function rememberPendingExit(sessionId: string, intent: 'ended' | 'left', userId: string): void {
  if (!userId) return // can't scope it to anyone; expiry remains the backstop
  const rest = readPendingExits().filter((p) => !(p.sessionId === sessionId && p.userId === userId))
  writePendingExits(
    capPerUser([{ sessionId, intent, userId, queuedAt: new Date().toISOString() }, ...rest]),
  )
}

/** Keep the newest `MAX_PENDING_EXITS` per user. Capping the list globally would let one
 *  account's queue evict another account's revocation — the silent drop the per-user keying
 *  exists to prevent. Order is newest-first, so a plain running count does it. */
function capPerUser(list: PendingExit[]): PendingExit[] {
  const kept = new Map<string, number>()
  return list.filter((p) => {
    const n = (kept.get(p.userId) ?? 0) + 1
    kept.set(p.userId, n)
    return n <= MAX_PENDING_EXITS
  })
}

/**
 * Cancel a queued exit because the user deliberately re-entered that session (join / resume).
 * Without this the queue outlives the intent: a failed end, then a resume, then an app start,
 * and the retry soft-deletes a session the user is actively climbing in. Only explicit re-entry
 * cancels — NOT `setActiveSession`, which a background refresh also calls and which would
 * quietly discard an exit the user still wants.
 */
function forgetPendingExit(sessionId: string): void {
  const queued = readPendingExits()
  const rest = queued.filter((p) => p.sessionId !== sessionId)
  if (rest.length !== queued.length) writePendingExits(rest)
}

// One pass at a time: initSessions' fire-and-forget call and an `online` event moments later
// would otherwise both read the same queue and race their writes.
let retryingExits = false

/**
 * Finish the exits whose server call failed. Idempotent and best-effort: a still-failing entry
 * stays queued, an entry belonging to another user is left for that user, and an `ended` retry
 * for a session that has since expired simply matches no rows. Called on app start and from the
 * `online` listener wired in `initSessions`.
 */
export async function retryPendingExits(): Promise<void> {
  if (!supabase || retryingExits) return
  const queued = readPendingExits()
  if (queued.length === 0) {
    writePendingExits([]) // prune whatever the read just filtered out (expired / malformed)
    return
  }
  retryingExits = true
  try {
    const userId = await currentUserId()
    if (!userId) return // signed out — keep the queue for their next sign-in
    const remaining: PendingExit[] = []
    for (const p of queued) {
      if (p.userId !== userId) {
        remaining.push(p)
        continue
      }
      const { error } =
        p.intent === 'ended'
          ? await supabase.from('sessions').update({ deleted: true }).eq('id', p.sessionId)
          : await supabase
              .from('session_members')
              .delete()
              .match({ session_id: p.sessionId, user_id: userId })
      if (error) {
        remaining.push(p)
      } else if (state.activeSession?.id === p.sessionId) {
        // The exit finally landed for a session this device still shows (a failed leave from
        // SessionBar leaves it active) — stop presenting a session we just left/ended.
        retire(p.sessionId)
      }
    }
    // Merge rather than overwrite: an exit queued DURING this pass (a second removal failing,
    // or another tab) must not be erased by a write computed from the stale snapshot.
    const handled = new Set(queued.map((p) => `${p.sessionId}::${p.userId}`))
    const added = readPendingExits().filter((p) => !handled.has(`${p.sessionId}::${p.userId}`))
    writePendingExits(capPerUser([...added, ...remaining]))
  } finally {
    retryingExits = false
  }
}

function readMemberStatus(sessionId: string): MemberStatus {
  try {
    const raw = localStorage.getItem(MEMBER_STATUS_PREFIX + sessionId)
    return raw ? (JSON.parse(raw) as MemberStatus) : {}
  } catch {
    return {}
  }
}

function removeSessionStorage(sessionId: string): void {
  try {
    localStorage.removeItem(ACTIVE_KEY)
    localStorage.removeItem(MEMBER_STATUS_PREFIX + sessionId)
  } catch {
    /* best-effort */
  }
}

/** Remove every per-session localStorage entry (identity switch / full clear). */
function removeAllSessionStorage(): void {
  try {
    localStorage.removeItem(ACTIVE_KEY)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith(MEMBER_STATUS_PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    /* best-effort */
  }
}

// ─── Internal transitions ─────────────────────────────────────────────────────

function setActiveSession(session: Session): void {
  setState({ status: 'active', activeSession: session, error: null })
  persistActive(session)
}

/** Drop the active session locally (leave / end / expiry / removal). Clears in-memory
 *  state + this session's persisted pointer and chip map + its volatile token. */
function retire(sessionId: string): void {
  delete volatileTokens[sessionId]
  removeSessionStorage(sessionId)
  if (state.activeSession?.id === sessionId) {
    setState({ status: 'idle', activeSession: null, roster: [], memberStatus: {}, error: null })
  }
}

// ─── Roster (display-only; batch profiles fetch, KTD-9) ───────────────────────

async function loadRoster(session: Session, gen: number): Promise<void> {
  if (!supabase) return
  const { data: memberRows, error } = await supabase
    .from('session_members')
    .select('user_id, joined_at')
    .eq('session_id', session.id)
  if (error || !memberRows) return
  const rows = memberRows as { user_id: string; joined_at: string }[]
  const ids = rows.map((r) => r.user_id)

  const profilesById: Record<
    string,
    { handle: string; displayName: string; avatarUrl: string | null }
  > = {}
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, handle, display_name, avatar_url')
      .in('id', ids)
    for (const p of (profs ?? []) as {
      id: string
      handle: string
      display_name: string
      avatar_url: string | null
    }[]) {
      // avatar_url stores an in-bucket object path (0009); derive the public URL to render.
      profilesById[p.id] = {
        handle: p.handle,
        displayName: p.display_name,
        avatarUrl: avatarPublicUrl(p.avatar_url),
      }
    }
  }
  // Identity switched (or session retired) while the roster was in flight — drop the result.
  if (gen !== generation || state.activeSession?.id !== session.id) return
  const roster = rows.map((r) =>
    fromSessionMemberRow(
      { session_id: session.id, user_id: r.user_id, joined_at: r.joined_at },
      profilesById[r.user_id] ?? null,
    ),
  )
  setState({ roster })
}

/**
 * Reload the active session's roster in response to a realtime membership nudge (0013) — drives
 * the live member avatars in SessionBar. Returns the delta vs the previous roster: `joined` are
 * new entries (for a "joined" toast), `left` are entries that disappeared (for a "left" toast —
 * captured from the OLD roster, since they're gone from the reloaded one). Both empty when there
 * is no active session.
 */
export async function reloadActiveRoster(): Promise<{ joined: SessionMember[]; left: SessionMember[] }> {
  const active = state.activeSession
  if (!active) return { joined: [], left: [] }
  const before = state.roster
  const beforeIds = new Set(before.map((m) => m.userId))
  await loadRoster(active, generation)
  const afterIds = new Set(state.roster.map((m) => m.userId))
  return {
    joined: state.roster.filter((m) => !beforeIds.has(m.userId)),
    left: before.filter((m) => !afterIds.has(m.userId)),
  }
}

/**
 * Optimistically drop a member from the active roster on a realtime member-left nudge, so their
 * avatar disappears instantly instead of lingering for the reloadActiveRoster round-trip.
 * Idempotent; reloadActiveRoster reconciles with the server right after. Returns the removed
 * member (for a "left" toast), or null if they weren't in the roster.
 */
export function removeMemberFromRoster(userId: string): SessionMember | null {
  const gone = state.roster.find((m) => m.userId === userId)
  if (!gone) return null
  setState({ roster: state.roster.filter((m) => m.userId !== userId) })
  return gone
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Rehydrate the active session from localStorage on app start (call once, e.g. from
 * AppLayout). A cached session already clearly past its expiry is retired locally with NO
 * network call (offline path, KTD-12); otherwise it is shown immediately and a best-effort
 * refresh reconciles it with the server + loads the roster.
 */
export function initSessions(): void {
  wireWindowSync()
  void retryPendingExits()
  const cached = readPersistedActive()
  if (!cached) {
    setState({ status: 'idle', activeSession: null, roster: [], memberStatus: {}, error: null })
    return
  }
  if (isLocallyExpired(cached)) {
    retire(cached.id)
    return
  }
  setState({ status: 'active', activeSession: cached, memberStatus: readMemberStatus(cached.id) })
  void ensureSelfId()
  void refreshActiveSession()
}

let windowSyncWired = false

/**
 * Follow the active-session pointer across tabs, and finish pending exits on reconnect.
 *
 * `boardStore` already re-reads its added/active boards on the cross-tab `storage` event; until
 * this store did the same, one tab could hold a session on a board another tab had removed —
 * the exact contradiction the board-removal exit exists to prevent. It also means the tab that
 * did not initiate a leave retires from the local write rather than from the realtime
 * member-left echo, so a self-service exit is no longer reported to the user as a kick.
 *
 * `storage` fires only in the OTHER tabs, never the writer, so this never re-handles our own
 * write. A same-id event (the lit-problem pointer re-persisting) is deliberately ignored — the
 * in-memory session is fresher than the pointer.
 */
function wireWindowSync(): void {
  if (windowSyncWired || typeof window === 'undefined') return
  windowSyncWired = true
  window.addEventListener('storage', (e) => {
    // `key` is null when another tab called localStorage.clear() — treat that as "re-read".
    if (e.key !== null && e.key !== ACTIVE_KEY) return
    const next = readPersistedActive()
    const current = state.activeSession
    if (!next) {
      if (current) retire(current.id)
      return
    }
    if (!current || current.id !== next.id) {
      // Adopt on the same terms as initSessions — a pointer is never treated as live without
      // the local expiry check and a server reconcile (refreshActiveSession loads the roster on
      // success and retires a deleted/expired/unreadable row, so the adopt fails closed).
      if (isLocallyExpired(next)) {
        retire(next.id)
        return
      }
      setState({
        status: 'active',
        activeSession: next,
        roster: [],
        memberStatus: readMemberStatus(next.id),
        error: null,
      })
      void ensureSelfId()
      void refreshActiveSession()
    }
  })
  window.addEventListener('online', () => void retryPendingExits())
}

/**
 * Create a board-bound session and make it active. Sets `owner_id` for the RLS WITH CHECK;
 * the owner-seat trigger seats the creator. Captures `invite_token` from the insert
 * RETURNING into volatile memory ONLY (KTD-7) — it never enters SESSION_COLUMNS or the
 * persisted pointer. Requires a configured, signed-in client (creation needs the server row).
 */
export async function createSession(boardLayoutId: number, name = ''): Promise<Session> {
  const gen = generation
  if (!supabase) throw new Error('Sign-in isn’t set up in this build.')
  const userId = await currentUserId()
  if (!userId) throw new Error('You need to be signed in to start a session.')
  setState({ selfId: userId })

  const { data, error } = await supabase
    .from('sessions')
    .insert({ owner_id: userId, name: trimSessionName(name), board_layout_id: boardLayoutId })
    .select(`${SESSION_COLUMNS}, invite_token`) // one transient read that includes the secret
    .single()
  if (error) throw new Error(error.message)

  const row = data as SessionRow & { invite_token: string }
  const session = fromSessionRow(row)
  volatileTokens[session.id] = row.invite_token // volatile only — never persisted
  if (gen !== generation) return session // identity switched mid-create; don't activate
  setActiveSession(session)
  setState({ memberStatus: {} })
  void loadRoster(session, gen)
  return session
}

/**
 * Join a session by its invite token (KTD-3). The `join_session_by_token` RPC seats the
 * caller, bumps expiry, and returns the session row WITHOUT `invite_token`. On any RPC error
 * (unknown / ended / expired token) this throws and leaves no active session.
 */
export async function joinSession(token: string): Promise<Session> {
  const gen = generation
  if (!supabase) throw new Error('Sign-in isn’t set up in this build.')
  const { data, error } = await supabase.rpc('join_session_by_token', { token })
  if (error) throw new Error(error.message)
  const row = (data as SessionRow[] | null)?.[0]
  if (!row) throw new Error('That session link is no longer valid.')
  const session = fromSessionRow(row)
  if (gen !== generation) return session
  forgetPendingExit(session.id) // re-joining supersedes any unfinished exit for this session
  setActiveSession(session)
  setState({ memberStatus: readMemberStatus(session.id) })
  void ensureSelfId()
  void loadRoster(session, gen)
  // The join RPC's return shape (0007) predates the lit columns (0017), so it carries no
  // "now on the wall" pointer — pull it narrowly so a joiner sees the currently-lit problem
  // immediately, not only after the next lit-changed nudge.
  void refreshLitProblem()
  return session
}

/**
 * List the caller's LIVE sessions across devices (cross-device resume). Membership-scoped,
 * live-only, pure read via the `list_my_live_sessions` RPC (0016) — the client otherwise never
 * enumerates a user's sessions, so a second device signed into the same account has no way to
 * find a session created/joined elsewhere. Returns `[]` when signed-out/unconfigured or on any
 * error, so an offline failure just renders nothing (R5). The result is transient UI state — the
 * caller holds it; it is never persisted (no active-session pointer is written here).
 */
export async function listMyLiveSessions(): Promise<Session[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('list_my_live_sessions')
  if (error || !data) return []
  return (data as SessionRow[]).map(fromSessionRow)
}

/**
 * Adopt an already-joined session (one returned by `listMyLiveSessions`) as this device's active
 * session — cross-device resume. This is the tail of `joinSession` WITHOUT the join RPC: the caller
 * is already a member, so there is no membership INSERT, no consent, and NO `expires_at` bump
 * (R4 — resuming is a pure adopt; only explicit intent keeps the 24h backstop alive). Mirrors
 * `initSessions`' adopt-a-row dance: activate optimistically, then reconcile with the server.
 *
 * Awaits the reconcile and returns its liveness so the caller navigates only when the session is
 * still live; a dead-on-arrival session (ended/expired between list and tap) is retired here and
 * returns `{ live: false }`, so the caller can stay put instead of bouncing the user out of a
 * catalog it just entered. Guarded by `generation` (via the same guard inside `refreshActiveSession`)
 * so a resume racing a sign-out cannot leave another identity's session active.
 */
export async function resumeSession(session: Session): Promise<{ live: boolean }> {
  if (isLocallyExpired(session)) return { live: false }
  forgetPendingExit(session.id) // resuming supersedes any unfinished exit for this session
  setActiveSession(session)
  setState({ memberStatus: readMemberStatus(session.id) })
  void ensureSelfId()
  // Reconcile with the server (loads the roster on success, retires a dead session). No `manual`
  // flag → no touch_session, so resuming never bumps expiry (R4).
  return refreshActiveSession()
}

/**
 * Retrieve the active session's invite token for sharing (KTD-7). Prefers the volatile
 * creator-held token; otherwise re-fetches via the membership-gated session_invite_token
 * RPC. The token is cached only in volatile memory, never persisted.
 */
export async function getInviteToken(sessionId?: string): Promise<string> {
  const id = sessionId ?? state.activeSession?.id
  if (!id) throw new Error('No active session to share.')
  if (volatileTokens[id]) return volatileTokens[id]
  if (!supabase) throw new Error('Sharing isn’t available in this build.')
  const { data, error } = await supabase.rpc('session_invite_token', { p_session_id: id })
  if (error) throw new Error(error.message)
  const token = data as string
  volatileTokens[id] = token
  return token
}

/** End the active session locally WITHOUT a server call — for when the server has already removed
 *  us (the owner kicked us; the membership row is gone). Clears the in-memory session + its
 *  persisted pointer, exactly like a leave, but skips the redundant self-DELETE. */
export function endActiveSessionLocally(): void {
  const active = state.activeSession
  if (active) retire(active.id)
}

/** Leave the active session — deletes only the caller's own membership (revokes just your
 *  sharing, R16) and drops the session locally. Others' membership is unaffected. */
export async function leaveSession(): Promise<void> {
  const active = state.activeSession
  if (!active) return
  if (supabase) {
    const userId = await currentUserId()
    if (!userId) {
      // We can't prove who we are, so we can't delete our membership row — and reporting a
      // successful leave here would be a lie about a revocation. Queue it under the last-known
      // identity and fail loudly instead.
      rememberPendingExit(active.id, 'left', state.selfId ?? '')
      throw new Error('Couldn’t confirm your account — this will finish next time you’re online.')
    }
    {
      const { error } = await supabase
        .from('session_members')
        .delete()
        .match({ session_id: active.id, user_id: userId })
      if (error) {
        // Leaving IS the revocation, so a failed one must not evaporate — queue it here rather
        // than in one caller, so every Leave affordance (SessionBar, SessionPill, board removal)
        // inherits the guarantee.
        rememberPendingExit(active.id, 'left', userId)
        throw new Error(error.message)
      }
    }
  }
  retire(active.id)
}

/**
 * End the active session for EVERYONE (owner-only) — soft-deletes the session row. Every member's
 * client then retires it at once via the 0014 session-ended broadcast (with the expiry/reconcile
 * backstop for anyone offline). RLS grants sessions UPDATE to the owner only, so a non-owner's
 * update matches zero rows server-side; the UI only offers this to the owner. Drops it locally too.
 */
export async function endSession(): Promise<void> {
  const active = state.activeSession
  if (!active) return
  if (supabase) {
    const { error } = await supabase.from('sessions').update({ deleted: true }).eq('id', active.id)
    if (error) {
      rememberPendingExit(active.id, 'ended', state.selfId ?? '')
      throw new Error(error.message)
    }
  }
  retire(active.id)
}

/** Thrown when the server call behind `exitSessionOnBoard` fails, carrying which exit was
 *  attempted — a failed END leaves a session that is still live and still joinable via its
 *  invite token, which is a different thing to tell the user than a failed LEAVE. */
export class SessionExitError extends Error {
  readonly intent: 'ended' | 'left'
  readonly reason: unknown

  constructor(intent: 'ended' | 'left', reason: unknown) {
    super(reason instanceof Error ? reason.message : 'Could not exit the session')
    this.name = 'SessionExitError'
    this.intent = intent
    this.reason = reason
  }
}

/**
 * Drop out of the active session when the user removes the board it runs on — a session is
 * tied to one physical wall, so keeping it would leave them "climbing" on a board they just
 * said they don't have. Mirrors the two actions SessionBar offers, so nothing happens here
 * that the user couldn't do by hand: an owner who is genuinely alone ENDS it (no one is left
 * to keep it going); everyone else — a member, or an owner with company — only LEAVES, and
 * the session lives on for the others. A session on any other board is untouched.
 *
 * **Never decide the destructive branch from the cached roster.** `state.roster` is only
 * written on create/join/resume/manual-refresh and best-effort realtime nudges, so a roster
 * that still reads `[self]` while a friend has since joined would end a session they are
 * using — unrecoverable (ending is final, KTD "ended = gone"). So reload first, and end only
 * on a roster the server just confirmed: `loadRoster` writes a NEW array on success and
 * leaves the old reference untouched on any failure, so an unchanged reference means "not
 * confirmed" and falls through to the recoverable leave.
 *
 * Returns what happened so the caller can say so; a failed server call throws
 * `SessionExitError` and the caller decides whether to retire it locally anyway.
 */
export async function exitSessionOnBoard(layoutId: number): Promise<'ended' | 'left' | null> {
  const active = state.activeSession
  if (!active || active.boardLayoutId !== layoutId) return null
  // initSessions resolves selfId without awaiting it, so on a cold launch the real owner can
  // still read as a non-owner here — and an owner who "leaves" a solo session can never get
  // back to it (both re-entry paths are membership-gated). Settle identity first.
  await ensureSelfId()
  // Every await below is a chance for the active session to change under us (a cross-tab adopt,
  // a resume, a sign-out) — and endSession/leaveSession act on whatever is active *then*, not on
  // `active`. Re-assert the target after each one so a swapped-in session can't take the write.
  if (state.activeSession?.id !== active.id) return null
  if (!!state.selfId && active.ownerId === state.selfId) {
    const before = state.roster
    await reloadActiveRoster()
    if (state.activeSession?.id !== active.id) return null
    const confirmed = state.roster !== before
    if (confirmed && state.roster.length === 1) {
      try {
        await endSession() // queues its own pending exit on failure
      } catch (e) {
        throw new SessionExitError('ended', e)
      }
      return 'ended'
    }
  }
  try {
    await leaveSession() // queues its own pending exit on failure
  } catch (e) {
    throw new SessionExitError('left', e)
  }
  return 'left'
}

/**
 * Owner-only: remove another member from the session (KTD-11). Ejects a currently-unwanted
 * member; it does NOT rotate the invite token, so a holder of the link can rejoin until the
 * session is ended. Refreshes the roster on success.
 */
export async function removeMember(userId: string): Promise<void> {
  const active = state.activeSession
  if (!active) return
  if (!supabase) return
  const { error } = await supabase
    .from('session_members')
    .delete()
    .match({ session_id: active.id, user_id: userId })
  if (error) throw new Error(error.message)
  await loadRoster(active, generation)
}

/** Rename the active session (optimistic; rolls back on failure). Trims/caps to the server
 *  limit, then bumps expiry via touch_session (KTD-6). Empty input is a no-op (the UI
 *  supplies the auto-default). */
export async function renameSession(rawName: string): Promise<void> {
  const gen = generation
  const active = state.activeSession
  if (!active) return
  const name = trimSessionName(rawName)
  if (!name || name === active.name) return
  const prev = active
  setActiveSession({ ...active, name })
  if (!supabase) return
  const { error } = await supabase.from('sessions').update({ name }).eq('id', active.id)
  if (error) {
    // Only roll back if we still point at the same session and identity hasn't switched —
    // otherwise the rollback would resurrect a cleared/replaced session (R16 / KTD-4).
    if (gen === generation && state.activeSession?.id === active.id) setActiveSession(prev)
    throw new Error(error.message)
  }
  // Rename is explicit intent → keep the session alive (best-effort; ignore a not-live race).
  await supabase.rpc('touch_session', { p_session_id: active.id })
}

/**
 * Reconcile the active session with the server + reload the roster. On a MANUAL refresh also
 * bumps expiry via touch_session (explicit intent, KTD-6). Liveness truth is the server: a
 * missing / deleted / server-expired row retires the session; a network error keeps the
 * last-good session (soft, KTD-12). Returns whether the session is still live.
 */
export async function refreshActiveSession(opts: { manual?: boolean } = {}): Promise<{ live: boolean }> {
  const gen = generation
  const active = state.activeSession
  if (!active) return { live: false }
  if (!supabase) {
    // Offline: local expiry hint only.
    if (isLocallyExpired(active)) {
      retire(active.id)
      return { live: false }
    }
    return { live: true }
  }
  if (opts.manual) {
    // Best-effort expiry bump; a not-live session errors here and is caught by the re-read.
    await supabase.rpc('touch_session', { p_session_id: active.id })
  }
  const { data, error } = await supabase
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('id', active.id)
    .limit(1)
  // Bail if the identity switched OR the user joined/created a different session while this
  // reconcile was in flight — otherwise a slow refresh for session A would clobber the
  // just-activated session B (and desync memberStatus from the pointer).
  if (gen !== generation || state.activeSession?.id !== active.id) return { live: false }
  if (error) return { live: true } // transient network — keep last-good (soft hint)
  const row = (data as SessionRow[] | null)?.[0]
  if (!row || row.deleted || Date.parse(row.expires_at) <= Date.now()) {
    retire(active.id)
    return { live: false }
  }
  const session = fromSessionRow(row)
  setActiveSession(session)
  await loadRoster(session, gen)
  return { live: true }
}

// ─── "Now on the wall" — the session's lit problem (0017, issue #97) ──────────

/** The lit-pointer columns — the narrow refetch refreshLitProblem pulls (never `*`). */
const LIT_COLUMNS = 'lit_problem_id, lit_by, lit_at'

/**
 * Record a successful light-up on the active session ("now on the wall"). No-op unless the
 * active session targets `boardLayoutId` (a session is board-scoped; lighting another board's
 * catalog records nothing). Optimistic — the local bar flips immediately, mirroring what the
 * server pins (`lit_by = auth.uid()`, `lit_at = now()`); the write goes through the
 * member-gated set_session_lit_problem RPC (sessions UPDATE RLS is owner-only). BEST-EFFORT:
 * callers fire-and-forget from the BLE path, so a cloud error never throws — it reconciles
 * back to server truth instead.
 */
export async function reportProblemLit(boardLayoutId: number, sourceCatalogId: string): Promise<void> {
  const gen = generation
  const active = state.activeSession
  if (!active || active.boardLayoutId !== boardLayoutId) return
  setActiveSession({
    ...active,
    litProblemId: sourceCatalogId,
    litBy: state.selfId,
    litAt: new Date().toISOString(),
  })
  if (!supabase) return // offline/unconfigured: keep the local echo (device-local hint)
  const { error } = await supabase.rpc('set_session_lit_problem', {
    p_session_id: active.id,
    p_problem_id: sourceCatalogId,
  })
  if (error && gen === generation && state.activeSession?.id === active.id) {
    void refreshLitProblem() // roll back to server truth (e.g. the session just ended)
  }
}

/**
 * Narrow reconcile of the lit pointer — the 'lit-changed' realtime nudge's refetch, and the
 * foreground + reconnect backstops for a nudge dropped while the PWA was backgrounded (KTD-5:
 * the broadcast payload is never trusted as data). Selects only LIT_COLUMNS so a co-member's
 * light-up doesn't reload the roster; the full SESSION_COLUMNS pulls (activation / manual refresh)
 * carry the same fields anyway. Best-effort: errors keep last-good state.
 */
export async function refreshLitProblem(): Promise<void> {
  const gen = generation
  const active = state.activeSession
  if (!active || !supabase) return
  const { data, error } = await supabase
    .from('sessions')
    .select(LIT_COLUMNS)
    .eq('id', active.id)
    .limit(1)
  const current = state.activeSession
  if (gen !== generation || current?.id !== active.id) return
  if (error) return
  const row = (data as Pick<SessionRow, 'lit_problem_id' | 'lit_by' | 'lit_at'>[] | null)?.[0]
  if (!row) return
  setActiveSession({
    ...current,
    litProblemId: row.lit_problem_id ?? null,
    litBy: row.lit_by ?? null,
    litAt: row.lit_at ?? null,
  })
}

/** Set a member's chip selections (R3/R14) and persist them for the active session. */
export function setMemberStatus(userId: string, keys: StatusKey[]): void {
  const active = state.activeSession
  if (!active) return
  const next: MemberStatus = { ...state.memberStatus, [userId]: keys }
  setState({ memberStatus: next })
  persistMemberStatus(active.id, next)
}

// ─── Identity lifecycle (mirrors syncListsIdentity) ───────────────────────────

/** Clear the store + all persisted session state (sign-out / user switch). Bumps the
 *  generation first so in-flight roster/refresh writes are discarded. */
export function clearSessionsCache(): void {
  generation += 1
  for (const k of Object.keys(volatileTokens)) delete volatileTokens[k]
  setState({ status: 'idle', activeSession: null, roster: [], memberStatus: {}, selfId: null, error: null })
  removeAllSessionStorage()
}

/**
 * Reconcile with the signed-in identity, called from AuthProvider.onAuthStateChange. Clears
 * everything whenever the user id changes (sign-out or a different user) so on a shared
 * device user B never inherits user A's active session; a same-user restore is a no-op.
 */
export function syncSessionsIdentity(userId: string | null): void {
  const next = userId ?? ''
  let prev: string | null = null
  try {
    prev = localStorage.getItem(LAST_USER_KEY)
  } catch {
    /* ignore */
  }
  if (prev === next) return
  clearSessionsCache()
  try {
    localStorage.setItem(LAST_USER_KEY, next)
  } catch {
    /* ignore */
  }
}

// ─── Reactive bindings ────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): SessionsState {
  return state
}

/** Non-reactive snapshot (tests; imperative callers). */
export function getSessionsSnapshot(): SessionsState {
  return state
}

/** Reactive view of the active-session store. */
export function useSessions(): SessionsState {
  return useSyncExternalStore(subscribe, getSnapshot)
}
