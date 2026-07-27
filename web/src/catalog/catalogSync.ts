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
// A single page can fail transiently (flaky mobile radio, a 5xx, a timeout) in the middle
// of a 20k-row slab. Retry the page a couple of times before giving up on the whole pull —
// without this, one blip discards every page fetched so far and the user starts over.
const PAGE_RETRIES = 2
const RETRY_BASE_MS = 250

function cursorKey(layoutId: number, angle: number): string {
  return `catalogCursor.${layoutId}_${angle}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Human-readable text for a thrown/PostgREST error, for the Settings rebuild UI. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
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
  /** Why the pull failed, when `synced` is false. Surfaced by the Settings rebuild so a
   *  repeatable failure (quota, CORS, 5xx) is diagnosable instead of a silent short slab. */
  error?: string
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
  await eachCatalogDeltaPage(client, layoutId, angle, cursor, (page) => {
    rows.push(...page)
  })
  return rows
}

/**
 * The streaming form of {@link fetchCatalogDeltas}: hand each non-empty page to `onPage`
 * as it arrives instead of accumulating the whole slab in memory. `syncSlab` uses this to
 * write page-by-page, which matters on a 20k-row board: the rows already fetched are
 * durably cached (and the cursor advanced) even if a later page fails, so a repeatedly
 * interrupted pull converges instead of discarding everything on each attempt.
 *
 * A page that errors is retried PAGE_RETRIES times with a short backoff before the pull
 * gives up; `onPage` throwing (an IndexedDB write failure) aborts immediately — retrying
 * the network for a full disk would only spin.
 */
export async function eachCatalogDeltaPage(
  client: NonNullable<typeof supabase>,
  layoutId: number,
  angle: number,
  cursor: string,
  onPage: (page: CatalogRow[]) => void | Promise<void>,
): Promise<void> {
  for (let from = 0; ; ) {
    const page = await fetchPage(client, layoutId, angle, cursor, from)
    if (page.length === 0) break
    await onPage(page)
    from += page.length
  }
}

/** One `range()` window, retried past transient failures. Throws the last error. */
async function fetchPage(
  client: NonNullable<typeof supabase>,
  layoutId: number,
  angle: number,
  cursor: string,
  from: number,
): Promise<CatalogRow[]> {
  let lastError: unknown
  for (let attempt = 0; attempt <= PAGE_RETRIES; attempt++) {
    if (attempt > 0) await delay(RETRY_BASE_MS * attempt)
    const { data, error } = await client
      .from('catalog_problems')
      .select('*')
      .eq('layout_id', layoutId)
      .eq('angle', angle)
      .gte('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .order('source_catalog_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (!error) return (data ?? []) as CatalogRow[]
    lastError = error
  }
  throw lastError
}

/** Merge one page into IndexedDB (tombstones delete, rest upsert); returns the page's
 *  newest `updated_at` so the caller can advance the high-water mark. */
async function applyPage(rows: CatalogRow[]): Promise<string> {
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    let newest = EPOCH
    for (const row of rows) {
      if (row.deleted) store.delete(row.source_catalog_id)
      else store.put(row)
      if (row.updated_at > newest) newest = row.updated_at
    }
    await txDone(tx)
    return newest
  } finally {
    db.close()
  }
}

/**
 * Pull catalog deltas for one board+angle slab from Supabase, merge them into IndexedDB,
 * and advance the high-water-mark cursor. Lazy per board — call it when a board is
 * selected. Best-effort: on an offline / transient failure it leaves the cursor untouched
 * and returns whatever is already cached (with `synced: false`), so the next call retries
 * and callers can flag the data as degraded. Problems are sorted by (grade, name).
 */
export async function syncSlab(layoutId: number, angle: number): Promise<SyncResult> {
  const key = cursorKey(layoutId, angle)
  const cursor = localStorage.getItem(key) ?? EPOCH
  let synced = true
  let error: string | undefined
  try {
    // High-water-mark delta pull: rows changed since our cursor, oldest-first so the
    // cursor advances monotonically. When Supabase is unconfigured we degrade to "no
    // data" (the app still runs) rather than failing — same as the old anon REST path.
    if (supabase) {
      await eachCatalogDeltaPage(supabase, layoutId, angle, cursor, async (page) => {
        const newest = await applyPage(page)
        // Persist per page, not once at the end: pages arrive oldest-first, so every row
        // older than `newest` is already committed and a pull that dies on a later page
        // leaves a shorter — never a gappy — slab. Safe against equal `updated_at` values
        // because the next pull re-fetches the boundary with `>=` (idempotent `put`).
        if (newest > (localStorage.getItem(key) ?? EPOCH)) localStorage.setItem(key, newest)
      })
    }
  } catch (err) {
    // Offline / transient — fall through to the cached slab; whatever pages landed stay
    // cached and the cursor sits at the last committed page, so the next call resumes.
    synced = false
    error = errorMessage(err)
  }
  return { problems: await readSlab(layoutId, angle), synced, error }
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
 * Hard reset of one slab: drop every cached row AND its cursor, then re-download the slab
 * from scratch. The nuclear option behind Settings → "Rebuild catalog", for the case
 * pull-to-refresh can't fix — a cache that a browser storage eviction, an aborted first
 * sync, or a full origin quota left permanently short (the only previous cure was deleting
 * the browser/PWA and reinstalling).
 *
 * Deliberately destructive-then-refetch, in that order: it frees the origin's quota before
 * writing, and prunes rows an additive `resyncSlab` would keep (a problem deleted server
 * side while we were away, whose tombstone predates our cursor). The trade-off is that a
 * rebuild interrupted by a dead network leaves the slab shorter than it started — so the
 * UI confirms first, and the next sync refills it.
 */
export async function rebuildSlab(layoutId: number, angle: number): Promise<SyncResult> {
  await clearSlab(layoutId, angle)
  return syncSlab(layoutId, angle)
}

/** Delete one slab's cached rows and forget its cursor (leaves other boards alone). */
export async function clearSlab(layoutId: number, angle: number): Promise<void> {
  localStorage.removeItem(cursorKey(layoutId, angle))
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const keys = await requestResult<IDBValidKey[]>(
      store.index('slab').getAllKeys(IDBKeyRange.only([layoutId, angle])),
    )
    for (const key of keys) store.delete(key)
    await txDone(tx)
  } finally {
    db.close()
  }
}

/** How many problems are cached for a slab — what the catalog can show offline. Backs the
 *  per-board counts in Settings, so "only 150 problems" is visible instead of guessed. */
export async function countSlab(layoutId: number, angle: number): Promise<number> {
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const index = tx.objectStore(STORE).index('slab')
    return await requestResult<number>(index.count(IDBKeyRange.only([layoutId, angle])))
  } finally {
    db.close()
  }
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
