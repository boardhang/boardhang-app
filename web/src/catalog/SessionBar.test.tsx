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
  resumable: [] as unknown[],
  resumingId: null as string | null,
  endedNotice: false,
  onResume: vi.fn(),
  lastResumeOpts: undefined as { boardLayoutId?: number } | undefined,
  // The lit-row resolver (#97): ids the fake catalog cache can resolve, mapped to problems.
  litCache: new Map<string, unknown>(),
}))

vi.mock('../sessions/sessionsStore', () => ({
  useSessions: () => h.sessions,
  createSession: (...a: unknown[]) => h.createSession(...a),
  leaveSession: () => h.leaveSession(),
  endSession: () => h.endSession(),
  removeMember: (...a: unknown[]) => h.removeMember(...a),
  renameSession: (...a: unknown[]) => h.renameSession(...a),
}))
vi.mock('../sessions/useResumableSessions', () => ({
  useResumableSessions: (opts?: { boardLayoutId?: number }) => {
    h.lastResumeOpts = opts
    return {
      resumable: h.resumable,
      resumingId: h.resumingId,
      endedNotice: h.endedNotice,
      onResume: (...a: unknown[]) => h.onResume(...a),
    }
  },
}))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: h.authStatus }) }))
// The lit row resolves its problem from the offline catalog cache — stub it (#97).
vi.mock('./catalogSync', () => ({
  getCatalogProblemsByIds: (ids: string[]) =>
    Promise.resolve(new Map(ids.filter((id) => h.litCache.has(id)).map((id) => [id, h.litCache.get(id)]))),
}))
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
  h.resumable = []
  h.resumingId = null
  h.endedNotice = false
  h.onResume.mockClear()
  h.lastResumeOpts = undefined
  h.litCache = new Map()
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

  // ── In-context Resume: cross-device session discovered while browsing this board ──

  it('scopes the resumable-sessions hook to this board', () => {
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(h.lastResumeOpts).toEqual({ boardLayoutId: board.layoutId })
  })

  it('renders a Resume row above StartBar when a live session for this board exists', () => {
    h.resumable = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(screen.getByText('Tuesday crew')).toBeInTheDocument()
    // StartBar's launcher still visible — non-destructive stack.
    expect(screen.getByRole('button', { name: 'Start or join a session' })).toBeInTheDocument()
  })

  it('tapping a Resume row calls the hook onResume with that session', () => {
    h.resumable = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    fireEvent.click(screen.getByText('Tuesday crew'))
    expect(h.onResume).toHaveBeenCalledWith(expect.objectContaining({ id: 'S9' }))
  })

  it('renders a slim ended-notice row when the hook signals dead-on-arrival', () => {
    h.endedNotice = true
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('That session has ended.')
    // StartBar still available — user can still start/join anew.
    expect(screen.getByRole('button', { name: 'Start or join a session' })).toBeInTheDocument()
  })

  it('does not render Resume rows or ended-notice when a session for this board is already active', () => {
    h.sessions = { activeSession: { id: 'S1', name: 'Crew', boardLayoutId: 7 }, roster: [], selfId: null }
    h.resumable = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }] // ignored — ActiveBar path
    h.endedNotice = true
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(screen.queryByText('Tuesday crew')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('SessionBar — "now on the wall" (#97)', () => {
  it('shows the lit row with the resolved problem + lighter, and opens it on tap', async () => {
    h.litCache = new Map([['p-lit', { source_catalog_id: 'p-lit', name: 'Mega Crimp', grade: '7A' }]])
    h.sessions = {
      activeSession: { id: 'S1', name: 'Crew', boardLayoutId: 7, litProblemId: 'p-lit', litBy: 'friend-1' },
      roster: [{ userId: 'friend-1', joinedAt: '', handle: 'ida', displayName: 'Ida', avatarUrl: null }],
      selfId: null,
    }
    const onOpen = vi.fn()
    render(<SessionBar board={board} onOpenProblem={onOpen} />)
    expect(await screen.findByText('Mega Crimp')).toBeInTheDocument()
    expect(screen.getByText('lit by Ida')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Open the problem that’s on the wall'))
    // Opens over the default pager domain (no stack) — and never re-lights the board.
    expect(onOpen).toHaveBeenCalledWith('p-lit')
  })

  it('falls back to a neutral label when unresolved, and says "you" for a self light-up', async () => {
    h.sessions = {
      activeSession: { id: 'S1', name: 'Crew', boardLayoutId: 7, litProblemId: 'p-unknown', litBy: 'me' },
      roster: [{ userId: 'me', joinedAt: '', handle: 'me', displayName: 'Me', avatarUrl: null }],
      selfId: 'me',
    }
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(await screen.findByText('a climb')).toBeInTheDocument()
    expect(screen.getByText('lit by you')).toBeInTheDocument()
  })

  it('renders no lit row while the session has no lit problem', () => {
    h.sessions = { activeSession: { id: 'S1', name: 'Crew', boardLayoutId: 7 }, roster: [], selfId: null }
    render(<SessionBar board={board} onOpenProblem={() => {}} />)
    expect(screen.queryByText(/On the wall:/)).not.toBeInTheDocument()
  })
})
