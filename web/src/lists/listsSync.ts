// Offline cache + incremental high-water-mark sync for Saved Lists. Mirrors
// catalog/catalogSync.ts: an IndexedDB store per table, a localStorage cursor per
// table, delta pulls (updated_at > cursor, oldest-first) that apply `deleted`
// tombstones, and best-effort semantics — a failed pull leaves the cursor untouched
// and the cache readable, so the next pull retries.
//
// Two differences from catalogSync: this cache holds one signed-in user's PRIVATE
// lists (RLS scopes the pull to the caller), so it is cleared on the auth transition
// (clearListsCache, wired from AuthProvider — KTD-I9); and the projection selects
// explicit columns, never `*`, so the `invite_token` share secret is never persisted
// (KTD-I10). The store also write-through-caches optimistic mutations via cacheLists /
// cacheListProblems, using the same tombstone rule as the pull.

import { supabase } from '../supabase/client'
import {
  LIST_COLUMNS,
  LIST_PROBLEM_COLUMNS,
  fromListProblemRow,
  fromListRow,
  type ListProblemRow,
  type ListRow,
  type SavedList,
  type SavedListProblem,
} from './listsTypes'

const DB_NAME = 'moonboard-lists'
const DB_VERSION = 1
const LISTS_STORE = 'lists'
const PROBLEMS_STORE = 'list_problems'
const LISTS_CURSOR = 'listsCursor'
const PROBLEMS_CURSOR = 'listProblemsCursor'
const EPOCH = '1970-01-01T00:00:00+00:00'

// Column projections (LIST_COLUMNS / LIST_PROBLEM_COLUMNS) live in listsTypes.ts as the
// single source of the KTD-I10 "never select invite_token" invariant — NOT `*`.

// Cache generation (KTD-I9 async-identity guard). clearListsCache() bumps this; every
// cache write that follows a network await captures the generation it started under and
// drops itself if the generation has since changed. Without it, a pull or mutation
// reconcile that was in flight when the user signed out / switched accounts would resolve
// under the OLD user's RLS and write their private rows back into the just-cleared cache,
// re-arming hasListsCursor() so the next user paints the previous user's lists.
let cacheGeneration = 0

/** The current cache generation — captured by callers before an await, re-checked at the
 *  write boundary. A changed value means the cache was cleared (identity switch) meanwhile. */
export function currentCacheGeneration(): number {
  return cacheGeneration
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(LISTS_STORE)) {
        db.createObjectStore(LISTS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(PROBLEMS_STORE)) {
        const store = db.createObjectStore(PROBLEMS_STORE, { keyPath: 'id' })
        store.createIndex('list', 'list_id')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Result of a sync pull: whether both table pulls actually reached the server. */
export interface ListsSyncResult {
  /** True when the delta pulls completed (incl. valid empty results); false when a pull
   *  failed (offline / 5xx / timeout) and the cache is served stale. */
  synced: boolean
}

/**
 * Pull `lists` + `list_problems` deltas for the signed-in user and merge them into
 * IndexedDB, advancing each table's high-water cursor. Best-effort: on a failure the
 * failing table's cursor is left untouched and `synced` is false, so the caller keeps
 * showing the cache and the next pull retries. RLS scopes the rows to the caller —
 * `userId` gates the call (the store never syncs signed-out).
 */
export async function syncLists(userId: string): Promise<ListsSyncResult> {
  if (!supabase || !userId) return { synced: false }
  // Capture the generation this pull starts under. If the identity changes (cache cleared)
  // while the network round-trip is in flight, pullTable drops its writes rather than
  // re-poisoning the cleared cache with the previous user's rows (KTD-I9).
  const gen = cacheGeneration
  let synced = true
  try {
    await pullTable(LISTS_STORE, LISTS_CURSOR, LIST_COLUMNS, gen)
  } catch {
    synced = false
  }
  try {
    await pullTable(PROBLEMS_STORE, PROBLEMS_CURSOR, LIST_PROBLEM_COLUMNS, gen)
  } catch {
    synced = false
  }
  return { synced }
}

/** One table's high-water delta pull. Throws on a network/query error so syncLists can
 *  mark the run degraded; the cursor advances only when rows were applied. `gen` is the
 *  cache generation captured before the network call — a mismatch at write time means the
 *  cache was cleared meanwhile (identity switch), so we drop the write entirely. */
async function pullTable(store: string, cursorKey: string, columns: string, gen: number): Promise<void> {
  if (!supabase) return
  const cursor = localStorage.getItem(cursorKey) ?? EPOCH
  const { data, error } = await supabase
    .from(store)
    .select(columns)
    .gt('updated_at', cursor)
    .order('updated_at', { ascending: true })
  if (error) throw error
  // Identity changed mid-flight → these rows belong to the previous user. Drop them and
  // leave the cursor un-advanced so the cleared cache stays clean (KTD-I9).
  if (gen !== cacheGeneration) return
  const rows = (data ?? []) as unknown as Array<{ id: string; updated_at: string; deleted: boolean }>
  if (rows.length === 0) return
  const db = await openDB()
  const tx = db.transaction(store, 'readwrite')
  const objectStore = tx.objectStore(store)
  let newest = cursor
  for (const row of rows) {
    if (row.deleted) objectStore.delete(row.id)
    else objectStore.put(row)
    if (row.updated_at > newest) newest = row.updated_at
  }
  await txDone(tx)
  db.close()
  localStorage.setItem(cursorKey, newest)
}

/** Whether the lists table has ever been synced (a cursor exists). Cold cache =
 *  false → the store does one auto pull; warm = true → paint cache, no auto network. */
export function hasListsCursor(): boolean {
  return localStorage.getItem(LISTS_CURSOR) !== null
}

/** All non-deleted lists from the cache (unordered; the store sorts). */
export async function readLists(): Promise<SavedList[]> {
  const db = await openDB()
  const tx = db.transaction(LISTS_STORE, 'readonly')
  const rows = await requestResult<ListRow[]>(tx.objectStore(LISTS_STORE).getAll())
  db.close()
  return rows.filter((r) => !r.deleted).map(fromListRow)
}

/** The live problems in one list, via the `list` index. */
export async function readListProblems(listId: string): Promise<SavedListProblem[]> {
  const db = await openDB()
  const tx = db.transaction(PROBLEMS_STORE, 'readonly')
  const index = tx.objectStore(PROBLEMS_STORE).index('list')
  const rows = await requestResult<ListProblemRow[]>(index.getAll(IDBKeyRange.only(listId)))
  db.close()
  return rows.filter((r) => !r.deleted).map(fromListProblemRow)
}

/** The set of list ids that currently (live) contain a given catalog problem — the
 *  membership checkmarks in the add-to-list sheet. */
export async function listIdsContaining(sourceCatalogId: string): Promise<Set<string>> {
  const db = await openDB()
  const tx = db.transaction(PROBLEMS_STORE, 'readonly')
  const rows = await requestResult<ListProblemRow[]>(tx.objectStore(PROBLEMS_STORE).getAll())
  db.close()
  const ids = new Set<string>()
  for (const r of rows) {
    if (!r.deleted && r.source_catalog_id === sourceCatalogId) ids.add(r.list_id)
  }
  return ids
}

/** The union of `source_catalog_id`s across the given lists (live rows only) — the
 *  membership set backing the catalog's saved-list filter (OR across lists). Empty input
 *  → empty set, no DB read. */
export async function readListMemberIds(listIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>()
  const wanted = new Set(listIds)
  if (wanted.size === 0) return ids
  const db = await openDB()
  const tx = db.transaction(PROBLEMS_STORE, 'readonly')
  const rows = await requestResult<ListProblemRow[]>(tx.objectStore(PROBLEMS_STORE).getAll())
  db.close()
  for (const r of rows) {
    if (!r.deleted && wanted.has(r.list_id)) ids.add(r.source_catalog_id)
  }
  return ids
}

/** Live problem counts per list id (for the index rows). */
export async function countListProblems(): Promise<Map<string, number>> {
  const db = await openDB()
  const tx = db.transaction(PROBLEMS_STORE, 'readonly')
  const rows = await requestResult<ListProblemRow[]>(tx.objectStore(PROBLEMS_STORE).getAll())
  db.close()
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (r.deleted) continue
    counts.set(r.list_id, (counts.get(r.list_id) ?? 0) + 1)
  }
  return counts
}

/** Write-through cache for optimistic list mutations: put live rows, delete tombstoned
 *  ones (same rule as the pull). Rollback re-applies with the flag flipped. Pass `gen`
 *  (the generation captured at the start of a mutation) for any write that FOLLOWS a
 *  network await, so a write straddling an identity switch is dropped (KTD-I9). Omit it
 *  for a synchronous optimistic write that can't straddle a clear. */
export async function cacheLists(rows: ListRow[], gen?: number): Promise<void> {
  await applyRows(LISTS_STORE, rows, gen)
}

export async function cacheListProblems(rows: ListProblemRow[], gen?: number): Promise<void> {
  await applyRows(PROBLEMS_STORE, rows, gen)
}

async function applyRows(
  store: string,
  rows: Array<{ id: string; deleted: boolean }>,
  gen?: number,
): Promise<void> {
  if (rows.length === 0) return
  // A caller-supplied generation that no longer matches means the cache was cleared
  // (identity switch) after this write was scheduled — drop it (KTD-I9).
  if (gen !== undefined && gen !== cacheGeneration) return
  const db = await openDB()
  const tx = db.transaction(store, 'readwrite')
  const objectStore = tx.objectStore(store)
  for (const row of rows) {
    if (row.deleted) objectStore.delete(row.id)
    else objectStore.put(row)
  }
  await txDone(tx)
  db.close()
}

/** Clear both stores and both cursors — the sign-out / user-switch reset (KTD-I9). One
 *  user's private lists must never paint for the next. */
export async function clearListsCache(): Promise<void> {
  // Bump the generation FIRST so any in-flight pull/mutation that captured the old value
  // drops its post-await write instead of re-poisoning the cache we're about to clear.
  cacheGeneration++
  const db = await openDB()
  const tx = db.transaction([LISTS_STORE, PROBLEMS_STORE], 'readwrite')
  tx.objectStore(LISTS_STORE).clear()
  tx.objectStore(PROBLEMS_STORE).clear()
  await txDone(tx)
  db.close()
  localStorage.removeItem(LISTS_CURSOR)
  localStorage.removeItem(PROBLEMS_CURSOR)
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
