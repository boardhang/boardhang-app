// Mutations and change notifications for user-authored problems, layered on the
// userProblemsSync cache. Mirrors lists/listsStore.ts: optimistic write-through with
// rollback on a cloud error, a cache-generation captured before every network await, an
// identity hook wired from AuthProvider, and a listener Set the catalog subscribes to.
//
// Unlike listsStore there is no in-memory list of rows: user problems are read back through
// the catalog's slab/by-id resolvers (U3 merges the two caches), so every mutation writes
// IndexedDB and then fires `notifyUserProblemsChanged` — the only signal a mounted catalog
// list gets that a save, edit, or delete happened (R7).
//
// Notification contract: each successful mutation notifies EXACTLY ONCE, at the optimistic
// write. Because the primary key is client-generated, the server reconcile rewrites the same
// cache key with nothing user-visible changed, so it writes silently. A rollback notifies
// again — that one IS user-visible, the row has to disappear.

import { supabase } from '../supabase/client'
import { pruneFavorites } from './favoritesStore'
import { pruneRecents } from './recentsStore'
import {
  cacheUserProblems,
  clearOwnUserProblems,
  currentCacheGeneration,
  evictCachedUserProblems,
  getUserProblemsByIds,
  hasUserProblemsCursor,
  readCachedUserId,
  setCachedUserId,
  syncUserProblems,
} from './userProblemsSync'
import {
  USER_PROBLEM_COLUMNS,
  applyUserProblemPatch,
  fromUserProblemRow,
  toUserProblemRow,
  userProblemCatalogId,
  userProblemInsertPayload,
  userProblemUpdatePayload,
  type UserProblem,
  type UserProblemPatch,
  type UserProblemRow,
  type UserProblemVisibility,
} from './userProblemsTypes'
import type { CatalogHold } from './catalogSync'

const SIGNED_OUT_MESSAGE = 'You need to be signed in to do that.'
const OFFLINE_SAVE_MESSAGE =
  "You're offline — this problem can't be saved until you're back online."
const OFFLINE_CHANGE_MESSAGE =
  "You're offline — that change can't be saved until you're back online."
const NOT_CACHED_MESSAGE = "That problem isn't on this device — open it again and retry."

/** The fields the editor supplies for a brand-new problem. `layoutId`/`angle` come from the
 *  slab it was drawn on: a hold grid means nothing without the board behind it. */
export interface NewUserProblem {
  layoutId: number
  angle: number
  name: string
  grade: string
  holds: CatalogHold[]
  visibility?: UserProblemVisibility
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

/**
 * Whether a failed write failed because the device is offline rather than because the
 * server rejected it. supabase-js surfaces a dead network as the underlying fetch rejection
 * ("Failed to fetch" / "Load failed" / "Network request failed", browser-dependent), which
 * would otherwise reach the user as unreadable plumbing.
 */
function isOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const message = errorMessage(err).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('network request failed') ||
    message.includes('networkerror')
  )
}

function writeError(err: unknown, offlineMessage: string): Error {
  if (isOfflineError(err)) return new Error(offlineMessage)
  return err instanceof Error ? err : new Error(errorMessage(err))
}

// ─── Loads ────────────────────────────────────────────────────────────────────

/** Cached-first load: a warm cache paints with no network, a cold one does a single pull.
 *  Signed out (or unconfigured) there is nothing owner-scoped to fetch. */
export async function loadUserProblems(): Promise<{ synced: boolean }> {
  const userId = await currentUserId()
  if (!userId) return { synced: false }
  if (hasUserProblemsCursor()) return { synced: true }
  return refreshUserProblems()
}

/** Explicit pull (pull-to-refresh, post-sign-in). Notifies per applied page so a mounted
 *  catalog list fills in progressively. */
export async function refreshUserProblems(): Promise<{ synced: boolean }> {
  const userId = await currentUserId()
  if (!userId) return { synced: false }
  const { synced } = await syncUserProblems(userId, notifyUserProblemsChanged)
  return { synced }
}

// ─── Mutations (optimistic, write-through, rollback on error) ─────────────────

/**
 * Author a new problem. The uuid is client-generated so the optimistic row already carries
 * the `'user:' || id` key the server will generate, which is why the reconcile is a silent
 * rewrite of the same cache entry rather than an id swap.
 *
 * The INSERT payload never includes `source_catalog_id` (GENERATED ALWAYS — PostgREST
 * rejects a supplied value) or `updated_at` (trigger-stamped); we `.select()` the row back
 * to capture both.
 */
export async function createUserProblem(input: NewUserProblem): Promise<UserProblem> {
  const gen = currentCacheGeneration()
  const client = supabase
  const userId = client ? await currentUserId() : null
  if (!client || !userId) throw new Error(SIGNED_OUT_MESSAGE)

  const id = crypto.randomUUID()
  const optimistic: UserProblemRow = {
    id,
    user_id: userId,
    name: input.name,
    grade: input.grade,
    holds: input.holds,
    layout_id: input.layoutId,
    angle: input.angle,
    visibility: input.visibility ?? 'private',
    source_catalog_id: userProblemCatalogId(id),
    // Provisional until the trigger stamps the real one; the cursor only ever advances
    // from pulled rows, so a client clock skew here can't skip a delta.
    updated_at: new Date().toISOString(),
    deleted: false,
  }
  await cacheUserProblems([optimistic], gen)
  notifyUserProblemsChanged()

  const { data, error } = await client
    .from('user_problems')
    .insert(userProblemInsertPayload(optimistic))
    .select(USER_PROBLEM_COLUMNS)
    .single()
  if (error) {
    await rollback(optimistic, null, gen)
    throw writeError(error, OFFLINE_SAVE_MESSAGE)
  }
  const saved = data as unknown as UserProblemRow
  await cacheUserProblems([saved], gen)
  return fromUserProblemRow(saved)
}

/** Edit an existing problem's name / grade / holds. */
export async function updateUserProblem(
  sourceCatalogId: string,
  patch: Pick<UserProblemPatch, 'name' | 'grade' | 'holds'>,
): Promise<UserProblem> {
  return patchUserProblem(sourceCatalogId, patch)
}

/** Publish or unpublish a problem. Storing `public` is allowed today; nobody else can read
 *  it until 0019 adds the cross-user read policy. */
export async function setUserProblemVisibility(
  sourceCatalogId: string,
  visibility: UserProblemVisibility,
): Promise<UserProblem> {
  return patchUserProblem(sourceCatalogId, { visibility })
}

async function patchUserProblem(
  sourceCatalogId: string,
  patch: UserProblemPatch,
): Promise<UserProblem> {
  const gen = currentCacheGeneration()
  const prior = await cachedRow(sourceCatalogId)
  const next = applyUserProblemPatch(prior, patch)
  await cacheUserProblems([next], gen)
  notifyUserProblemsChanged()

  const client = supabase
  if (!client) return fromUserProblemRow(next)
  const { data, error } = await client
    .from('user_problems')
    .update(userProblemUpdatePayload(patch))
    .eq('id', prior.id)
    .select(USER_PROBLEM_COLUMNS)
    .single()
  if (error) {
    await rollback(next, prior, gen)
    throw writeError(error, OFFLINE_CHANGE_MESSAGE)
  }
  const saved = data as unknown as UserProblemRow
  await cacheUserProblems([saved], gen)
  return fromUserProblemRow(saved)
}

/**
 * Soft-delete a problem. Ascent history is deliberately untouched — logbook rows keep their
 * denormalized name/grade snapshot (R15), and 0002's FK is ON DELETE SET NULL anyway.
 *
 * Recents and favorites are pruned only once the server confirms: while the delete can
 * still roll back the id is still valid, and re-adding a recents entry at its old position
 * is not something we could undo.
 */
export async function deleteUserProblem(sourceCatalogId: string): Promise<void> {
  const gen = currentCacheGeneration()
  const prior = await cachedRow(sourceCatalogId)
  await cacheUserProblems([{ ...prior, deleted: true }], gen)
  notifyUserProblemsChanged()

  const client = supabase
  if (client) {
    const { error } = await client
      .from('user_problems')
      .update({ deleted: true })
      .eq('id', prior.id)
    if (error) {
      await rollback(null, prior, gen)
      throw writeError(error, OFFLINE_CHANGE_MESSAGE)
    }
  }
  forgetDanglingIds([sourceCatalogId])
}

/**
 * Drop cached problems that no longer resolve (a public row whose author unpublished or
 * deleted it), local-only. Same dangling-id cleanup as a delete.
 */
export async function evictUserProblems(sourceCatalogIds: string[]): Promise<void> {
  if (sourceCatalogIds.length === 0) return
  await evictCachedUserProblems(sourceCatalogIds)
  forgetDanglingIds(sourceCatalogIds)
  notifyUserProblemsChanged()
}

/** An id that resolves to nothing is worse than an absent one: it still occupies one of the
 *  five recents slots (enough of them hide the Recents FAB entirely) and still counts
 *  against the favorites filter. */
function forgetDanglingIds(ids: string[]): void {
  pruneRecents(ids)
  pruneFavorites(ids)
}

/** The cached row a mutation targets. Every mutation starts from a problem the user is
 *  looking at, so an absent row means the cache was cleared underneath them. */
async function cachedRow(sourceCatalogId: string): Promise<UserProblemRow> {
  const found = (await getUserProblemsByIds([sourceCatalogId])).get(sourceCatalogId)
  if (!found) throw new Error(NOT_CACHED_MESSAGE)
  return toUserProblemRow(found)
}

/** Undo an optimistic write: remove `applied` (when the row was newly created) and restore
 *  `prior` (when it existed before). Notifies, because the rollback IS visible. */
async function rollback(
  applied: UserProblemRow | null,
  prior: UserProblemRow | null,
  gen: number,
): Promise<void> {
  const rows: UserProblemRow[] = []
  if (applied && !prior) rows.push({ ...applied, deleted: true })
  if (prior) rows.push(prior)
  await cacheUserProblems(rows, gen)
  notifyUserProblemsChanged()
}

// ─── Auth lifecycle (KTD-I9 / KTD4) ───────────────────────────────────────────

/**
 * Reconcile the cache with the signed-in identity, called from AuthProvider's
 * onAuthStateChange as the fourth identity hook. A same-user launch (restored session) is a
 * no-op, preserving the warm cache; any real change clears the OUTGOING user's own rows —
 * cached rows authored by somebody else are public and survive — then advances the gate.
 *
 * The clear runs FIRST and the gate advances only after it resolves. If the clear rejects
 * (IndexedDB quota / private mode / VersionError) the gate stays un-advanced so the next
 * auth event retries; a gate advanced past a failed clear would let user B browse user A's
 * private problems on a shared device.
 */
export async function syncUserProblemsIdentity(userId: string | null): Promise<void> {
  const next = userId ?? ''
  const prev = await readCachedUserId()
  if (prev === next) return
  await clearOwnUserProblems(prev)
  await setCachedUserId(next)
  notifyUserProblemsChanged()
  // Warm the new identity's cache without blocking auth restore on the network. The id is
  // passed straight through rather than re-read via getSession(), which would be a
  // re-entrant Supabase call from inside the auth callback.
  if (next) void syncUserProblems(next, notifyUserProblemsChanged)
}

// ─── Change notifications ─────────────────────────────────────────────────────

// The catalog reads user problems from IndexedDB, not from a React store, so a mutation
// can't reach a mounted list through useSyncExternalStore. This is that signal — the same
// shape as subscribeListProblemsChanged in lists/listsStore.ts.
const listeners = new Set<() => void>()

/** Subscribe to "the cached user problems changed" (a mutation or an applied pull page). */
export function subscribeUserProblemsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyUserProblemsChanged(): void {
  for (const l of listeners) l()
}
