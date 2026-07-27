// The one place the REAL hook is exercised. Every consumer test mocks useSessionFilterRows and
// hand-builds a SessionFilterUI, which is fast but blind: it cannot catch the hook being wired to
// the wrong store function, or its board guard regressing. In particular `onClearAll` is a single
// line of wiring that three separate UI paths depend on (the popover's Clear, the header chip's
// removal, and the sheet's "Clear filters"), and a fixture can never prove it reaches the store.
//
// No Supabase mock: an active session is seeded through localStorage and picked up by
// initSessions(), which retires/activates from the cached pointer without a network call. The
// client is unconfigured under test, so the background refresh is a no-op.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import {
  clearSessionsCache,
  getSessionsSnapshot,
  initSessions,
  setMemberStatus,
} from '../sessions/sessionsStore'
import { sessionStatusFacet, useSessionFilterRows } from './useSessionFilterRows'

const board = boardByLayoutId(7)!
const SESSION_ID = 'S-live'

function seedActiveSession(boardLayoutId = 7): void {
  localStorage.setItem(
    'sessionsActive',
    JSON.stringify({
      id: SESSION_ID,
      ownerId: 'user-A',
      name: 'Crew',
      boardLayoutId,
      // Comfortably in the future so the offline expiry check keeps it active.
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false,
    }),
  )
  initSessions()
}

beforeEach(() => {
  localStorage.clear()
  clearSessionsCache()
  localStorage.clear() // clearSessionsCache re-touches keys
})

describe('useSessionFilterRows — real store wiring', () => {
  it('returns undefined when no session targets this board', () => {
    const { result } = renderHook(() => useSessionFilterRows(board))
    expect(result.current).toBeUndefined()
  })

  it('returns undefined for a session that targets a DIFFERENT board', () => {
    // The guard that keeps one board's session from filtering another board's catalog.
    seedActiveSession(17)
    const { result } = renderHook(() => useSessionFilterRows(board))
    expect(result.current).toBeUndefined()
  })

  it('onClearAll actually reaches the store and empties every member row', () => {
    // The regression this file exists for: a fixture's onClearAll is a vi.fn() and proves nothing.
    seedActiveSession()
    setMemberStatus('user-A', ['sent'])
    setMemberStatus('user-B', ['unlogged', 'attempted'])
    expect(getSessionsSnapshot().memberStatus).not.toEqual({})

    const { result } = renderHook(() => useSessionFilterRows(board))
    result.current!.onClearAll()

    expect(getSessionsSnapshot().memberStatus).toEqual({})
    // Persisted too — a reload must not resurrect the cleared selections.
    expect(localStorage.getItem(`sessionMemberStatus:${SESSION_ID}`)).toBe('{}')
  })

  it('renders no member rows until the roster or projection has loaded', () => {
    // Rows are keyed off the projection's member set, falling back to the roster — both of which
    // need the network. Offline/cold, the hook yields a session with zero rows rather than
    // inventing rows from the persisted memberStatus map, so the sheet cannot offer a chip row
    // for a member it cannot name.
    seedActiveSession()
    setMemberStatus('user-A', ['sent'])
    const { result } = renderHook(() => useSessionFilterRows(board))
    expect(result.current).toBeDefined()
    expect(result.current!.rows).toEqual([])
  })
})

describe('sessionStatusFacet — against real hook output', () => {
  it('reports not-applied while the projection is unready', () => {
    // No projection has been fetched (no Supabase under test), which is exactly the shape
    // applyFilters treats as "skip the per-member clause and widen the list".
    seedActiveSession()
    const { result } = renderHook(() => useSessionFilterRows(board))
    expect(result.current!.state).not.toBe('ready')
    expect(sessionStatusFacet(result.current).applied).toBe(false)
  })

  it('reports nothing selected and nothing applied with no session at all', () => {
    expect(sessionStatusFacet(undefined)).toEqual({ members: 0, applied: false })
  })
})
