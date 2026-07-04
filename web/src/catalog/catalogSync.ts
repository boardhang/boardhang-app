// Download-and-cache the MoonBoard catalog for the PWA, one board+angle "slab" at a
// time. Mirrors the iOS CatalogSyncManager: lazy per board (call syncSlab when a board is
// selected), high-water-mark deltas (pull updated_at > cursor, apply `deleted` tombstones),
// cached locally so browsing is fast and offline after the first sync. Cache = IndexedDB
// (the ~thousands of problems per slab are too big for localStorage); the per-slab cursor
// = localStorage.

import { restGet } from '../lib/supabase'
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
    const rows = await restGet<CatalogRow>(
      'catalog_problems',
      `layout_id=eq.${layoutId}&angle=eq.${angle}` +
        `&updated_at=gt.${encodeURIComponent(cursor)}&order=updated_at.asc&select=*`,
    )
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
