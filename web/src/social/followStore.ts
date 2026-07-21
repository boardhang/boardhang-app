// Reactive follow-edge store — the viewer's relationship toward other users. Network-only
// (KTD10: no IndexedDB mirror, no offline queue — social is others' ephemeral read data, not
// your own editable data). Module-level Map<targetId, EdgeState> + a listener Set +
// useSyncExternalStore, mirroring sessionsStore's shape. Mutations are optimistic and roll
// back on a cloud/offline error; the CALLER surfaces the failure toast (KTD10 — "online-only
// actions fail loudly").
//
// Edge status is read from the `follows` table directly (RLS lets a user read edges they are
// party to); every mutation goes through a 0017 SECURITY DEFINER RPC (request_follow,
// unfollow, respond_to_follow, block_user, unblock_user) — there is no client INSERT/UPDATE
// path to the graph.

import { useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'
import { currentUserId } from './currentUser'
import type { EdgeStatus } from './socialTypes'

export interface EdgeState {
  /** The viewer's outgoing edge toward the target. */
  status: EdgeStatus
  /** True once the viewer has blocked the target (optimistically or confirmed). */
  blocked: boolean
}

const UNKNOWN: EdgeState = { status: 'none', blocked: false }

let edges = new Map<string, EdgeState>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

function setEdge(id: string, next: EdgeState): void {
  edges = new Map(edges)
  edges.set(id, next)
  notify()
}

/** Non-reactive read of the viewer's edge toward `id` (defaults to a stable UNKNOWN). */
export function getEdge(id: string): EdgeState {
  return edges.get(id) ?? UNKNOWN
}

/**
 * Prime the edge toward `id` from a list read that already carries it (search_profiles returns
 * edge_status per row), so the RelationshipButton renders the right label with no extra
 * round-trip. Never downgrades a locally-known optimistic state: skips if an edge is already
 * cached (a live follow/unfollow in flight must win over a stale list snapshot).
 */
export function seedEdge(id: string, status: EdgeStatus): void {
  if (edges.has(id)) return
  setEdge(id, { status, blocked: false })
}

/** Load the viewer's current edge toward `targetId` from the graph (RLS-scoped to own edges). */
export async function loadEdge(targetId: string): Promise<void> {
  if (!supabase) return
  const me = await currentUserId()
  if (!me) return
  const { data } = await supabase
    .from('follows')
    .select('status')
    .eq('follower_id', me)
    .eq('followee_id', targetId)
    .maybeSingle()
  const status = (data?.status as EdgeStatus | undefined) ?? 'none'
  setEdge(targetId, { status, blocked: getEdge(targetId).blocked })
}

function statusFromRpc(data: unknown): EdgeStatus | undefined {
  // request_follow returns a single `public.follows` row (an object), but PostgREST may
  // surface it as a one-element array depending on the function shape — handle both.
  const row = Array.isArray(data) ? data[0] : data
  return (row as { status?: EdgeStatus } | null)?.status
}

/**
 * Follow `targetId`. `targetIsPrivate` is the caller's optimistic hint (from the profile card)
 * for whether the edge lands pending vs active — the server is authoritative and reconciles.
 * Rolls back on error and rethrows so the caller can toast (KTD10).
 */
export async function follow(targetId: string, targetIsPrivate: boolean): Promise<void> {
  if (!supabase) throw new Error('Sign in to follow people.')
  const prev = getEdge(targetId)
  setEdge(targetId, { ...prev, status: targetIsPrivate ? 'pending' : 'active' })
  const { data, error } = await supabase.rpc('request_follow', { p_target: targetId })
  if (error) {
    setEdge(targetId, prev)
    throw new Error(error.message)
  }
  setEdge(targetId, {
    ...getEdge(targetId),
    status: statusFromRpc(data) ?? (targetIsPrivate ? 'pending' : 'active'),
  })
}

/** Unfollow (active edge) or cancel a pending request — both are the follower-side delete. */
export async function unfollow(targetId: string): Promise<void> {
  if (!supabase) throw new Error('Sign in to manage who you follow.')
  const prev = getEdge(targetId)
  setEdge(targetId, { ...prev, status: 'none' })
  const { error } = await supabase.rpc('unfollow', { p_target: targetId })
  if (error) {
    setEdge(targetId, prev)
    throw new Error(error.message)
  }
}

/** Approve/decline a pending request FROM `followerId` (the followee acts). */
export async function respondToFollow(followerId: string, accept: boolean): Promise<void> {
  if (!supabase) throw new Error('Sign in to respond to requests.')
  const { error } = await supabase.rpc('respond_to_follow', {
    p_follower: followerId,
    p_accept: accept,
  })
  if (error) throw new Error(error.message)
}

/** Block `targetId`: severs edges both ways + purges cross-pair notifications (server side). */
export async function block(targetId: string): Promise<void> {
  if (!supabase) throw new Error('Sign in to block.')
  const prev = getEdge(targetId)
  setEdge(targetId, { status: 'none', blocked: true })
  const { error } = await supabase.rpc('block_user', { p_target: targetId })
  if (error) {
    setEdge(targetId, prev)
    throw new Error(error.message)
  }
}

/** Unblock `targetId`. */
export async function unblock(targetId: string): Promise<void> {
  if (!supabase) throw new Error('Sign in to unblock.')
  const prev = getEdge(targetId)
  setEdge(targetId, { ...prev, blocked: false })
  const { error } = await supabase.rpc('unblock_user', { p_target: targetId })
  if (error) {
    setEdge(targetId, prev)
    throw new Error(error.message)
  }
}

// ─── Auth lifecycle ───────────────────────────────────────────────────────────

const LAST_USER_KEY = 'followsLastUserId'

/**
 * Drop all cached edges when the signed-in identity changes (sign-out or a different user), so
 * on a shared device user B never sees user A's follow states. In-memory only — social is
 * network-only (KTD10), so there is no IndexedDB to clear. Called from AuthProvider alongside
 * the lists/sessions identity syncs. A restored same-user session is a no-op.
 */
export function syncFollowsIdentity(userId: string | null): void {
  const next = userId ?? ''
  const prev = localStorage.getItem(LAST_USER_KEY)
  if (prev === next) return
  edges = new Map()
  notify()
  localStorage.setItem(LAST_USER_KEY, next)
}

// ─── Reactive bindings ────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reactive view of the viewer's edge toward `targetId` (UNKNOWN when null/not-yet-loaded). */
export function useEdge(targetId: string | null): EdgeState {
  return useSyncExternalStore(
    subscribe,
    () => (targetId ? getEdge(targetId) : UNKNOWN),
  )
}

/** Test/imperative reset of the in-memory edge map. */
export function resetFollowsForTest(): void {
  edges = new Map()
  notify()
}
