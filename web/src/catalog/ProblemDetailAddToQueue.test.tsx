import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ProblemDetailAddToQueue } from './ProblemDetailAddToQueue'
import { useSessions } from '../sessions/sessionsStore'
import { addProblem, removeItem, useSessionQueue } from '../sessions/queueStore'
import type { QueueItem } from '../sessions/queueTypes'
import type { Session } from '../sessions/sessionsTypes'

// sonner's default export is a callable with methods; mock both the call and .error.
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() })
  return { toast }
})

vi.mock('../sessions/sessionsStore', () => ({ useSessions: vi.fn() }))
vi.mock('../sessions/queueStore', () => ({
  useSessionQueue: vi.fn(),
  addProblem: vi.fn(),
  removeItem: vi.fn(),
}))

const BOARD = 7

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    ownerId: 'u1',
    name: 'Session',
    boardLayoutId: BOARD,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deleted: false,
    litProblemId: null,
    litBy: null,
    litAt: null,
    ...overrides,
  }
}

function queueItem(sourceCatalogId: string): QueueItem {
  const now = new Date().toISOString()
  return {
    id: `q-${sourceCatalogId}`,
    sessionId: 's1',
    sourceCatalogId,
    boardLayoutId: BOARD,
    addedBy: 'u1',
    position: 1,
    doneAt: null,
    doneBy: null,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
}

/** Point the mocked stores at a given session + active queue. */
function setup({
  activeSession = session(),
  activeItems = [] as QueueItem[],
}: { activeSession?: Session | null; activeItems?: QueueItem[] } = {}) {
  vi.mocked(useSessions).mockReturnValue({
    status: activeSession ? 'active' : 'idle',
    activeSession,
    roster: [],
    memberStatus: {},
    selfId: 'u1',
    error: null,
  })
  vi.mocked(useSessionQueue).mockReturnValue({
    status: 'loaded',
    activeItems,
    doneItems: [],
    error: null,
  })
}

function renderAction(sourceCatalogId = 'a', boardLayoutId = BOARD) {
  return render(
    <ProblemDetailAddToQueue sourceCatalogId={sourceCatalogId} boardLayoutId={boardLayoutId} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(addProblem).mockResolvedValue('ok')
  vi.mocked(removeItem).mockResolvedValue(undefined)
})

describe('ProblemDetailAddToQueue', () => {
  it('adds the open problem to the queue and reflects the queued state', async () => {
    setup({ activeItems: [] })
    const { rerender } = renderAction('a')

    const add = screen.getByRole('button', { name: 'Add to queue' })
    await act(async () => {
      fireEvent.click(add)
    })
    expect(addProblem).toHaveBeenCalledWith('a', BOARD)

    // The store now reports the problem as active → the action toggles to "Remove from queue".
    setup({ activeItems: [queueItem('a')] })
    rerender(<ProblemDetailAddToQueue sourceCatalogId="a" boardLayoutId={BOARD} />)
    const queued = screen.getByRole('button', { name: 'Remove from queue' })
    expect(queued).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Add to queue' })).not.toBeInTheDocument()
  })

  it('removes the problem from the queue when tapped while already queued (no toast)', async () => {
    setup({ activeItems: [queueItem('a')] })
    renderAction('a')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove from queue' }))
    })
    expect(removeItem).toHaveBeenCalledWith('q-a')
    // Silent success: the icon toggles back and the row rail clears, so no toast fires.
    expect(toast).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('is hidden when there is no active session', () => {
    setup({ activeSession: null })
    renderAction('a')
    expect(screen.queryByRole('button', { name: 'Add to queue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove from queue' })).not.toBeInTheDocument()
  })

  it('is hidden when the active session is on a different board', () => {
    setup({ activeSession: session({ boardLayoutId: 1 }) })
    renderAction('a', BOARD)
    expect(screen.queryByRole('button', { name: 'Add to queue' })).not.toBeInTheDocument()
  })

  it('shows an already-in-queue note when the add is a no-op', async () => {
    setup({ activeItems: [] })
    vi.mocked(addProblem).mockResolvedValueOnce('already-active')
    renderAction('a')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    })
    expect(addProblem).toHaveBeenCalledWith('a', BOARD)
    expect(toast).toHaveBeenCalledWith(
      'Already in the queue',
      expect.objectContaining({ position: 'top-center' }),
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('starts already-queued (as a remove toggle) when the problem is already active', () => {
    setup({ activeItems: [queueItem('a')] })
    renderAction('a')
    expect(screen.getByRole('button', { name: 'Remove from queue' })).toBeEnabled()
    expect(addProblem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
  })
})
