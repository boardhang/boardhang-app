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
// ActiveBar now resolves a route navigate for the queue's tap-to-open (KTD9); stub the router
// api (this test renders ActiveBar without a router) and the QueueDrawer (its own unit's concern).
vi.mock('@tanstack/react-router', () => ({ getRouteApi: () => ({ useNavigate: () => vi.fn() }) }))
vi.mock('../sessions/QueueDrawer', () => ({ QueueDrawer: () => null }))

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
  it('offers Start session and creates one for this board, opening Share', async () => {
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(h.createSession).toHaveBeenCalledWith(board.layoutId, expect.any(String))
    expect(await screen.findByText('share-surface')).toBeInTheDocument()
  })

  it('disables Start session when signed out', () => {
    h.authStatus = 'signedOut'
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled()
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

  it('lets the owner end the session for everyone from the ⋯ menu; non-owner does not see it', () => {
    h.sessions = {
      activeSession: { id: 'S1', name: 'Crew', ownerId: 'me', boardLayoutId: 7 },
      roster: [{ userId: 'me', joinedAt: '', handle: 'me', displayName: 'Me' }],
      selfId: 'me',
    }
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }))
    fireEvent.click(screen.getByRole('button', { name: 'End session for everyone' }))
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
    expect(screen.queryByRole('button', { name: 'End session for everyone' })).toBeNull()
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
