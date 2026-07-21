// Notifications store (U6). Two feeds in one surface:
//   • Requests — pending follow requests, sourced from the graph (get_follow_requests), NOT
//     duplicated into notifications (KTD7/R24). Approve/decline mutates the edge.
//   • Activity — fire-and-forget rows (get_notifications: new follower / request accepted),
//     block-aware (KTD5), marked read on view.
// The nav badge counts pending requests + unread activity (design review #11): a request has
// no read_at and is the most actionable item, so it must count even with zero unread activity.
//
// Network-only (KTD10), module store + useSyncExternalStore, cleared on identity change.

import { useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'
import { respondToFollow } from './followStore'
import {
  followRequestFromRow,
  notificationFromRow,
  type FollowRequest,
  type FollowRequestRow,
  type NotificationItem,
  type NotificationRow,
} from './socialTypes'

export interface NotificationsState {
  status: 'idle' | 'loading' | 'loaded' | 'error'
  requests: FollowRequest[]
  activity: NotificationItem[]
}

const EMPTY: NotificationsState = { status: 'idle', requests: [], activity: [] }

let state: NotificationsState = EMPTY
const listeners = new Set<() => void>()

function setState(next: Partial<NotificationsState>): void {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

/** Badge count = pending requests + unread activity (a request has no read_at — count it). */
export function badgeCount(s: NotificationsState = state): number {
  return s.requests.length + s.activity.filter((a) => a.readAt === null).length
}

/** Load both feeds. */
export async function loadNotifications(): Promise<void> {
  if (!supabase) {
    setState({ status: 'loaded', requests: [], activity: [] })
    return
  }
  setState({ status: state.status === 'loaded' ? 'loaded' : 'loading' })
  const [reqs, acts] = await Promise.all([
    supabase.rpc('get_follow_requests', {}),
    supabase.rpc('get_notifications', {}),
  ])
  if (reqs.error || acts.error) {
    setState({ status: 'error' })
    return
  }
  setState({
    status: 'loaded',
    requests: ((reqs.data ?? []) as FollowRequestRow[]).map(followRequestFromRow),
    activity: ((acts.data ?? []) as NotificationRow[]).map(notificationFromRow),
  })
}

/** Approve or decline a pending request; drop it from the list optimistically. */
export async function resolveRequest(followerId: string, accept: boolean): Promise<void> {
  const prev = state.requests
  setState({ requests: prev.filter((r) => r.id !== followerId) })
  try {
    await respondToFollow(followerId, accept)
  } catch (e) {
    setState({ requests: prev }) // roll back so the request reappears
    throw e instanceof Error ? e : new Error(String(e))
  }
}

/** Mark all unread activity rows read (on view). Optimistic; best-effort server write. */
export async function markActivityRead(): Promise<void> {
  const unread = state.activity.filter((a) => a.readAt === null)
  if (unread.length === 0) return
  const now = new Date().toISOString()
  setState({ activity: state.activity.map((a) => (a.readAt ? a : { ...a, readAt: now })) })
  if (!supabase) return
  await supabase.rpc('mark_notifications_read', { p_ids: unread.map((a) => a.id) })
}

/** Clear the in-memory notifications (network-only store; nothing persisted). */
export function resetNotifications(): void {
  state = EMPTY
  for (const l of listeners) l()
}

const LAST_USER_KEY = 'notificationsLastUserId'

/**
 * Reconcile notifications with the signed-in identity — the same `syncXIdentity(userId)` contract
 * the follows and feed stores use, called unconditionally from AuthProvider. Resets only when the
 * id actually changes, so a token refresh / same-user restore does not wipe a loaded inbox. This
 * closes the shared-device gap where the header badge (badgeCount) could briefly show user A's
 * count to user B on a direct A→B switch with no intervening null session.
 */
export function syncNotificationsIdentity(userId: string | null): void {
  const next = userId ?? ''
  if (localStorage.getItem(LAST_USER_KEY) === next) return
  resetNotifications()
  try {
    localStorage.setItem(LAST_USER_KEY, next)
  } catch {
    // ignore
  }
}

// ─── Reactive bindings ────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Snapshot for useSyncExternalStore and for tests/imperative callers (one function, not two). */
export function getNotificationsSnapshot(): NotificationsState {
  return state
}

export function useNotifications(): NotificationsState {
  return useSyncExternalStore(subscribe, getNotificationsSnapshot)
}
