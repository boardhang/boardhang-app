import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'

const h = vi.hoisted(() => ({
  sessions: { activeSession: null as unknown, roster: [] as unknown[], selfId: null as string | null },
  authStatus: 'signedInWithProfile' as string,
  createSession: vi.fn().mockResolvedValue({}),
  leaveSession: vi.fn().mockResolvedValue(undefined),
  endSession: vi.fn().mockResolvedValue(undefined),
  removeMember: vi.fn().mockResolvedValue(undefined),
  renameSession: vi.fn().mockResolvedValue(undefined),
  refreshActiveSession: vi.fn().mockResolvedValue({ live: true }),
  refreshMemberAscents: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../sessions/sessionsStore', () => ({
  useSessions: () => h.sessions,
  createSession: (...a: unknown[]) => h.createSession(...a),
  leaveSession: () => h.leaveSession(),
  endSession: () => h.endSession(),
  removeMember: (...a: unknown[]) => h.removeMember(...a),
  renameSession: (...a: unknown[]) => h.renameSession(...a),
  refreshActiveSession: (...a: unknown[]) => h.refreshActiveSession(...a),
}))
vi.mock('../sessions/memberAscentsStore', () => ({ refreshMemberAscents: () => h.refreshMemberAscents() }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: h.authStatus }) }))
vi.mock('../sessions/ShareSession', () => ({ ShareSession: () => <div>share-surface</div> }))
// QueueDrawer is ActiveBar's own unit's concern — stub it so the SessionBar test stays isolated.
vi.mock('../sessions/QueueDrawer', () => ({ QueueDrawer: () => null }))
// Stand-in for the scanner-first launcher: exposes the scanner surface plus the demoted host
// action so StartBar's wiring (open, onStart, canStart) is observable without the real camera.
vi.mock('../sessions/ScanToJoin', () => ({
  ScanToJoin: ({
    open,
    onStart,
    starting,
    canStart,
  }: {
    open: boolean
    onStart?: () => void
    starting?: boolean
    canStart?: boolean
  }) =>
    open ? (
      <div>
        <div>scanner-surface</div>
        {onStart && (
          <button disabled={!canStart || starting} onClick={onStart}>
            Start your own session
          </button>
        )}
      </div>
    ) : null,
}))

import { SessionBar } from './SessionBar'

const board = boardByLayoutId(7)!

beforeEach(() => {
  h.sessions = { activeSession: null, roster: [], selfId: null }
  h.authStatus = 'signedInWithProfile'
  h.createSession.mockClear().mockResolvedValue({})
  h.leaveSession.mockClear()
  h.endSession.mockClear()
  h.removeMember.mockClear()
})

afterEach(() => vi.restoreAllMocks())

describe('SessionBar', () => {
  it('opens the scanner-first launcher and starts a session from it, opening Share', async () => {
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start or join a session' }))
    expect(screen.getByText('scanner-surface')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /start your own session/i }))
    expect(h.createSession).toHaveBeenCalledWith(board.layoutId, expect.any(String))
    expect(await screen.findByText('share-surface')).toBeInTheDocument()
  })

  it('disables the host action in the launcher when signed out', () => {
    h.authStatus = 'signedOut'
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start or join a session' }))
    expect(screen.getByRole('button', { name: /start your own session/i })).toBeDisabled()
  })

  it('drops the Session launcher affordance once a session for this board is active', () => {
    h.sessions = { activeSession: { id: 'S1', name: 'Crew', boardLayoutId: 7 }, roster: [], selfId: null }
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Start or join a session' })).not.toBeInTheDocument()
  })

  it('renders nothing when a session is active for a different board', () => {
    h.sessions = { activeSession: { id: 'S1', name: 'Other', boardLayoutId: 99 }, roster: [], selfId: null }
    const { container } = render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the active session bar with name, members, and Leave', () => {
    h.sessions = {
      activeSession: { id: 'S1', name: 'Crew', boardLayoutId: 7 },
      roster: [{ userId: 'me', joinedAt: '', handle: 'me', displayName: 'Me' }],
      selfId: null,
    }
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(screen.getByRole('button', { name: 'Crew' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave session' }))
    expect(h.leaveSession).toHaveBeenCalled()
  })

  it('lets the owner remove another member from the ⋯ menu (KTD-11); non-owner sees none', () => {
    h.sessions = {
      activeSession: { id: 'S1', name: 'Crew', ownerId: 'me', boardLayoutId: 7 },
      roster: [
        { userId: 'me', joinedAt: '', handle: 'me', displayName: 'Me' },
        { userId: 'bob', joinedAt: '', handle: 'bob', displayName: 'Bob' },
      ],
      selfId: 'me',
    }
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }))
    expect(h.removeMember).toHaveBeenCalledWith('bob')
  })

  it('lets the owner end the session from the ⋯ menu (solo → "End session")', () => {
    h.sessions = {
      activeSession: { id: 'S1', name: 'Crew', ownerId: 'me', boardLayoutId: 7 },
      roster: [{ userId: 'me', joinedAt: '', handle: 'me', displayName: 'Me' }],
      selfId: 'me',
    }
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }))
    // Solo owner: the end control collapses to "End session" (no one else to leave behind).
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(h.endSession).toHaveBeenCalled()
  })

  it('a non-owner sees no end-session control in the ⋯ menu', () => {
    h.sessions = {
      activeSession: { id: 'S1', name: 'Crew', ownerId: 'someone-else', boardLayoutId: 7 },
      roster: [{ userId: 'me', joinedAt: '', handle: 'me', displayName: 'Me' }],
      selfId: 'me',
    }
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }))
    expect(screen.queryByRole('button', { name: /End session/ })).toBeNull()
  })

  it('a non-owner sees no remove control in the ⋯ menu', () => {
    h.sessions = {
      activeSession: { id: 'S1', name: 'Crew', ownerId: 'someone-else', boardLayoutId: 7 },
      roster: [
        { userId: 'me', joinedAt: '', handle: 'me', displayName: 'Me' },
        { userId: 'bob', joinedAt: '', handle: 'bob', displayName: 'Bob' },
      ],
      selfId: 'me',
    }
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }))
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  })
})
