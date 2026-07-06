// Reactive "my lists" store — the web analog of iOS `ListsManager`, layered on the
// listsSync cache. Mirrors logbook/ascents.ts: module-level state + a listener Set +
// useSyncExternalStore, snake_case ↔ camelCase mapping, a signed-out/unconfigured
// guard, and optimistic mutations that roll back on a cloud error. Two things ascents
// doesn't have: an offline-cache write-through (every mutation updates IndexedDB too)
// and an `offline` status (a cold pull that fails with nothing cached — distinct from
// "loaded, but you have no lists").
//
// Reads are cached-first (KTD7): cold cache → one auto pull on load; warm cache →
// paint from IndexedDB with no network until an explicit refresh or a post-write pull.

import { useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'
import {
  cacheListProblems,
  cacheLists,
  clearListsCache,
  currentCacheGeneration,
  hasListsCursor,
  readListProblems,
  readLists,
  syncLists,
} from './listsSync'
import {
  LIST_COLUMNS,
  LIST_PROBLEM_COLUMNS,
  fromListRow,
  type ListProblemRow,
  type ListRow,
  type SavedList,
  type SavedListProblem,
} from './listsTypes'

/** `offline` = a cold-cache load whose pull failed with nothing cached, so the screen
 *  can distinguish "no lists" from "couldn't reach your lists". */
export type ListsStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'offline'

export interface ListsState {
  status: ListsStatus
  /** The signed-in user's non-deleted lists, newest first. */
  lists: SavedList[]
  error: string | null
}

let state: ListsState = { status: 'idle', lists: [], error: null }
const listeners = new Set<() => void>()

function setState(next: Partial<ListsState>): void {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function sortNewestFirst(list: SavedList[]): SavedList[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

function toListRow(l: SavedList): ListRow {
  return {
    id: l.id,
    owner_id: l.ownerId,
    name: l.name,
    board_layout_id: l.boardLayoutId,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
    deleted: l.deleted,
  }
}

function toProblemRow(p: SavedListProblem, overrides: Partial<ListProblemRow> = {}): ListProblemRow {
  return {
    id: p.id,
    list_id: p.listId,
    source_catalog_id: p.sourceCatalogId,
    board_layout_id: p.boardLayoutId,
    added_by: p.addedBy,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    deleted: p.deleted,
    ...overrides,
  }
}

// ─── Loads ──────────────────────────────────────────────────────────────────

/**
 * Load the signed-in user's lists. Signed-out / unconfigured → an empty loaded set
 * (the screen shows its sign-in prompt). Cached-first: paint from IndexedDB, and only
 * pull the network on a cold cache. A cold pull that fails with an empty cache lands
 * in `offline` so the screen shows "can't reach your lists", not "create your first".
 */
export async function loadLists(): Promise<void> {
  if (!supabase) {
    setState({ status: 'loaded', lists: [], error: null })
    return
  }
  const userId = await currentUserId()
  if (!userId) {
    setState({ status: 'loaded', lists: [], error: null })
    return
  }
  setState({ status: 'loading', error: null })
  const cached = await readLists().catch(() => [] as SavedList[])
  if (hasListsCursor()) {
    // Warm cache — paint instantly, no auto network (KTD7).
    setState({ status: 'loaded', lists: sortNewestFirst(cached), error: null })
    return
  }
  // Cold cache — paint whatever's there (usually empty) then do one pull.
  setState({ lists: sortNewestFirst(cached) })
  const { synced } = await syncLists(userId)
  const fresh = await readLists().catch(() => cached)
  // The pull may have populated list_problems too; nudge membership/count subscribers
  // (the add-to-list sheet's checkmarks, the index's counts) to re-read the warmed cache —
  // syncLists writes IndexedDB directly and can't otherwise signal them.
  notifyProblemsChanged()
  if (!synced && fresh.length === 0) {
    setState({ status: 'offline', lists: [], error: null })
  } else {
    setState({ status: 'loaded', lists: sortNewestFirst(fresh), error: null })
  }
}

/** Explicit refresh (pull-to-refresh / post-write): pull, then repaint from cache.
 *  Returns whether the pull reached the server, for callers that show a degraded flag. */
export async function refreshLists(): Promise<{ synced: boolean }> {
  const userId = await currentUserId()
  if (!userId) return { synced: false }
  const { synced } = await syncLists(userId)
  const fresh = await readLists().catch(() => state.lists)
  notifyProblemsChanged() // pulled list_problems may have changed — re-read subscribers
  if (!synced && fresh.length === 0) {
    setState({ status: 'offline', lists: [], error: null })
  } else {
    setState({ status: 'loaded', lists: sortNewestFirst(fresh), error: null })
  }
  return { synced }
}

// ─── List CRUD (optimistic, write-through, rollback on error) ─────────────────

/** Create a board-bound list. Sets `owner_id` for the RLS WITH CHECK (KTD-I8) and binds
 *  `board_layout_id` from the caller (KTD-I4). Returns the server-reconciled list. */
export async function createList(name: string, boardLayoutId: number): Promise<SavedList> {
  const gen = currentCacheGeneration()
  const userId = await currentUserId()
  if (!userId) throw new Error('You need to be signed in to create a list.')
  const now = new Date().toISOString()
  const optimistic: SavedList = {
    id: crypto.randomUUID(),
    ownerId: userId,
    name,
    boardLayoutId,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
  const prev = state.lists
  setState({ status: 'loaded', lists: sortNewestFirst([optimistic, ...prev]) })
  // If the write-through cache write fails, roll the optimistic row back out of the
  // in-memory store too — otherwise a phantom list lingers with nothing behind it (#4).
  try {
    await cacheLists([toListRow(optimistic)], gen)
  } catch (e) {
    setState({ lists: prev })
    throw e instanceof Error ? e : new Error(String(e))
  }

  if (!supabase) return optimistic
  const { data, error } = await supabase
    .from('lists')
    .insert({ owner_id: userId, name, board_layout_id: boardLayoutId })
    .select(LIST_COLUMNS)
    .single()
  if (error) {
    setState({ lists: prev })
    await cacheLists([toListRow({ ...optimistic, deleted: true })], gen)
    throw new Error(error.message)
  }
  // Reconcile the temp id with the authoritative server row.
  const saved: SavedList = fromListRow(data as ListRow)
  setState({
    lists: sortNewestFirst([saved, ...state.lists.filter((l) => l.id !== optimistic.id)]),
  })
  await cacheLists([toListRow({ ...optimistic, deleted: true }), toListRow(saved)], gen)
  return saved
}

/** Rename a list (optimistic; rolls back on failure). */
export async function renameList(id: string, name: string): Promise<void> {
  const gen = currentCacheGeneration()
  const prev = state.lists
  const target = prev.find((l) => l.id === id)
  const updated = target ? { ...target, name } : null
  setState({ lists: prev.map((l) => (l.id === id ? { ...l, name } : l)) })
  if (updated) {
    try {
      await cacheLists([toListRow(updated)], gen)
    } catch (e) {
      setState({ lists: prev })
      throw e instanceof Error ? e : new Error(String(e))
    }
  }
  if (!supabase) return
  const { error } = await supabase.from('lists').update({ name }).eq('id', id)
  if (error) {
    setState({ lists: prev })
    if (target) await cacheLists([toListRow(target)], gen)
    throw new Error(error.message)
  }
}

/** Soft-delete a list (optimistic remove; rolls back on failure). */
export async function deleteList(id: string): Promise<void> {
  const gen = currentCacheGeneration()
  const prev = state.lists
  const target = prev.find((l) => l.id === id)
  setState({ lists: prev.filter((l) => l.id !== id) })
  if (target) {
    try {
      await cacheLists([toListRow({ ...target, deleted: true })], gen)
    } catch (e) {
      setState({ lists: prev })
      throw e instanceof Error ? e : new Error(String(e))
    }
  }
  if (!supabase) return
  const { error } = await supabase.from('lists').update({ deleted: true }).eq('id', id)
  if (error) {
    setState({ lists: prev })
    if (target) await cacheLists([toListRow(target)], gen)
    throw new Error(error.message)
  }
}

// ─── Membership (optimistic against the cache; store holds no problems in memory) ──

/**
 * Add a catalog problem to a list — an EXPLICIT REVIVE, never a PostgREST upsert
 * (a partial unique index can't be an upsert target → Postgres 42P10, KTD8). Update
 * the `(list_id, source_catalog_id)` row back to live (setting `added_by` for the RLS
 * WITH CHECK — KTD-I8); insert only when no row matched. Result: at most one live entry
 * per (list, problem).
 */
export async function addProblem(
  listId: string,
  sourceCatalogId: string,
  boardLayoutId: number,
): Promise<void> {
  const gen = currentCacheGeneration()
  const userId = await currentUserId()
  if (!userId) throw new Error('You need to be signed in to save a problem.')
  const now = new Date().toISOString()
  const optimistic: SavedListProblem = {
    id: crypto.randomUUID(),
    listId,
    sourceCatalogId,
    boardLayoutId,
    addedBy: userId,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
  await cacheListProblems([toProblemRow(optimistic)], gen)
  notifyProblemsChanged()

  if (!supabase) return
  try {
    // Explicit revive: flip any existing row for this key back to live.
    const { data: revived, error: reviveError } = await supabase
      .from('list_problems')
      .update({ deleted: false, added_by: userId })
      .match({ list_id: listId, source_catalog_id: sourceCatalogId })
      .select(LIST_PROBLEM_COLUMNS)
    if (reviveError) throw new Error(reviveError.message)
    let serverRows = (revived ?? []) as ListProblemRow[]
    if (serverRows.length === 0) {
      // Never added before — insert a fresh row.
      const { data: inserted, error: insertError } = await supabase
        .from('list_problems')
        .insert({
          list_id: listId,
          source_catalog_id: sourceCatalogId,
          board_layout_id: boardLayoutId,
          added_by: userId,
        })
        .select(LIST_PROBLEM_COLUMNS)
        .single()
      if (insertError) {
        // A concurrent first-add (two devices / a double-tap) can win the partial
        // unique index between our revive-miss and this insert → Postgres 23505. The
        // problem IS saved, so reconcile the existing live row instead of reporting a
        // false failure (#5).
        if ((insertError as { code?: string }).code === '23505') {
          // The concurrent winner's row exists but may not be visible to our re-select yet
          // (read-after-write lag). Try the live re-select first; if it comes back empty,
          // retry the revive once (it reconciles the winner's row once visible) before
          // giving up — so the loser reconciles to success, not a raw 23505 (BUG B).
          const { data: existing } = await supabase
            .from('list_problems')
            .select(LIST_PROBLEM_COLUMNS)
            .match({ list_id: listId, source_catalog_id: sourceCatalogId })
            .eq('deleted', false)
            .limit(1)
          let rows = (existing ?? []) as ListProblemRow[]
          if (rows.length === 0) {
            const { data: revivedAgain } = await supabase
              .from('list_problems')
              .update({ deleted: false, added_by: userId })
              .match({ list_id: listId, source_catalog_id: sourceCatalogId })
              .select(LIST_PROBLEM_COLUMNS)
            rows = (revivedAgain ?? []) as ListProblemRow[]
          }
          if (rows.length === 0) throw new Error(insertError.message)
          serverRows = rows
        } else {
          throw new Error(insertError.message)
        }
      } else {
        serverRows = [inserted as ListProblemRow]
      }
    }
    // Reconcile: drop the temp optimistic row, cache the authoritative server row(s).
    await cacheListProblems([toProblemRow(optimistic, { deleted: true }), ...serverRows], gen)
    notifyProblemsChanged()
  } catch (e) {
    // Roll back the optimistic cache entry.
    await cacheListProblems([toProblemRow(optimistic, { deleted: true })], gen)
    notifyProblemsChanged()
    throw e instanceof Error ? e : new Error(String(e))
  }
}

/** Remove a problem from a list (soft-delete; optimistic, rolls back on failure). */
export async function removeProblem(listId: string, sourceCatalogId: string): Promise<void> {
  const gen = currentCacheGeneration()
  const cached = await readListProblems(listId).catch(() => [] as SavedListProblem[])
  const target = cached.find((p) => p.sourceCatalogId === sourceCatalogId)
  if (target) {
    await cacheListProblems([toProblemRow(target, { deleted: true })], gen)
    notifyProblemsChanged()
  }
  if (!supabase) return
  const { error } = await supabase
    .from('list_problems')
    .update({ deleted: true })
    .match({ list_id: listId, source_catalog_id: sourceCatalogId })
  if (error) {
    if (target) {
      await cacheListProblems([toProblemRow(target, { deleted: false })], gen)
      notifyProblemsChanged()
    }
    throw new Error(error.message)
  }
  // The soft-delete succeeded. If the row wasn't in our cache (e.g. a co-member added it
  // and we haven't pulled it yet), no optimistic notify fired above — nudge mounted views
  // to re-read so the removal is reflected (#6).
  if (!target) notifyProblemsChanged()
}

// ─── Auth lifecycle (KTD-I9) ──────────────────────────────────────────────────

const LAST_USER_KEY = 'listsLastUserId'

/**
 * Reconcile the cache with the signed-in identity, called from AuthProvider's
 * onAuthStateChange. Clears the store + IndexedDB whenever the user id changes —
 * including sign-out (id → null) and a switch to a different user — so on a shared
 * device user B never paints user A's cached lists. A same-user launch (restored
 * session) does NOT clear, preserving the warm cache. Awaits the clear before the next
 * user's loadLists can run.
 */
export async function syncListsIdentity(userId: string | null): Promise<void> {
  const next = userId ?? ''
  const prev = localStorage.getItem(LAST_USER_KEY)
  if (prev === next) return
  // Clear FIRST, then advance the gate. If the clear rejects (IndexedDB quota /
  // private-mode / VersionError), the gate stays un-advanced so the next auth event
  // retries the clear — otherwise a stale gate would let user B paint user A's warm
  // cache on a shared device (the KTD-I9 leak this ordering exists to prevent).
  await resetLists()
  localStorage.setItem(LAST_USER_KEY, next)
}

/** Clear the in-memory store and the IndexedDB cache (sign-out / user switch). */
export async function resetLists(): Promise<void> {
  setState({ status: 'idle', lists: [], error: null })
  await clearListsCache()
  notifyProblemsChanged()
}

// ─── Reactive bindings ────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ListsState {
  return state
}

/** Non-reactive snapshot of the store (tests; imperative callers). */
export function getListsSnapshot(): ListsState {
  return state
}

/** Reactive view of the "my lists" store. */
export function useSavedLists(): ListsState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

// A separate, list-agnostic signal for the per-list problem cache: the store writes
// list_problems straight to IndexedDB (not in-memory), so useListProblems can't observe
// them via useSyncExternalStore. This lets a mutation nudge any mounted detail view to
// re-read its slab.
const problemListeners = new Set<() => void>()

export function subscribeListProblemsChanged(listener: () => void): () => void {
  problemListeners.add(listener)
  return () => problemListeners.delete(listener)
}

function notifyProblemsChanged(): void {
  for (const l of problemListeners) l()
}
