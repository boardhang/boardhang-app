// On-demand beta-videos store, one entry per problem. Fetches a problem's APPROVED beta
// clips (RLS enforces approved+not-deleted; we also filter explicitly) ordered best-viewed
// first, and caches them in a per-session in-memory map so re-opening a problem is instant.
// Modeled on sessions/memberAscentsStore but simpler: public data, no max-age/revocation —
// there is nothing user-scoped to bound. No IndexedDB/offline persistence in v1.

import { useEffect } from 'react'
import { useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'
import type { BetaVideo } from './betaTypes'

export type BetaStatus = 'loading' | 'ready' | 'error'

export interface BetaEntry {
  status: BetaStatus
  videos: BetaVideo[]
  error: string | null
}

const COLS = 'id,source_catalog_id,provider,video_id,title,channel,duration_s,is_short,views'
const LOADING: BetaEntry = { status: 'loading', videos: [], error: null }

const cache = new Map<string, BetaEntry>()
const listeners = new Set<() => void>()
const inflight = new Set<string>()

// The identity the cache was populated under (''=signed out). ownership (isMine) is per-viewer,
// so a change here must invalidate the cache — see syncBetaIdentity.
let lastIdentity = ''

function notify(): void {
  for (const l of listeners) l()
}

function set(id: string, entry: BetaEntry): void {
  cache.set(id, entry)
  notify()
}

/**
 * Mark the caller's own approved clips and float them to the front (per-viewer, R2/R3). Runs one
 * small owner-scoped query for just THIS user's approved row ids on this problem — `added_by` is
 * never added to the public read (COLS), so anon viewers get nothing extra (KTD1). Fully guarded:
 * any failure (no session, query error, thrown) degrades to the plain views-desc strip — the
 * badge/pin is an enhancement, never a reason to fail the section (R4).
 */
async function withOwnership(id: string, videos: BetaVideo[]): Promise<BetaVideo[]> {
  if (!supabase || videos.length === 0) return videos
  try {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id
    if (!userId) return videos
    const { data: ownRows, error } = await supabase
      .from('problem_beta_videos')
      .select('id')
      .eq('source_catalog_id', id)
      .eq('added_by', userId)
      .eq('status', 'approved')
      .eq('deleted', false)
    if (error || !ownRows) return videos
    const ownIds = new Set((ownRows as { id: string }[]).map((r) => r.id))
    if (ownIds.size === 0) return videos
    const marked = videos.map((v) => (ownIds.has(v.id) ? { ...v, isMine: true } : v))
    // Partition (not .sort()) so each group keeps the DB's views-desc order exactly and the result
    // is deterministic regardless of engine sort stability (KTD3).
    return [...marked.filter((v) => v.isMine), ...marked.filter((v) => !v.isMine)]
  } catch {
    return videos
  }
}

async function fetchBeta(id: string): Promise<void> {
  if (inflight.has(id)) return
  inflight.add(id)
  if (!cache.has(id)) set(id, LOADING)
  try {
    if (!supabase) {
      // Unconfigured build: no backend, so no betas — a clean empty state, not an error.
      set(id, { status: 'ready', videos: [], error: null })
      return
    }
    const { data, error } = await supabase
      .from('problem_beta_videos')
      .select(COLS)
      .eq('source_catalog_id', id)
      .eq('status', 'approved')
      .eq('deleted', false)
      .order('views', { ascending: false })
    if (error) {
      set(id, { status: 'error', videos: [], error: error.message })
      return
    }
    const rows = ((data ?? []) as Omit<BetaVideo, 'isMine'>[]).map((v) => ({ ...v, isMine: false }))
    const videos = await withOwnership(id, rows)
    set(id, { status: 'ready', videos, error: null })
  } catch (e) {
    set(id, { status: 'error', videos: [], error: e instanceof Error ? e.message : 'load failed' })
  } finally {
    inflight.delete(id)
  }
}

/** Drop the cached entry and re-fetch (the error-state "Try again" action). */
export function refetchBeta(id: string): void {
  cache.delete(id)
  void fetchBeta(id)
}

/**
 * Submit a user beta for a problem. Inserts a PENDING user row carrying only the video_id —
 * the 0011 RLS clamp forces source='user', status='pending', added_by=auth.uid() and empty
 * metadata (the server enrich pass fills title/channel/views later). The row is invisible until
 * an owner approves it, so we deliberately do NOT touch the per-problem cache: the UI shows a
 * "pending review" affordance, never a card. Mirrors listsStore.addProblem's userId + 23505 shape.
 */
export async function submitBeta(sourceCatalogId: string, videoId: string): Promise<void> {
  if (!supabase) throw new Error("Sign-in isn't set up in this build.")
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('You need to be signed in to add a beta video.')
  const { error } = await supabase.from('problem_beta_videos').insert({
    source_catalog_id: sourceCatalogId,
    provider: 'youtube',
    video_id: videoId,
    source: 'user',
    status: 'pending',
    added_by: userId,
  })
  if (error) {
    // Partial dedupe index (0010) → this clip is already live (approved OR someone's pending) for
    // this problem. Don't assert a *visible* row — a pending dup is invisible to the submitter.
    if ((error as { code?: string }).code === '23505') {
      throw new Error("This video can't be added again for this problem.")
    }
    throw new Error(error.message)
  }
}

/**
 * Reconcile the per-session beta cache with the signed-in identity (called from AuthProvider's
 * onAuthStateChange). `isMine` is per-viewer, so a change here — sign-in, sign-out, or a user
 * switch — must drop the cache so the next open re-resolves ownership (R5). A same-identity restore
 * is a no-op, keeping the warm cache. Beta data is public (approved-only), so this is correctness
 * on auth change, not the cross-account cache SAFETY syncListsIdentity provides. In-memory only.
 */
export function syncBetaIdentity(userId: string | null): void {
  const next = userId ?? ''
  if (next === lastIdentity) return
  lastIdentity = next
  cache.clear()
  inflight.clear()
  notify()
}

/** Test hook: clear the module-level singleton between cases. */
export function _resetBetaCache(): void {
  cache.clear()
  inflight.clear()
  lastIdentity = ''
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function snapshotFor(id: string): BetaEntry {
  return cache.get(id) ?? LOADING
}

/** Reactive per-problem beta entry; fetches lazily on first use of an id. */
export function useBetaVideos(sourceCatalogId: string): BetaEntry {
  useEffect(() => {
    if (!cache.has(sourceCatalogId)) void fetchBeta(sourceCatalogId)
  }, [sourceCatalogId])
  return useSyncExternalStore(subscribe, () => snapshotFor(sourceCatalogId))
}
