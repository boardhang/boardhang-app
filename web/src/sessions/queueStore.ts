// Reactive Session Playlist Queue store (U2). Mirrors sessionsStore.ts / memberAscentsStore.ts:
// module-level state + a listener Set + useSyncExternalStore, snake_case ↔ camelCase mapping
// (queueTypes), a signed-out/unconfigured (`if (!supabase)`) guard, and a generation counter
// guarding a session switch. Reads and writes go DIRECT through RLS like list_problems (KTD5) —
// the queue has no cross-user privacy constraint, so there is no read RPC and no offline cache.
//
// Load-bearing invariants:
//   • Deterministic order (KTD3 / AE3): active rows are always sorted `position, created_at, id`
//     client-side too, so a transient position collision (an add's `max(position)+1` racing a
//     reorder renumber) still resolves to one identical order on every client. Done rows sort by
//     `done_at`.
//   • Active-only uniqueness (KTD2 / R5): a problem is active at most once per session. A
//     concurrent duplicate add hits the partial-unique 23505 and resolves to a no-op with an
//     'already-active' signal instead of throwing. Un-checking a Done row whose problem is already
//     active (the AE5 state) hits the same 23505 and is likewise a clean no-op (KTD2).
//   • Best-effort live-pull, writes fail loudly (KTD5): every mutation is optimistic and rolls
//     back on a cloud error. Because Broadcast is best-effort with no replay, a dropped
//     `queue-changed` nudge must not strand a stale queue — so the store also refetches on the
//     non-realtime reconcile triggers: active-session change (activateQueue), foreground
//     (visibilitychange→visible), and realtime reconnect (U3 calls the exported refreshQueue).

import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'
import {
  QUEUE_COLUMNS,
  compareActiveItems,
  compareDoneItems,
  fromQueueRow,
  type QueueItem,
  type QueueItemRow,
} from './queueTypes'

export type QueueStatus = 'idle' | 'loading' | 'loaded' | 'error'

export interface QueueState {
  status: QueueStatus
  /** Active items (`done_at === null`), ordered `position, created_at, id`. */
  activeItems: QueueItem[]
  /** Done items (`done_at` set), ordered by `done_at`. Retained for the life of the session. */
  doneItems: QueueItem[]
  error: string | null
}

/** Outcome of an add / un-check that touches the active-only unique index (KTD2 / R5). The
 *  caller surfaces `'already-active'` as "already in the queue" rather than an error. */
export type QueueMutationResult = 'ok' | 'already-active'

/** Coalesce a burst of refetch nudges (U3's reorder emits N per-row broadcasts) into one pull. */
export const QUEUE_REFETCH_DEBOUNCE_MS = 300

const EMPTY: QueueState = { status: 'idle', activeItems: [], doneItems: [], error: null }

let state: QueueState = EMPTY
const listeners = new Set<() => void>()
let currentSessionId: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// Session-switch / sign-out guard (mirrors sessionsStore's `generation`): bumped on every
// activate/clear so a late fetch or a rollback resolving after a switch can't write stale data.
let generation = 0

function notify(): void {
  for (const l of listeners) l()
}

function setState(next: Partial<QueueState>): void {
  state = { ...state, ...next }
  notify()
}

function sortActive(items: QueueItem[]): QueueItem[] {
  return [...items].sort(compareActiveItems)
}

function sortDone(items: QueueItem[]): QueueItem[] {
  return [...items].sort(compareDoneItems)
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

// ─── Fetch (direct RLS select; deterministic client-side sort) ────────────────

/**
 * Refetch the active session's queue via a direct RLS select and split it into the active /
 * done groups. A fetch resolving after the active session changed (or the store was cleared) is
 * dropped by the session-id + generation guard. On error the last-good state is kept.
 */
async function fetchQueue(sessionId: string): Promise<void> {
  const gen = generation
  if (!supabase) {
    setState({ status: 'loaded', activeItems: [], doneItems: [], error: null })
    return
  }
  const { data, error } = await supabase
    .from('session_queue')
    .select(QUEUE_COLUMNS)
    .eq('session_id', sessionId)
    .eq('deleted', false)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  // Active session changed (or identity switched) mid-flight — drop the stale result.
  if (gen !== generation || sessionId !== currentSessionId) return
  if (error) {
    setState({ status: 'error', error: error.message })
    return
  }
  const items = ((data ?? []) as QueueItemRow[]).map(fromQueueRow)
  setState({
    status: 'loaded',
    error: null,
    activeItems: sortActive(items.filter((i) => i.doneAt === null)),
    doneItems: sortDone(items.filter((i) => i.doneAt !== null)),
  })
}

/**
 * Public, debounced refetch wrapping fetchQueue — the single entry point U3's realtime handler
 * and the reconnect reconcile call, so a burst of `queue-changed` nudges collapses to one pull.
 * No-op when no session is active.
 */
export function refreshQueue(): void {
  if (!currentSessionId) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (currentSessionId) void fetchQueue(currentSessionId)
  }, QUEUE_REFETCH_DEBOUNCE_MS)
}

// ─── Reconcile triggers (KTD5): foreground + active-session change ─────────────

function onVisibility(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && currentSessionId) {
    refreshQueue() // dropped-nudge reconcile on foreground
  }
}

function startListeners(): void {
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
}

function stopListeners(): void {
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

/**
 * Point the store at a session (or null to clear). Resets the queue and fetches; installs the
 * foreground reconcile while a session is active. Idempotent on the same id. Bumps the generation
 * so any in-flight fetch/rollback for the prior session is discarded (active-session-change
 * reconcile — KTD5).
 */
export function activateQueue(sessionId: string | null): void {
  if (sessionId === currentSessionId) return
  generation += 1
  currentSessionId = sessionId
  if (sessionId) {
    startListeners()
    setState({ status: 'loading', activeItems: [], doneItems: [], error: null })
    void fetchQueue(sessionId)
  } else {
    stopListeners()
    setState({ ...EMPTY })
  }
}

/** Reset the store + stop listeners (sign-out / user switch / tests). Bumps the generation. */
export function clearQueue(): void {
  generation += 1
  currentSessionId = null
  stopListeners()
  setState({ ...EMPTY })
}

// ─── Mutations (optimistic; roll back on a cloud error) ───────────────────────

/**
 * Add a catalog problem to the queue at `max(position)+1` (appends at the end — R2). Optimistic.
 * On the active-only partial-unique 23505 (a concurrent duplicate active add — R5) this is a
 * no-op: the optimistic row is rolled back, the server truth is refetched, and 'already-active'
 * is returned so the caller can surface "already in the queue" instead of an error.
 */
export async function addProblem(
  sourceCatalogId: string,
  boardLayoutId: number,
): Promise<QueueMutationResult> {
  const gen = generation
  const sessionId = currentSessionId
  if (!sessionId) throw new Error('No active session.')
  const userId = await currentUserId()
  const now = new Date().toISOString()
  const maxPos = state.activeItems.reduce((m, i) => Math.max(m, i.position), 0)
  const optimistic: QueueItem = {
    id: crypto.randomUUID(),
    sessionId,
    sourceCatalogId,
    boardLayoutId,
    addedBy: userId,
    position: maxPos + 1,
    doneAt: null,
    doneBy: null,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
  setState({ status: 'loaded', activeItems: sortActive([...state.activeItems, optimistic]) })

  if (!supabase) return 'ok'
  const { data, error } = await supabase
    .from('session_queue')
    .insert({
      session_id: sessionId,
      source_catalog_id: sourceCatalogId,
      board_layout_id: boardLayoutId,
      added_by: userId,
      position: optimistic.position,
    })
    .select(QUEUE_COLUMNS)
    .single()
  if (error) {
    // Roll the optimistic row back out (only if we still point at the same session).
    if (gen === generation && currentSessionId === sessionId) {
      setState({ activeItems: state.activeItems.filter((i) => i.id !== optimistic.id) })
    }
    if ((error as { code?: string }).code === '23505') {
      // The problem is already active — reconcile to the server's single row and report the no-op.
      await fetchQueue(sessionId)
      return 'already-active'
    }
    throw new Error(error.message)
  }
  // Reconcile the temp optimistic id with the authoritative server row.
  const saved = fromQueueRow(data as QueueItemRow)
  if (gen === generation && currentSessionId === sessionId) {
    setState({
      activeItems: sortActive([...state.activeItems.filter((i) => i.id !== optimistic.id), saved]),
    })
  }
  return 'ok'
}

/** Check an active item off (mark done — R6). Optimistic; rolls back on error. */
export async function checkOff(id: string): Promise<void> {
  const gen = generation
  const sessionId = currentSessionId
  const prevActive = state.activeItems
  const prevDone = state.doneItems
  const target = prevActive.find((i) => i.id === id)
  if (!target) return
  const doneAt = new Date().toISOString()
  setState({
    status: 'loaded',
    activeItems: prevActive.filter((i) => i.id !== id),
    doneItems: sortDone([...prevDone, { ...target, doneAt }]),
  })
  if (!supabase) return
  const { error } = await supabase.from('session_queue').update({ done_at: doneAt }).eq('id', id)
  if (error) {
    if (gen === generation && currentSessionId === sessionId) {
      setState({ activeItems: sortActive(prevActive), doneItems: sortDone(prevDone) })
    }
    throw new Error(error.message)
  }
}

/**
 * Un-check a Done item back to active at the end of the order (R6 / R8). Optimistic. In the AE5
 * state — the problem was re-added and is already active — the UPDATE hits the active-only
 * partial-unique 23505; per KTD2 this is a clean no-op: the optimistic move is rolled back (the
 * Done row stays done), the server truth is refetched, and 'already-active' is returned so the
 * caller surfaces "already in the queue" rather than a raw 23505.
 */
export async function unCheck(id: string): Promise<QueueMutationResult> {
  const gen = generation
  const sessionId = currentSessionId
  const prevActive = state.activeItems
  const prevDone = state.doneItems
  const target = prevDone.find((i) => i.id === id)
  if (!target) return 'ok'
  const newPos = prevActive.reduce((m, i) => Math.max(m, i.position), 0) + 1
  setState({
    status: 'loaded',
    activeItems: sortActive([...prevActive, { ...target, doneAt: null, doneBy: null, position: newPos }]),
    doneItems: prevDone.filter((i) => i.id !== id),
  })
  if (!supabase) return 'ok'
  const { error } = await supabase
    .from('session_queue')
    .update({ done_at: null, position: newPos })
    .eq('id', id)
  if (error) {
    // Roll back to the prior active/done split.
    if (gen === generation && currentSessionId === sessionId) {
      setState({ activeItems: sortActive(prevActive), doneItems: sortDone(prevDone) })
    }
    if ((error as { code?: string }).code === '23505') {
      // AE5: the problem is already active — un-check is a no-op; reconcile to server truth.
      await fetchQueue(sessionId!)
      return 'already-active'
    }
    throw new Error(error.message)
  }
  return 'ok'
}

/** Remove an item (soft-delete — R4). Optimistic; drops it from both groups, rolls back on error. */
export async function removeItem(id: string): Promise<void> {
  const gen = generation
  const sessionId = currentSessionId
  const prevActive = state.activeItems
  const prevDone = state.doneItems
  setState({
    status: 'loaded',
    activeItems: prevActive.filter((i) => i.id !== id),
    doneItems: prevDone.filter((i) => i.id !== id),
  })
  if (!supabase) return
  const { error } = await supabase.from('session_queue').update({ deleted: true }).eq('id', id)
  if (error) {
    if (gen === generation && currentSessionId === sessionId) {
      setState({ activeItems: sortActive(prevActive), doneItems: sortDone(prevDone) })
    }
    throw new Error(error.message)
  }
}

/**
 * Reorder the active items to `orderedIds` (R3). Optimistically applies the new order (position =
 * index), then calls the atomic, session-scoped `reorder_session_queue` RPC (0015, returns void).
 * On error it rolls back to the server order and refetches to reconcile.
 */
export async function reorder(orderedIds: string[]): Promise<void> {
  const gen = generation
  const sessionId = currentSessionId
  if (!sessionId) return
  const prevActive = state.activeItems
  const byId = new Map(prevActive.map((i) => [i.id, i]))
  const reordered: QueueItem[] = []
  orderedIds.forEach((id, idx) => {
    const it = byId.get(id)
    if (it) reordered.push({ ...it, position: idx + 1 })
  })
  // Defensive: keep any active item not named in orderedIds, appended after the reordered set.
  const missing = prevActive.filter((i) => !orderedIds.includes(i.id))
  setState({ status: 'loaded', activeItems: [...reordered, ...missing] })

  if (!supabase) return
  const { error } = await supabase.rpc('reorder_session_queue', {
    p_session_id: sessionId,
    p_ordered_ids: orderedIds,
  })
  if (error) {
    if (gen === generation && currentSessionId === sessionId) {
      setState({ activeItems: sortActive(prevActive) })
    }
    await fetchQueue(sessionId) // reconcile to the authoritative server order
    throw new Error(error.message)
  }
}

// ─── Reactive bindings ────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): QueueState {
  return state
}

/** Non-reactive snapshot (tests; imperative callers). */
export function getQueueSnapshot(): QueueState {
  return state
}

/**
 * Reactive view of the queue for the given active session id. Drives activation on id change
 * (the active-session-change reconcile — KTD5); passing null (no session) clears the store.
 */
export function useSessionQueue(sessionId: string | null): QueueState {
  useEffect(() => {
    activateQueue(sessionId)
  }, [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot)
}
