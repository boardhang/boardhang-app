// Reactive union of `source_catalog_id`s across the selected saved lists — the membership
// set backing the catalog's saved-list filter (U2). Mirrors useListProblems' subscribe/re-read
// cadence: read from the offline IndexedDB cache, re-read whenever a store mutation nudges the
// problem cache (so an add/remove to a filtered list reflects live), and expose a `ready` flag.
//
// `ready` is the single signal the catalog predicate gates on: while a non-empty selection's
// members are still loading, `ready` is false so the list filter fails OPEN (shows everything)
// instead of blanking the grid to zero. An empty selection is trivially ready with an empty set.

import { useEffect, useState } from 'react'
import { subscribeListProblemsChanged } from './listsStore'
import { readListMemberIds } from './listsSync'

export interface ListMemberIdsState {
  /** Union of `source_catalog_id`s across the selected lists. */
  ids: Set<string>
  /** First read for the current selection has resolved (trivially true when empty). */
  ready: boolean
}

const EMPTY: ListMemberIdsState = { ids: new Set(), ready: true }

export function useListMemberIds(listIds: string[]): ListMemberIdsState {
  // Order-independent stable key so the effect re-runs only when the *set* of ids changes,
  // not on every render's fresh array identity. List ids are UUIDs (never contain commas).
  const key = [...listIds].sort().join(',')
  const [state, setState] = useState<ListMemberIdsState>(EMPTY)

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setState(EMPTY)
      return
    }

    let cancelled = false
    // Monotonic guard: overlapping reads from a burst of change-notifies can resolve out of
    // order; only the latest issued read applies.
    let latest = 0
    setState({ ids: new Set(), ready: false })

    const read = () => {
      const seq = ++latest
      return readListMemberIds(ids)
        .then((set) => {
          if (!cancelled && seq === latest) setState({ ids: set, ready: true })
        })
        .catch(() => {
          // A hard cache-read failure leaves `ready` false so the filter keeps failing OPEN
          // (shows everything) rather than blanking the grid on a transient IndexedDB error.
        })
    }

    void read()
    const unsub = subscribeListProblemsChanged(() => void read())
    return () => {
      cancelled = true
      unsub()
    }
  }, [key])

  return state
}
