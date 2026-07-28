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
import { clearAllProblemDrafts } from './problemDraftStore'
import { pruneRecents } from './recentsStore'
import {
  cacheUserProblems,
  clearOwnUserProblems,
  clearPrivateUserProblems,
  currentCacheGeneration,
  errorMessage,
  evictCachedUserProblems,
  getUserProblemsByIds,
  hasUserProblemsCursor,
  readCachedUserId,
  setCachedUserId,
  syncPublicUserProblemsForSlab,
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

/**
 * The server-side publish rules (migration 0019) are plpgsql `raise exception`s and CHECK
 * constraints, and they reach the client as raw postgres text — a constraint name is not
 * something to show an author. Each entry maps a stable fragment of the server's wording to
 * copy that says what to do about it.
 *
 * Fragments, not whole sentences: the exact server strings live in the migration and may be
 * reworded, and matching a fragment keeps that from silently degrading into a leaked
 * constraint name. Anything unmatched falls through to the raw message — a wrong-but-honest
 * error beats a friendly one that hides which rule fired.
 */
const PUBLISH_REJECTIONS: Array<[RegExp, string]> = [
  [
    /profile handle/i,
    'Pick a profile handle before publishing — a public problem is credited to its setter.',
  ],
  [
    /public problem (limit|cap)/i,
    "You've published as many public problems as the limit allows. Make one private or delete one before publishing another.",
  ],
  [
    /user_problems_public_complete|holds_valid/i,
    'A public problem needs a name of 60 characters or fewer and between 1 and 60 holds.',
  ],
]

function writeError(err: unknown, offlineMessage: string): Error {
  if (isOfflineError(err)) return new Error(offlineMessage)
  const message = errorMessage(err)
  for (const [pattern, readable] of PUBLISH_REJECTIONS) {
    if (pattern.test(message)) return new Error(readable)
  }
  return err instanceof Error ? err : new Error(message)
}

// ─── Loads ────────────────────────────────────────────────────────────────────

/**
 * Cached-first load: a cold cache does a single blocking pull; a warm one paints from cache
 * and pulls the delta BEHIND that paint. The background half is what keeps a second device
 * current — own rows have no snapshot lane, so without it a problem authored or edited
 * elsewhere would not arrive until the cursor was thrown away by a sign-out.
 *
 * Signed out (or unconfigured) there is nothing owner-scoped to fetch, which is "nothing to
 * pull", not a failure — the same degradation syncPublicUserProblemsForSlab makes, so a
 * signed-out visitor doesn't render as offline.
 */
export async function loadUserProblems(): Promise<{ synced: boolean }> {
  const userId = await currentUserId()
  if (!userId) return { synced: true }
  if (!hasUserProblemsCursor()) return refreshUserProblems()
  // Fire-and-forget: the cached rows are already on screen and each applied page repaints
  // through the change notification, so nothing is waiting on this.
  void syncUserProblems(userId, notifyUserProblemsChanged)
  return { synced: true }
}

/** Explicit pull (pull-to-refresh, post-sign-in). Notifies per applied page so a mounted
 *  catalog list fills in progressively. */
export async function refreshUserProblems(): Promise<{ synced: boolean }> {
  const userId = await currentUserId()
  if (!userId) return { synced: true }
  const { synced } = await syncUserProblems(userId, notifyUserProblemsChanged)
  return { synced }
}

/**
 * Pull one slab's public problems and reconcile the cache against that snapshot (KTD5).
 * Runs on catalog screen open and pull-to-refresh, signed in or not — public rows are
 * anon-readable, and a signed-out visitor browses the same catalog a signed-in one does.
 *
 * This is the store's half of the split: it resolves who "own" is and supplies the eviction
 * that prunes recents/favorites and repaints the list, while userProblemsSync owns the pull
 * and the reconcile.
 */
export async function syncPublicUserProblems(
  layoutId: number,
  angle: number,
): Promise<{ synced: boolean }> {
  const { synced } = await syncPublicUserProblemsForSlab(layoutId, angle, await ownUserId(), {
    evict: evictUserProblems,
    onApplied: notifyUserProblemsChanged,
  })
  return { synced }
}

/**
 * Whose rows the snapshot must not touch. The live session is authoritative, but a cache
 * whose identity clear failed (IndexedDB quota, private mode) can still hold the previous
 * user's rows while the session reads null — so the cached identity is the fallback fence.
 * Getting this wrong deletes somebody's own problems, and there is no server copy of a
 * private row we could re-pull.
 */
async function ownUserId(): Promise<string | null> {
  const session = await currentUserId()
  if (session) return session
  return (await readCachedUserId()) || null
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
    // Attribution is the server's to stamp (KTD7). Optimistically claiming a handle here
    // would show the author a credit the server might refuse to grant.
    setter_user_id: null,
    setter_handle: null,
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

/** Publish or unpublish a problem. Publishing is where the server's rules bite — the handle
 *  gate, the public cap, the completeness CHECK — so its failures come back as the readable
 *  messages {@link PUBLISH_REJECTIONS} maps. Retracting propagates to other devices by
 *  absence from their next slab snapshot (R12/AE2), never as a message we send. */
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
export async function evictUserProblems(sourceCatalogIds: string[], gen?: number): Promise<void> {
  if (sourceCatalogIds.length === 0) return
  // Guarded as a whole, not just the cache write: an eviction decided under the previous
  // identity must not prune the new one's recents and favorites either.
  if (gen !== undefined && gen !== currentCacheGeneration()) return
  await evictCachedUserProblems(sourceCatalogIds, gen)
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
 * no-op, preserving the warm cache; any real change clears the OUTGOING user's own rows and
 * their parked draft — cached rows authored by somebody else are public and survive — then
 * advances the gate. A sign-out additionally sweeps private rows by visibility, which is the
 * one thing that stays true when the gate can't be trusted.
 *
 * The clear runs FIRST and the gate advances only after it resolves. If the clear rejects
 * (IndexedDB quota / private mode / VersionError) the gate stays un-advanced so the next
 * auth event retries; a gate advanced past a failed clear would let user B browse user A's
 * private problems on a shared device.
 */
export async function syncUserProblemsIdentity(userId: string | null): Promise<void> {
  const next = userId ?? ''
  const prev = await readCachedUserId()
  // Unconditional on a sign-out, including the no-op below: with nobody signed in, no
  // private row belongs in this cache whatever the gate says. That covers the multi-tab race
  // clearOwnUserProblems can't — see clearPrivateUserProblems.
  const swept = next ? false : await clearPrivateUserProblems()
  if (prev === next) {
    // Nothing else notifies on this path, and the sweep may just have emptied an open list.
    if (swept) notifyUserProblemsChanged()
    return
  }
  // A draft is keyed by slab alone, so it outlives the author unless somebody drops it. Only
  // on a real departure: the '' → user transition is a signed-out author coming back from
  // the sign-in redirect, whose draft is the entire point of persisting it (AE1).
  if (prev) clearAllProblemDrafts()
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
