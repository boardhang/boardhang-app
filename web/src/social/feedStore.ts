// The follow feed store (U5). Pull-based, keyset-paginated over get_follow_feed
// (first_sent_at desc, id desc). Network-only for fresh data, but with a single read-through
// cache of the last successful first page (KTD10) so re-opening — especially offline — paints
// instantly instead of showing a blank screen. The cache is user-keyed so a shared device never
// paints user A's feed for user B.
//
// Statuses:
//   • loading — first load, no cache painted yet
//   • loaded  — fresh page(s) from the server
//   • stale   — painting the cache while offline / a refresh failed (marked "last updated X")
//   • offline — offline with no cache to fall back on
//   • error   — an online fetch failed with nothing cached

import { useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'
import { currentUserId } from './currentUser'
import { sendFromRow, type SendItem, type SendRow } from './socialTypes'

export type FeedStatus = 'idle' | 'loading' | 'loaded' | 'stale' | 'offline' | 'error'

export interface FeedState {
  status: FeedStatus
  sends: SendItem[]
  /** No more pages after the loaded set. */
  done: boolean
  /** A "load more" page fetch is in flight — guards against a double-tap appending twice. */
  loadingMore: boolean
  /** When the currently-painted data was fetched (ms) — drives the "last updated" marker. */
  fetchedAt: number | null
}

const PAGE = 30
const CACHE_KEY = 'feedCacheV1'

const EMPTY: FeedState = { status: 'idle', sends: [], done: false, loadingMore: false, fetchedAt: null }

let state: FeedState = EMPTY
const listeners = new Set<() => void>()
let loadToken = 0

function setState(next: Partial<FeedState>): void {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

interface CacheShape {
  userId: string
  sends: SendItem[]
  fetchedAt: number
}

function readCache(userId: string): CacheShape | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as CacheShape
    // User-keyed: ignore another account's cached feed (shared-device safety).
    return c.userId === userId ? c : null
  } catch {
    return null
  }
}

function writeCache(userId: string, sends: SendItem[], fetchedAt: number): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId, sends: sends.slice(0, PAGE), fetchedAt }))
  } catch {
    // Best-effort; a full/again-private-mode storage just means no offline paint.
  }
}

/**
 * Remove an actor's sends from the live feed AND drop the persisted cache — called when the
 * viewer blocks someone, so blocking is an immediate hard cut (R12) rather than leaving the
 * blocked user's sends in the in-memory feed or repainting them from the offline cache on the
 * next open. The cache is rewritten by the next successful online fetch.
 */
export function purgeActorFromFeed(actorId: string): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // ignore
  }
  if (state.sends.some((s) => s.actorId === actorId)) {
    setState({ sends: state.sends.filter((s) => s.actorId !== actorId) })
  }
}

/** Clear the cached feed + in-memory state. */
export function clearFeedCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // ignore
  }
  state = EMPTY
  for (const l of listeners) l()
}

const LAST_USER_KEY = 'feedLastUserId'

/**
 * Reconcile the feed with the signed-in identity — the same `syncXIdentity(userId)` contract the
 * follows and notifications stores use, called unconditionally from AuthProvider on every auth
 * event. Clears the cache + in-memory feed only when the id actually changes (sign-out or a
 * different user), so a token refresh or same-user restore is a no-op (the last-fetch cache
 * survives). The cache is already user-keyed on read, so this is defence-in-depth for the
 * in-memory state a shared device would otherwise briefly show.
 */
export function syncFeedIdentity(userId: string | null): void {
  const next = userId ?? ''
  if (localStorage.getItem(LAST_USER_KEY) === next) return
  clearFeedCache()
  try {
    localStorage.setItem(LAST_USER_KEY, next)
  } catch {
    // ignore
  }
}

async function fetchPage(cursor: SendItem | null): Promise<SendItem[] | null> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('get_follow_feed', {
    p_limit: PAGE,
    p_before_first_sent: cursor?.firstSentAt ?? null,
    p_before_id: cursor?.ascentId ?? null,
  })
  if (error) return null
  return ((data ?? []) as SendRow[]).map(sendFromRow)
}

/**
 * Load the feed: paint the user-keyed cache immediately (if any), then fetch the fresh first
 * page. A failed fetch keeps the cache marked `stale`; a failure with no cache lands in
 * `offline` (or `error`). The empty-graph case (you follow no one) is a `loaded` empty set —
 * the screen routes that to discovery.
 */
export async function loadFeed(): Promise<void> {
  const token = ++loadToken
  const userId = await currentUserId()
  if (!supabase || !userId) {
    setState({ status: 'loaded', sends: [], done: true, fetchedAt: null })
    return
  }
  const cached = readCache(userId)
  if (cached) {
    setState({ status: 'stale', sends: cached.sends, done: cached.sends.length < PAGE, loadingMore: false, fetchedAt: cached.fetchedAt })
  } else {
    setState({ status: 'loading', sends: [], done: false, loadingMore: false, fetchedAt: null })
  }

  const rows = await fetchPage(null)
  if (token !== loadToken) return // a newer load supersedes this one
  if (rows === null) {
    // Fetch failed. Keep the cache (stale) if we have it, else offline/error.
    if (cached) setState({ status: 'stale' })
    else setState({ status: navigatorOffline() ? 'offline' : 'error', sends: [], done: true })
    return
  }
  const now = Date.now()
  writeCache(userId, rows, now)
  setState({ status: 'loaded', sends: rows, done: rows.length < PAGE, fetchedAt: now })
}

/** Load the next keyset page. No-op while offline/empty OR while a page is already in flight
 *  (a double-tap would otherwise read the same cursor twice and append the page twice). */
export async function loadMoreFeed(): Promise<void> {
  if (state.done || state.loadingMore || state.sends.length === 0) return
  const token = loadToken
  const cursor = state.sends[state.sends.length - 1]
  setState({ loadingMore: true })
  const rows = await fetchPage(cursor)
  if (token !== loadToken) return // superseded by a fresh loadFeed (which cleared loadingMore)
  if (rows === null) {
    setState({ loadingMore: false })
    return
  }
  setState({ sends: [...state.sends, ...rows], done: rows.length < PAGE, status: 'loaded', loadingMore: false })
}

function navigatorOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// ─── Reactive bindings ────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): FeedState {
  return state
}

export function getFeedSnapshot(): FeedState {
  return state
}

export function useFeed(): FeedState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Test reset. */
export function resetFeedForTest(): void {
  state = EMPTY
  loadToken++
}
