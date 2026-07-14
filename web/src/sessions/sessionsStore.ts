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
 * Reload the active session's roster in response to a realtime membership nudge (0012) — drives
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

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Rehydrate the active session from localStorage on app start (call once, e.g. from
 * AppLayout). A cached session already clearly past its expiry is retired locally with NO
 * network call (offline path, KTD-12); otherwise it is shown immediately and a best-effort
 * refresh reconciles it with the server + loads the roster.
 */
export function initSessions(): void {
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
  setActiveSession(session)
  setState({ memberStatus: readMemberStatus(session.id) })
  void ensureSelfId()
  void loadRoster(session, gen)
  return session
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

/** Leave the active session — deletes only the caller's own membership (revokes just your
 *  sharing, R16) and drops the session locally. Others' membership is unaffected. */
export async function leaveSession(): Promise<void> {
  const active = state.activeSession
  if (!active) return
  if (supabase) {
    const userId = await currentUserId()
    if (userId) {
      const { error } = await supabase
        .from('session_members')
        .delete()
        .match({ session_id: active.id, user_id: userId })
      if (error) throw new Error(error.message)
    }
  }
  retire(active.id)
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
