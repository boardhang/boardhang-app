// Transient catalog search state (open + query), shared between the bottom-nav
// search field and the catalog list. Deliberately NOT persisted and NOT part of
// the per-slab FilterState: iOS's .searchable is ephemeral — Cancel clears it and
// switching boards doesn't carry a stale query.

import { useSyncExternalStore } from 'react'

type SearchState = { open: boolean; query: string }

let state: SearchState = { open: false, query: '' }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/** Open the search field (empty query). Idempotent. */
export function openSearch() {
  if (state.open && state.query === '') return
  state = { open: true, query: '' }
  emit()
}

/** Collapse the field and clear the query (iOS Cancel semantics). */
export function closeSearch() {
  if (!state.open && state.query === '') return
  state = { open: false, query: '' }
  emit()
}

export function setSearchQuery(query: string) {
  if (state.query === query) return
  state = { open: true, query }
  emit()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot() {
  return state
}

export function useSearch(): SearchState {
  return useSyncExternalStore(subscribe, getSnapshot)
}
