// Offline cache + incremental high-water-mark sync for user-authored problems.
//
// Its own IndexedDB database, `moonboard-user-problems` (KTD3) — deliberately NOT a new
// object store inside `moonboard-catalog`, whose version bump would throw `VersionError`
// in any still-open tab running the previous bundle (`openDB` has no `onblocked` /
// `onversionchange` handling). `moonboard-lists` set that precedent. The two databases are
// merged at READ time by catalogSync, which also means Settings → "Rebuild catalog" wipes
// only imported rows and can never destroy something a user authored (R9/AE4).
//
// Rows are keyed by `source_catalog_id` ('user:' || id, generated server-side) so the cache
// keys on the same text id every downstream surface — ascents, session queues, lit-problem
// pointers — already stores.
//
// The pull is catalogSync's PAGED shape (empty-page termination, advance-by-rows-returned,
// `>=` cursor), not listsSync's single unpaged `.select()`, which silently truncates at
// PostgREST's ~1000-row cap. The cache-generation guard is listsSync's (KTD-I9): a pull or
// mutation in flight across a sign-out must not write the previous user's private rows back
// into the just-cleared cache.

import { supabase } from '../supabase/client'
import {
  USER_PROBLEM_COLUMNS,
  fromUserProblemRow,
  type UserProblem,
  type UserProblemRow,
} from './userProblemsTypes'

// Two lanes feed this cache and they must not fight over the same rows (KTD4/KTD5):
// OWN rows arrive on the `updated_at` cursor delta above, tombstones included; OTHER users'
// PUBLIC rows arrive as a full per-slab snapshot below, where absence — not a tombstone — is
// what retracts a row. The snapshot never applies own rows even though the query returns
// them: the delta lane already owns them, and a snapshot page fetched moments before an
// optimistic delete would otherwise resurrect a problem its author just removed.

const DB_NAME = 'moonboard-user-problems'
const DB_VERSION = 1
const STORE = 'problems'
const META_STORE = 'meta'
const CURSOR_KEY = 'userProblemsCursor'
const USER_META_KEY = 'currentUserId'
const EPOCH = '1970-01-01T00:00:00+00:00'

/** Rows per `range()` window. Exported so tests can span a real multi-page pull rather
 *  than assume the paging shape. */
export const USER_PROBLEMS_PAGE_SIZE = 1000
const PAGE_RETRIES = 2
const RETRY_BASE_MS = 250

// Cache generation (KTD-I9 async-identity guard). clearOwnUserProblems() bumps this; every
// cache write that follows a network await captures the generation it started under and
// drops itself if the generation has since changed. Without it, a pull or a mutation
// reconcile in flight when the user signed out would resolve under the OLD user's RLS and
// write their private problems back into the cache we just cleared.
let cacheGeneration = 0

/** The current cache generation — captured by callers before an await, re-checked at the
 *  write boundary. A changed value means own rows were cleared (identity switch) meanwhile. */
export function currentCacheGeneration(): number {
  return cacheGeneration
}

/** Thrown by the pull's page handler when the identity changed mid-flight, to abandon the
 *  remaining pages instead of writing them. Never escapes this module. */
class StaleGenerationError extends Error {}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Human-readable text for a thrown / PostgREST error. */
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
        // A compound index key is invalid — and the record therefore absent from the index —
        // when any component is null. That is exactly what legacy iOS rows (null layout_id /
        // angle) need: never in a slab read, still resolvable by id (R14).
        store.createIndex('slab', ['layout_id', 'angle'])
        store.createIndex('owner', 'user_id')
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Result of a pull: whether it actually reached the server, and why not when it didn't. */
export interface UserProblemsSyncResult {
  /** True when the delta pull completed (including a valid empty result); false when it
   *  failed (offline / 5xx / timeout) and the cache is served stale. */
  synced: boolean
  /** Why the pull failed, when `synced` is false. */
  error?: string
}

/**
 * Page one user's OWN user_problems delta (`updated_at >= cursor`) from Supabase, handing
 * each non-empty page to `onPage` as it arrives. Exported so the pagination can be tested
 * without IndexedDB.
 *
 * `.eq('user_id', …)` is not redundant with RLS: today the owner-only policy scopes the
 * result anyway, but once 0019 adds a public read policy an unscoped select would start
 * feeding other users' rows into this cursor — the cursor tracks OWN rows only, and public
 * rows sync by a different (per-slab snapshot) path.
 *
 * `>=` rather than `>`: a strict `>` permanently skips a row whose `updated_at` exactly
 * equals the stored cursor, which is realistic because one batch stamps every row in the
 * transaction with the same value. Re-pulling the boundary is a no-op (`put` is idempotent).
 */
export async function eachUserProblemDeltaPage(
  client: NonNullable<typeof supabase>,
  userId: string,
  cursor: string,
  onPage: (page: UserProblemRow[]) => void | Promise<void>,
): Promise<void> {
  for (let from = 0; ; ) {
    const page = await fetchPage(client, userId, cursor, from)
    if (page.length === 0) break
    await onPage(page)
    // Advance by the rows actually returned, never by a fixed stride: a server whose
    // max-rows cap sits below our page size returns short pages, and treating a short page
    // as the last one is the silent-truncation bug catalogSync already documents.
    from += page.length
  }
}

/** One `range()` window, retried past transient failures. Throws the last error. */
async function fetchPage(
  client: NonNullable<typeof supabase>,
  userId: string,
  cursor: string,
  from: number,
): Promise<UserProblemRow[]> {
  let lastError: unknown
  for (let attempt = 0; attempt <= PAGE_RETRIES; attempt++) {
    if (attempt > 0) await delay(RETRY_BASE_MS * attempt)
    const { data, error } = await client
      .from('user_problems')
      .select(USER_PROBLEM_COLUMNS)
      .eq('user_id', userId)
      .gte('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + USER_PROBLEMS_PAGE_SIZE - 1)
    if (!error) return (data ?? []) as unknown as UserProblemRow[]
    lastError = error
  }
  throw lastError
}

/**
 * Pull the signed-in user's own problems and merge them into IndexedDB, advancing the
 * high-water cursor per applied page. Best-effort: a failure leaves the cursor at the last
 * committed page and returns `synced: false`, so the cache stays readable and the next pull
 * resumes. `onApplied` fires once per committed page, so a mounted catalog list repaints
 * progressively instead of only at the end.
 */
export async function syncUserProblems(
  userId: string,
  onApplied?: () => void,
): Promise<UserProblemsSyncResult> {
  if (!supabase || !userId) return { synced: false }
  // Capture the generation this pull starts under: if the identity changes while a page is
  // in flight, applyPage refuses to write and the pull abandons the rest (KTD-I9).
  const gen = cacheGeneration
  try {
    await eachUserProblemDeltaPage(supabase, userId, readCursor(), async (page) => {
      const newest = await applyPage(page, gen)
      // Persist per page, not once at the end: pages arrive oldest-first, so a pull that
      // dies on a later page leaves a shorter — never a gappy — cache.
      if (newest > readCursor()) localStorage.setItem(CURSOR_KEY, newest)
      onApplied?.()
    })
  } catch (err) {
    if (err instanceof StaleGenerationError) return { synced: false }
    return { synced: false, error: errorMessage(err) }
  }
  return { synced: true }
}

function readCursor(): string {
  return localStorage.getItem(CURSOR_KEY) ?? EPOCH
}

/** Merge one page (tombstones delete, the rest upsert); returns its newest `updated_at`. */
async function applyPage(rows: UserProblemRow[], gen: number): Promise<string> {
  if (gen !== cacheGeneration) throw new StaleGenerationError()
  const db = await openDB()
  try {
    // Re-checked after the open await: the clear can land between the two.
    if (gen !== cacheGeneration) throw new StaleGenerationError()
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

/** Whether own rows have ever been pulled (a cursor exists). Cold = one auto pull; warm =
 *  paint from cache with no automatic network. */
export function hasUserProblemsCursor(): boolean {
  return localStorage.getItem(CURSOR_KEY) !== null
}

// ─── Public per-slab snapshot (KTD5) ──────────────────────────────────────────

/** The two policy decisions the snapshot doesn't own, injected by userProblemsStore. */
export interface PublicSnapshotHooks {
  /**
   * How to drop the rows the snapshot no longer lists. Defaults to the cache-only
   * {@link evictCachedUserProblems}; the store passes its `evictUserProblems`, which also
   * prunes the dangling id from recents and favorites and fires the change notification —
   * so production evictions repaint the open list and the test default stays dependency-free.
   */
  evict?: (ids: string[]) => Promise<void>
  /** Fired once per applied page, like {@link syncUserProblems}'s `onApplied`. */
  onApplied?: () => void
}

/**
 * Page one slab's full list of live public problems. No cursor and no tombstones: this is a
 * snapshot, so the caller compares it against the cache and treats ABSENCE as retraction.
 *
 * Ordered by `id`, not `updated_at`: a snapshot is paged across several round-trips, and a
 * row edited between two of them would slide to the end of an `updated_at` ordering and be
 * missed entirely (it would then be evicted as "absent" until the next sync). `id` never
 * changes, so only genuine inserts and deletes shift the windows. The set is small by design
 * — per-user cap × active setters, per slab — so sorting it costs nothing.
 */
export async function eachPublicUserProblemPage(
  client: NonNullable<typeof supabase>,
  layoutId: number,
  angle: number,
  onPage: (page: UserProblemRow[]) => void | Promise<void>,
): Promise<void> {
  for (let from = 0; ; ) {
    const page = await fetchPublicPage(client, layoutId, angle, from)
    if (page.length === 0) break
    await onPage(page)
    from += page.length
  }
}

/** One `range()` window of the snapshot, retried past transient failures. */
async function fetchPublicPage(
  client: NonNullable<typeof supabase>,
  layoutId: number,
  angle: number,
  from: number,
): Promise<UserProblemRow[]> {
  let lastError: unknown
  for (let attempt = 0; attempt <= PAGE_RETRIES; attempt++) {
    if (attempt > 0) await delay(RETRY_BASE_MS * attempt)
    const { data, error } = await client
      .from('user_problems')
      .select(USER_PROBLEM_COLUMNS)
      .eq('layout_id', layoutId)
      .eq('angle', angle)
      // Explicit, not left to RLS: 0019's public policy ORs with the owner policy, so an
      // unfiltered select would hand the caller their own private rows and tombstones as
      // part of the "public" snapshot — and every own row missing from it would then read
      // as a retraction.
      .eq('visibility', 'public')
      .eq('deleted', false)
      .order('id', { ascending: true })
      .range(from, from + USER_PROBLEMS_PAGE_SIZE - 1)
    if (!error) return (data ?? []) as unknown as UserProblemRow[]
    lastError = error
  }
  throw lastError
}

/**
 * Reconcile the cache with one slab's public snapshot: upsert every listed row from another
 * setter, then evict the cached public rows the list no longer contains. That single rule
 * covers retraction, deletion, account deletion and re-publishing with no extra machinery —
 * the list is ground truth (KTD5, R12/AE2).
 *
 * `ownUserId` is the fence: own rows are never applied and never evicted. They can't be
 * evicted safely — a private row is absent from a public snapshot by definition, so
 * eviction-by-absence would delete the author's own work — and they don't need applying,
 * because the cursor delta lane already syncs them, tombstones and all. Signed out
 * (`ownUserId` null) nothing is fenced: every row that can be cached is somebody else's
 * public one.
 *
 * Best-effort like every other pull. A failed page leaves the cache exactly as it was —
 * crucially including NO eviction, so an offline device keeps browsing what it has rather
 * than reading a failed pull as "everything was retracted".
 */
export async function syncPublicUserProblemsForSlab(
  layoutId: number,
  angle: number,
  ownUserId: string | null,
  hooks: PublicSnapshotHooks = {},
): Promise<UserProblemsSyncResult> {
  // Unconfigured Supabase is "nothing to pull", not a failure — the same degradation
  // catalogSync's syncSlab makes, so an unconfigured build doesn't render as offline.
  if (!supabase) return { synced: true }
  const gen = cacheGeneration
  const listed = new Set<string>()
  try {
    await eachPublicUserProblemPage(supabase, layoutId, angle, async (page) => {
      // An identity switch mid-pull abandons the remaining pages rather than fetching a
      // snapshot nobody will apply — the same bail-out the delta pull makes.
      if (gen !== cacheGeneration) throw new StaleGenerationError()
      // Own rows count as listed (nothing may evict them) but are not written.
      for (const row of page) listed.add(row.source_catalog_id)
      const others = page.filter((row) => row.user_id !== ownUserId)
      if (others.length === 0) return
      await cacheUserProblems(others, gen)
      hooks.onApplied?.()
    })
  } catch (err) {
    if (err instanceof StaleGenerationError) return { synced: false }
    return { synced: false, error: errorMessage(err) }
  }
  // Re-checked after the last page: an identity switch mid-pull means this snapshot was read
  // under the previous user's session, and its evictions would be theirs, not ours.
  if (gen !== cacheGeneration) return { synced: false }
  const cached = await readUserProblemsForSlab(layoutId, angle)
  const absent = cached
    .filter((p) => p.userId !== ownUserId && !listed.has(p.sourceCatalogId))
    .map((p) => p.sourceCatalogId)
  if (absent.length > 0) await (hooks.evict ?? evictCachedUserProblems)(absent)
  return { synced: true }
}

/**
 * Write-through cache for optimistic mutations: put live rows, delete tombstoned ones (the
 * same rule as the pull). Pass `gen` — the generation captured at the start of a mutation —
 * for any write that FOLLOWS a network await, so a write straddling an identity switch is
 * dropped. Omit it for a synchronous optimistic write that cannot straddle a clear.
 */
export async function cacheUserProblems(rows: UserProblemRow[], gen?: number): Promise<void> {
  if (rows.length === 0) return
  if (gen !== undefined && gen !== cacheGeneration) return
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const row of rows) {
      if (row.deleted) store.delete(row.source_catalog_id)
      else store.put(row)
    }
    await txDone(tx)
  } finally {
    db.close()
  }
}

/** Drop cached rows by id without a server round-trip — the local half of evicting a
 *  public row that no longer resolves. Own soft-deletes go through cacheUserProblems with
 *  the tombstone flag instead, so they can be rolled back from the row we still hold. */
export async function evictCachedUserProblems(ids: string[], gen?: number): Promise<void> {
  if (ids.length === 0) return
  if (gen !== undefined && gen !== cacheGeneration) return
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const id of ids) store.delete(id)
    await txDone(tx)
  } finally {
    db.close()
  }
}

/** Cached user problems for one board+angle, sorted like `readSlab` so a merged catalog
 *  list needs no re-sort. Legacy rows with no board are absent from the slab index and so
 *  never appear here (R14). */
export async function readUserProblemsForSlab(
  layoutId: number,
  angle: number,
): Promise<UserProblem[]> {
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const index = tx.objectStore(STORE).index('slab')
    const rows = await requestResult<UserProblemRow[]>(index.getAll(IDBKeyRange.only([layoutId, angle])))
    return rows.map(fromUserProblemRow).sort((a, b) =>
      a.grade === b.grade ? a.name.localeCompare(b.name) : a.grade.localeCompare(b.grade),
    )
  } finally {
    db.close()
  }
}

/**
 * Look up cached user problems by their `user:`-prefixed text ids, returning a map keyed by
 * `source_catalog_id`. Board-agnostic, so a legacy row with no layout/angle still resolves.
 * Missing ids are simply absent, matching `getCatalogProblemsByIds`'s fallback contract.
 */
export async function getUserProblemsByIds(ids: string[]): Promise<Map<string, UserProblem>> {
  const result = new Map<string, UserProblem>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return result
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const found = await Promise.all(
      unique.map((id) => requestResult<UserProblemRow | undefined>(store.get(id))),
    )
    for (const row of found) {
      if (row) result.set(row.source_catalog_id, fromUserProblemRow(row))
    }
    return result
  } finally {
    db.close()
  }
}

/** The cached text ids belonging to the cached identity — what the catalog's "Mine" facet
 *  filters on. Empty when signed out. */
export async function ownUserProblemIds(): Promise<Set<string>> {
  const userId = await readCachedUserId()
  const ids = new Set<string>()
  if (!userId) return ids
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const index = tx.objectStore(STORE).index('owner')
    const keys = await requestResult<IDBValidKey[]>(index.getAllKeys(IDBKeyRange.only(userId)))
    for (const key of keys) ids.add(String(key))
    return ids
  } finally {
    db.close()
  }
}

// ─── Identity (KTD-I9 / KTD4) ─────────────────────────────────────────────────

/** The identity this cache was last populated for ('' when signed out / never synced). */
export async function readCachedUserId(): Promise<string> {
  const db = await openDB()
  try {
    const tx = db.transaction(META_STORE, 'readonly')
    const entry = await requestResult<{ key: string; value: string } | undefined>(
      tx.objectStore(META_STORE).get(USER_META_KEY),
    )
    return entry?.value ?? ''
  } finally {
    db.close()
  }
}

/** Record the identity the cache now belongs to. This is the identity GATE — advance it
 *  only after the outgoing user's rows are actually gone (see syncUserProblemsIdentity). */
export async function setCachedUserId(userId: string): Promise<void> {
  const db = await openDB()
  try {
    const tx = db.transaction(META_STORE, 'readwrite')
    tx.objectStore(META_STORE).put({ key: USER_META_KEY, value: userId })
    await txDone(tx)
  } finally {
    db.close()
  }
}

/**
 * Sign-out / user-switch reset: drop the outgoing user's OWN rows and the cursor.
 *
 * Deliberately NOT a full clear. Own rows are private and must never paint for the next
 * user on a shared device; cached rows authored by SOMEBODY ELSE are public by definition
 * (nothing else can reach this cache), carry no private data, and staying cached is what
 * keeps a shared board browsable straight after a sign-out.
 */
export async function clearOwnUserProblems(userId: string): Promise<void> {
  // Bump the generation FIRST so any in-flight pull or mutation that captured the old value
  // drops its post-await write instead of re-poisoning the cache we are about to clear.
  cacheGeneration++
  // The cursor tracks own rows only, so it goes on every identity change — including one
  // where we never knew the outgoing user and so delete nothing.
  localStorage.removeItem(CURSOR_KEY)
  if (!userId) return
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const keys = await requestResult<IDBValidKey[]>(
      store.index('owner').getAllKeys(IDBKeyRange.only(userId)),
    )
    for (const key of keys) store.delete(key)
    await txDone(tx)
  } finally {
    db.close()
  }
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
