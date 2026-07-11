// Download-and-cache the MoonBoard catalog for the PWA, one board+angle "slab" at a
// time. Mirrors the iOS CatalogSyncManager: lazy per board (call syncSlab when a board is
// selected), high-water-mark deltas (pull updated_at > cursor, apply `deleted` tombstones),
// cached locally so browsing is fast and offline after the first sync. Cache = IndexedDB
// (the ~thousands of problems per slab are too big for localStorage); the per-slab cursor
// = localStorage.

import { supabase } from '../supabase/client'
import type { HoldType } from '../types'

export interface CatalogHold {
  c: number
  r: number
  t: HoldType
}

export interface CatalogProblem {
  source_catalog_id: string
  layout_id: number
  angle: number
  name: string
  grade: string
  /** Setter's suggested grade, when it differs from the consensus `grade`. */
  user_grade: string | null
  setter: string
  stars: number
  repeats: number
  is_benchmark: boolean
  /** Ascent method label (e.g. "Footless"), or null when unmarked. */
  method: string | null
  holds: CatalogHold[]
}

/** The full row as it arrives from Supabase (superset of what the UI needs). */
interface CatalogRow extends CatalogProblem {
  updated_at: string
  deleted: boolean
}

const DB_NAME = 'moonboard-catalog'
const STORE = 'problems'
const DB_VERSION = 1
const EPOCH = '1970-01-01T00:00:00+00:00'
// PostgREST caps a response at ~1000 rows, so a slab larger than that (the full
// boards run to ~20k) must be pulled page-by-page. We terminate on an EMPTY page and
// advance by the rows actually returned (not by a fixed PAGE_SIZE stride), so even a
// server whose cap is BELOW PAGE_SIZE still syncs the whole slab instead of stopping
// after one short page — the original single-page truncation bug.
const PAGE_SIZE = 1000

function cursorKey(layoutId: number, angle: number): string {
  return `catalogCursor.${layoutId}_${angle}`
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'source_catalog_id' })
        store.createIndex('slab', ['layout_id', 'angle'])
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Result of a slab sync: the cached problems plus whether the network pull succeeded. */
export interface SyncResult {
  problems: CatalogProblem[]
  /** True when the delta pull completed (including a valid empty/unconfigured result);
   *  false when it failed (offline, 5xx, CORS, timeout) and the slab is served stale. */
  synced: boolean
}

/**
 * Page the full catalog delta for one slab (rows with `updated_at >= cursor`) from
 * Supabase. Exported so the pagination can be unit-tested without IndexedDB.
 *
 * Two correctness properties the naive single-`.select()` lacked:
 * - Terminates on an EMPTY page and advances by the rows actually returned, so a
 *   `max-rows` cap below PAGE_SIZE can't be misread as the last page (silent truncation).
 * - Uses `>= cursor`, not `>`: a strict `>` permanently skips a row whose `updated_at`
 *   exactly equals the stored cursor — realistic because a batch upsert stamps every row
 *   in the transaction with the same `updated_at`, so a client that syncs mid-import and
 *   parks its cursor on that value would never see the rest of that batch. Re-pulling the
 *   boundary rows is a no-op on apply (`store.put` is keyed by PK, idempotent).
 * Ordered by (updated_at, source_catalog_id) so `range()` windows are deterministic even
 * across equal `updated_at` values.
 */
export async function fetchCatalogDeltas(
  client: NonNullable<typeof supabase>,
  layoutId: number,
  angle: number,
  cursor: string,
): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = []
  for (let from = 0; ; ) {
    const { data, error } = await client
      .from('catalog_problems')
      .select('*')
      .eq('layout_id', layoutId)
      .eq('angle', angle)
      .gte('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .order('source_catalog_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as CatalogRow[]
    rows.push(...page)
    if (page.length === 0) break
    from += page.length
  }
  return rows
}

/**
 * Pull catalog deltas for one board+angle slab from Supabase, merge them into IndexedDB,
 * and advance the high-water-mark cursor. Lazy per board — call it when a board is
 * selected. Best-effort: on an offline / transient failure it leaves the cursor untouched
 * and returns whatever is already cached (with `synced: false`), so the next call retries
 * and callers can flag the data as degraded. Problems are sorted by (grade, name).
 */
export async function syncSlab(layoutId: number, angle: number): Promise<SyncResult> {
  const cursor = localStorage.getItem(cursorKey(layoutId, angle)) ?? EPOCH
  let synced = true
  try {
    // High-water-mark delta pull: rows changed since our cursor, oldest-first so the
    // cursor advances monotonically. When Supabase is unconfigured we degrade to "no
    // data" (the app still runs) rather than failing — same as the old anon REST path.
    const rows: CatalogRow[] = supabase
      ? await fetchCatalogDeltas(supabase, layoutId, angle, cursor)
      : []
    if (rows.length > 0) {
      const db = await openDB()
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      let newest = cursor
      for (const row of rows) {
        if (row.deleted) store.delete(row.source_catalog_id)
        else store.put(row)
        if (row.updated_at > newest) newest = row.updated_at
      }
      await txDone(tx)
      db.close()
      localStorage.setItem(cursorKey(layoutId, angle), newest)
    }
  } catch {
    // Offline / transient — fall through to the cached slab; cursor unchanged for retry.
    synced = false
  }
  return { problems: await readSlab(layoutId, angle), synced }
}

/**
 * Force a full re-pull of one slab: reset the high-water-mark cursor to EPOCH so the next
 * sync re-fetches the ENTIRE slab from scratch, repairing a cache that's missing rows — e.g.
 * one cached before a catalog re-import, or left short by the old single-page truncation bug.
 * Additive (re-`put`s every current row via the normal paged sync); rows deleted server-side
 * are still pruned by the usual `deleted`-tombstone delta. Backs the catalog pull-to-refresh.
 */
export async function resyncSlab(layoutId: number, angle: number): Promise<SyncResult> {
  localStorage.removeItem(cursorKey(layoutId, angle))
  return syncSlab(layoutId, angle)
}

/**
 * Look up cached catalog problems by their stable ids (primary key), returning a map
 * keyed by `source_catalog_id`. Used to enrich logbook rows with setter/benchmark/holds
 * — an offline, board-agnostic lookup. Missing ids (user problems, uncached entries)
 * are simply absent from the map, so callers fall back gracefully.
 */
export async function getCatalogProblemsByIds(
  ids: string[],
): Promise<Map<string, CatalogProblem>> {
  const result = new Map<string, CatalogProblem>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return result
  const db = await openDB()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const found = await Promise.all(unique.map((id) => requestResult<CatalogProblem | undefined>(store.get(id))))
  db.close()
  for (const problem of found) {
    if (problem) result.set(problem.source_catalog_id, problem)
  }
  return result
}

/** Read a slab's cached problems from IndexedDB (used offline and after a sync). */
export async function readSlab(layoutId: number, angle: number): Promise<CatalogProblem[]> {
  const db = await openDB()
  const tx = db.transaction(STORE, 'readonly')
  const index = tx.objectStore(STORE).index('slab')
  const problems = await requestResult<CatalogProblem[]>(index.getAll(IDBKeyRange.only([layoutId, angle])))
  db.close()
  return problems.sort((a, b) =>
    a.grade === b.grade ? a.name.localeCompare(b.name) : a.grade.localeCompare(b.grade),
  )
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
