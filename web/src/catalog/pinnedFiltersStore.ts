// Which filter facets the user has pinned to the catalog header, per board layout.
//
// Pinning is a UI preference, not a filter value, so it lives here (device-local
// localStorage) rather than in the URL — pinned-set should not ride in shareable links.
// Keyed per layoutId (NOT per angle): angle never changes which facets exist, but different
// boards may warrant different pins. A layout with no stored entry falls back to
// DEFAULT_PINNED so existing users keep today's Benchmarks/Favorites/Lists until they
// customize.

import { useSyncExternalStore } from 'react'
import type { PinnableFacetId } from './pinnableFacets'

const key = (layoutId: number) => `catalogPinnedFilters_${layoutId}`

/** The out-of-the-box pinned set — mirrors the previously-hardcoded header controls. */
export const DEFAULT_PINNED: readonly PinnableFacetId[] = ['benchmarks', 'favorites', 'lists']

// Stable reference for getServerSnapshot (a fresh array per call would risk hydration churn if
// SSR is ever added). Inert today — this is a client-only PWA — but cheap correctness.
const SERVER_SNAPSHOT: PinnableFacetId[] = [...DEFAULT_PINNED]

const VALID: ReadonlySet<string> = new Set<PinnableFacetId>([
  'sort',
  'grade',
  'holds',
  'benchmarks',
  'favorites',
  'stars',
  'status',
  'methods',
  'lists',
])

function read(layoutId: number): PinnableFacetId[] {
  try {
    const raw = localStorage.getItem(key(layoutId))
    if (raw === null) return [...DEFAULT_PINNED]
    const parsed = JSON.parse(raw)
    // A stored (possibly empty) array is authoritative — an explicit unpin-all must NOT
    // resurrect the defaults. Drop unknown ids so a renamed/removed facet can't linger.
    if (!Array.isArray(parsed)) return [...DEFAULT_PINNED]
    return parsed.filter((v): v is PinnableFacetId => typeof v === 'string' && VALID.has(v))
  } catch {
    return [...DEFAULT_PINNED]
  }
}

function write(layoutId: number, ids: PinnableFacetId[]): void {
  try {
    localStorage.setItem(key(layoutId), JSON.stringify(ids))
  } catch {
    // Best-effort — pins simply won't survive a reload.
  }
}

const listeners = new Set<() => void>()
// Snapshot cache keyed by layoutId. useSyncExternalStore requires a stable reference between
// emits (else it loops), so we memoize the parsed array and only replace it on a real write.
const snapshots = new Map<number, PinnableFacetId[]>()

function snapshot(layoutId: number): PinnableFacetId[] {
  let s = snapshots.get(layoutId)
  if (!s) {
    s = read(layoutId)
    snapshots.set(layoutId, s)
  }
  return s
}

function emit(layoutId: number): void {
  snapshots.set(layoutId, read(layoutId))
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  // Cross-tab: only OUR keys (or a full clear, key === null) should invalidate the cache — the
  // app writes many other localStorage keys, and reacting to all of them would re-render every
  // filter surface on unrelated writes.
  window.addEventListener('storage', (e) => {
    if (e.key !== null && !e.key.startsWith('catalogPinnedFilters_')) return
    snapshots.clear()
    for (const l of listeners) l()
  })
}

/** Pin or unpin a facet for this layout. */
export function togglePinned(layoutId: number, id: PinnableFacetId): void {
  const current = read(layoutId)
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  write(layoutId, next)
  emit(layoutId)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reactive pinned-set for a layout (stable reference between writes). */
export function usePinnedFacets(layoutId: number): PinnableFacetId[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot(layoutId),
    () => SERVER_SNAPSHOT,
  )
}
