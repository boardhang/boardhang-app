import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activateBoard, getActiveBoardId } from '../board/boardStore'
import { navigateToSessionBoard } from './sessionNav'
import type { Session } from './sessionsTypes'

// Seed a starting active board that is NOT the session's board, so we can assert the helper
// actually flips it. Cleared per-test to avoid cross-test bleed (mirrors boardStore.test.ts).
beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage'))
  activateBoard(3) // MoonBoard Masters 2024 (any known board that isn't the session's)
})

const sessionOn = (layoutId: number): Session => ({
  id: 'S1',
  name: 'Crew',
  ownerId: 'me',
  boardLayoutId: layoutId,
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
  expiresAt: '2026-07-21T00:00:00Z',
  deleted: false,
  litProblemId: null,
  litBy: null,
  litAt: null,
})

describe('navigateToSessionBoard', () => {
  it('activates the session board and navigates to its catalog', () => {
    const navigate = vi.fn()
    navigateToSessionBoard(navigate as never, sessionOn(7))
    expect(getActiveBoardId()).toBe(7)
    expect(navigate).toHaveBeenCalledTimes(1)
    const [target] = navigate.mock.calls[0]
    expect(target).toMatchObject({ to: '/board/$layoutId/catalog', params: { layoutId: '7' } })
  })

  it('falls back to /boards when the board layout id is unknown, and does not touch active board', () => {
    const navigate = vi.fn()
    navigateToSessionBoard(navigate as never, sessionOn(999))
    expect(getActiveBoardId()).toBe(3) // unchanged
    expect(navigate).toHaveBeenCalledWith({ to: '/boards' })
  })
})
