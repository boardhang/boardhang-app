// Transient catalog search query, shared between the always-present bottom-nav
// search field and the catalog list. Deliberately NOT persisted and NOT part of
// the per-slab FilterState — it's an ephemeral query, cleared only by the field's
// clear (✕) button, and switching boards doesn't carry a stale value into storage.

import { useSyncExternalStore } from 'react'

let query = ''
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function setSearchQuery(next: string) {
  if (query === next) return
  query = next
  emit()
}

export function clearSearch() {
  setSearchQuery('')
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot() {
  return query
}

export function useSearchQuery(): string {
  return useSyncExternalStore(subscribe, getSnapshot)
}
