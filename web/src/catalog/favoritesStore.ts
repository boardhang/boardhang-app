// Device-local favorite catalog problems, keyed by catalog id. Matches iOS,
// where favorites are local-only (no account sync). Persisted to localStorage;
// exposed reactively so rows and the favorites filter update on toggle.

import { useSyncExternalStore } from 'react'

const KEY = 'catalogFavorites'

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function write(ids: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]))
  } catch {
    // Best-effort.
  }
}

const listeners = new Set<() => void>()
let snapshot = read()

function emit(): void {
  snapshot = read()
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', () => emit())
}

/** Current favorite ids (stable reference between writes). */
export function getFavoriteIds(): Set<string> {
  return snapshot
}

export function isFavorite(id: string): boolean {
  return snapshot.has(id)
}

/** Add or remove a favorite. */
export function toggleFavorite(id: string): void {
  const next = read()
  if (next.has(id)) next.delete(id)
  else next.add(id)
  write(next)
  emit()
}

/**
 * Drop ids that no longer resolve to a problem — a deleted custom problem, or a cached
 * public one evicted from the offline cache. A dangling favorite would otherwise sit in the
 * favorites filter forever, silently shrinking its result count with nothing to show.
 */
export function pruneFavorites(ids: string[]): void {
  const drop = new Set(ids)
  if (drop.size === 0) return
  const next = read()
  let changed = false
  for (const id of drop) {
    if (next.delete(id)) changed = true
  }
  if (!changed) return
  write(next)
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reactive favorites for components. */
export function useFavorites() {
  const favoriteIds = useSyncExternalStore(subscribe, getFavoriteIds)
  return { favoriteIds, toggleFavorite, isFavorite }
}
