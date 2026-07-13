// Covers the useMemberSenders HOOK behaviour that the pure buildSenders does not: the
// off-board `undefined` gate and the ready/paused/loading state derivation that drives
// sendersDimmed (paused) and the loading suppression. The stores are mocked so the hook
// is exercised in isolation.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { MemberAscentsState } from '../sessions/memberAscentsStore'
import { useMemberSenders } from './useMemberSenders'

const mockUseSessions = vi.fn()
const mockUseMemberAscents = vi.fn()

vi.mock('../sessions/sessionsStore', () => ({ useSessions: () => mockUseSessions() }))
vi.mock('../sessions/memberAscentsStore', () => ({ useMemberAscents: (id: string | null) => mockUseMemberAscents(id) }))

const board = boardByLayoutId(7)!

function ascents(over: Partial<MemberAscentsState> = {}): MemberAscentsState {
  return { ready: false, bySets: {}, members: [], error: null, stale: false, fetchedAt: null, ...over }
}

function withSession(boardLayoutId: number) {
  mockUseSessions.mockReturnValue({
    activeSession: { id: 's1', boardLayoutId },
    roster: [],
    selfId: 'me',
  })
}

beforeEach(() => {
  mockUseSessions.mockReset()
  mockUseMemberAscents.mockReset()
  mockUseMemberAscents.mockReturnValue(ascents())
})

describe('useMemberSenders (hook)', () => {
  it('returns undefined when no session is active', () => {
    mockUseSessions.mockReturnValue({ activeSession: null, roster: [], selfId: 'me' })
    const { result } = renderHook(() => useMemberSenders(board))
    expect(result.current).toBeUndefined()
  })

  it('returns undefined when the active session targets a different board', () => {
    withSession(99) // not board 7
    const { result } = renderHook(() => useMemberSenders(board))
    expect(result.current).toBeUndefined()
  })

  it('maps ready -> "ready"', () => {
    withSession(7)
    mockUseMemberAscents.mockReturnValue(ascents({ ready: true }))
    expect(renderHook(() => useMemberSenders(board)).result.current!.state).toBe('ready')
  })

  it('maps a max-age drop (stale) -> "paused"', () => {
    withSession(7)
    mockUseMemberAscents.mockReturnValue(ascents({ ready: false, stale: true }))
    expect(renderHook(() => useMemberSenders(board)).result.current!.state).toBe('paused')
  })

  it('maps an errored projection -> "paused"', () => {
    withSession(7)
    mockUseMemberAscents.mockReturnValue(ascents({ ready: false, error: 'boom' }))
    expect(renderHook(() => useMemberSenders(board)).result.current!.state).toBe('paused')
  })

  it('maps a first-load (not ready, not stale/error) -> "loading"', () => {
    withSession(7)
    mockUseMemberAscents.mockReturnValue(ascents())
    expect(renderHook(() => useMemberSenders(board)).result.current!.state).toBe('loading')
  })
})
