// Per-slab "recently viewed" history: catalog problem ids in most-recent-first
// order, deduped and capped, persisted to localStorage. Mirrors iOS's per
// board+angle recents (move-to-front on view). Exposed reactively (useRecents)
// so the list refreshes when a view is recorded (from the detail pager, U11).

import { useSyncExternalStore } from 'react'

const RECENT_CAP = 5
const KEY_PREFIX = 'catalogRecents_'
const key = (layoutId: number, angle: number) => `${KEY_PREFIX}${layoutId}_${angle}`

function read(k: string): string[] {
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeIds(k: string, ids: string[]): void {
  try {
    localStorage.setItem(k, JSON.stringify(ids))
  } catch {
    // Best-effort.
  }
}

// Reactive layer: cache the last-read array per slab key so useSyncExternalStore
// gets a stable reference between writes (rebuilt on emit).
const listeners = new Set<() => void>()
const cache = new Map<string, string[]>()

function emit(): void {
  cache.clear()
  for (const l of listeners) l()
}

function snapshotFor(k: string): string[] {
  let cached = cache.get(k)
  if (!cached) {
    cached = read(k)
    cache.set(k, cached)
  }
  return cached
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', () => emit())
}

/** Recently-viewed catalog ids for a slab, most-recent first (capped). */
export function getRecentIds(layoutId: number, angle: number): string[] {
  return snapshotFor(key(layoutId, angle))
}

/** Record a viewed problem: move it to the front, dedupe, cap the list. */
export function recordRecent(layoutId: number, angle: number, id: string): void {
  const k = key(layoutId, angle)
  const next = [id, ...read(k).filter((existing) => existing !== id)].slice(0, RECENT_CAP)
  writeIds(k, next)
  emit()
}

/** Clear a slab's recently-viewed history. */
export function clearRecents(layoutId: number, angle: number): void {
  writeIds(key(layoutId, angle), [])
  emit()
}

/**
 * Drop ids that no longer resolve to a problem — a deleted custom problem, or a cached
 * public one evicted from the offline cache. Sweeps EVERY slab's history, because the
 * caller generally knows only the id (a legacy row carries no board at all).
 *
 * Not cosmetic: a dangling id still occupies one of the five capped slots and resolves to
 * nothing, so enough of them empty the Recents sheet — and the FAB that opens it — while
 * the history looks non-empty to the store.
 */
export function pruneRecents(ids: string[]): void {
  const drop = new Set(ids)
  if (drop.size === 0) return
  let changed = false
  for (const k of recentKeys()) {
    const current = read(k)
    const next = current.filter((id) => !drop.has(id))
    if (next.length === current.length) continue
    writeIds(k, next)
    changed = true
  }
  if (changed) emit()
}

/** Every per-slab recents key currently in localStorage. */
function recentKeys(): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(KEY_PREFIX)) keys.push(k)
    }
  } catch {
    // Best-effort (private mode / disabled storage).
  }
  return keys
}

/** Reactive recently-viewed ids for a slab. */
export function useRecents(layoutId: number, angle: number): string[] {
  const k = key(layoutId, angle)
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snapshotFor(k),
  )
}
