import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getActiveInstanceId } from '../board/boardStore'

const h = vi.hoisted(() => ({
  activeSession: null as unknown,
  status: 'signedInWithProfile' as string,
  liveSessions: [] as unknown[],
  resumeResult: { live: true } as { live: boolean },
  listMyLiveSessions: vi.fn(),
  resumeSession: vi.fn(),
  navigate: vi.fn(),
  navigateToSessionBoard: vi.fn(),
}))
vi.mock('@tanstack/react-router', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  useNavigate: () => h.navigate,
}))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: h.status }) }))
vi.mock('../sessions/sessionsStore', () => ({
  useSessions: () => ({ activeSession: h.activeSession }),
  listMyLiveSessions: (...a: unknown[]) => h.listMyLiveSessions(...a),
  resumeSession: (...a: unknown[]) => h.resumeSession(...a),
}))
vi.mock('../sessions/sessionNav', () => ({
  navigateToSessionBoard: (...a: unknown[]) => h.navigateToSessionBoard(...a),
}))
vi.mock('../sessions/ScanToJoin', () => ({
  ScanToJoinButton: (p: { children: React.ReactNode; 'aria-label'?: string }) => (
    <button aria-label={p['aria-label']}>{p.children}</button>
  ),
}))

import { MyBoards } from './MyBoards'

beforeEach(() => {
  h.activeSession = null
  h.status = 'signedInWithProfile'
  h.liveSessions = []
  h.resumeResult = { live: true }
  h.listMyLiveSessions.mockReset().mockImplementation(async () => h.liveSessions)
  h.resumeSession.mockReset().mockImplementation(async () => h.resumeResult)
  h.navigate.mockClear()
  h.navigateToSessionBoard.mockClear()
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // reset boardStore snapshot
})

/** Add a board by name, driving the guided setup flow to completion. */
function addBoard(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /Add a board/ }))
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
  // Multi-angle boards get an angle step; single-angle ones skip straight to hold sets.
  const next = screen.queryByRole('button', { name: 'Next' })
  if (next) fireEvent.click(next)
  fireEvent.click(screen.getByRole('button', { name: 'Add board' }))
}

/** A board section by its heading ("My boards" / "Shared with me"). */
const section = (title: string) => screen.getByText(title).closest('section')!

/** Board names in a section's rendered order, for asserting the frozen order. */
const namesIn = (title: string) =>
  within(section(title))
    .getAllByRole('button', { name: /^Configure / })
    .map((b) => b.getAttribute('aria-label')!.replace('Configure ', ''))

/** Open a board's config from its row. */
function openConfig(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Configure ${name}` }))
}

describe('MyBoards', () => {
  it('shows the first-run prompt with a single way in', () => {
    render(<MyBoards onActivated={() => {}} />)
    expect(screen.getByText('Add your first board')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a board' })).toBeInTheDocument()
  })

  it('offers every unheld board in the flow’s first step, and drops one once held', () => {
    render(<MyBoards onActivated={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a board' }))
    expect(screen.getByText('Which board do you have?')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /MoonBoard/ })).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: /Mini MoonBoard 2025/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add board' }))

    fireEvent.click(screen.getByRole('button', { name: /Add a board/ }))
    expect(screen.getAllByRole('button', { name: /MoonBoard/ })).toHaveLength(4)
  })

  it('offers Join a session with no active session (including first-run)', () => {
    render(<MyBoards onActivated={() => {}} />)
    expect(screen.getByRole('button', { name: 'Join a session' })).toBeInTheDocument()
  })

  it('hides Join a session while a session is active', () => {
    h.activeSession = { id: 'S1', boardLayoutId: 7 }
    render(<MyBoards onActivated={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Join a session' })).not.toBeInTheDocument()
  })

  it('makes the first owned board active, and Browse opens its catalog', () => {
    const onActivated = vi.fn()
    render(<MyBoards onActivated={onActivated} />)
    addBoard('MoonBoard Masters 2019') // first owned board → becomes active
    expect(getActiveInstanceId()).toBe('5')

    fireEvent.click(within(section('My boards')).getByRole('button', { name: 'Browse' }))
    expect(onActivated).toHaveBeenCalledWith('5')
    expect(getActiveInstanceId()).toBe('5') // Browse doesn't switch the active board
  })

  it('Set as active switches the active board without leaving the list', () => {
    const onActivated = vi.fn()
    render(<MyBoards onActivated={onActivated} />)
    addBoard('MoonBoard Masters 2019') // active (id 5)
    addBoard('MoonBoard Masters 2017') // owned but not active (id 4)
    const list = () => section('My boards')

    // Exactly one Browse (the active board) and one Set as active (the other).
    expect(within(list()).getAllByRole('button', { name: 'Browse' })).toHaveLength(1)
    const orderBefore = namesIn('My boards')
    fireEvent.click(within(list()).getByRole('button', { name: 'Set as active' }))

    expect(getActiveInstanceId()).toBe('4') // switched
    expect(onActivated).not.toHaveBeenCalled() // stayed on the list, no navigation
    // The row order does not reshuffle on activate — the badge/button swap in place.
    expect(namesIn('My boards')).toEqual(orderBefore)
    expect(within(list()).getAllByRole('button', { name: 'Browse' })).toHaveLength(1)
  })

  describe('own vs shared sections', () => {
    /** Seed a shared board alongside whatever else is held. */
    function seedShared(name = 'Gym wall') {
      localStorage.setItem(
        'sharedBoard__S:b1',
        JSON.stringify({
          boardId: 'b1',
          role: 'member',
          name,
          layoutId: 5,
          angleMode: 'fixed',
          canonicalAngle: 25,
          canonicalHoldSetsRaw: '',
        }),
      )
    }

    it('hides the shared section entirely when nothing is shared with you', () => {
      render(<MyBoards onActivated={() => {}} />)
      addBoard('MoonBoard Masters 2019')
      expect(screen.getByText('My boards')).toBeInTheDocument()
      expect(screen.queryByText('Shared with me')).toBeNull()
    })

    it('splits a local and a shared board of the SAME layout across the two sections', () => {
      // The case the instance model exists for: your own 2019 and a shared 2019 at once.
      seedShared()
      localStorage.setItem('addedBoards', '5|S:b1')
      localStorage.setItem('activeBoardId', '5')
      window.dispatchEvent(new StorageEvent('storage'))
      render(<MyBoards onActivated={() => {}} />)

      expect(namesIn('My boards')).toEqual(['MoonBoard Masters 2019'])
      expect(namesIn('Shared with me')).toEqual(['Gym wall'])
    })

    it('shows each board its own config, so sibling instances do not blur together', () => {
      seedShared()
      localStorage.setItem('addedBoards', '5|S:b1')
      localStorage.setItem('activeBoardId', '5')
      localStorage.setItem('angle_5', '40')
      window.dispatchEvent(new StorageEvent('storage'))
      render(<MyBoards onActivated={() => {}} />)

      expect(within(section('My boards')).getByText(/40°/)).toBeInTheDocument()
      expect(within(section('Shared with me')).getByText(/25°/)).toBeInTheDocument()
    })

    it('keeps the Active badge on whichever section holds the active board', () => {
      seedShared()
      localStorage.setItem('addedBoards', '5|S:b1')
      localStorage.setItem('activeBoardId', 'S:b1')
      window.dispatchEvent(new StorageEvent('storage'))
      render(<MyBoards onActivated={() => {}} />)

      expect(within(section('Shared with me')).getByText('Active')).toBeInTheDocument()
      expect(within(section('My boards')).queryByText('Active')).toBeNull()
      expect(within(section('Shared with me')).getByRole('button', { name: 'Browse' })).toBeInTheDocument()
    })

    it('drops the shared section when its last board is detached to local', () => {
      seedShared()
      localStorage.setItem('addedBoards', 'S:b1')
      localStorage.setItem('activeBoardId', 'S:b1')
      window.dispatchEvent(new StorageEvent('storage'))
      render(<MyBoards onActivated={() => {}} />)
      expect(screen.getByText('Shared with me')).toBeInTheDocument()

      openConfig('Gym wall')
      fireEvent.click(screen.getByRole('button', { name: /Make this my own board/ }))
      fireEvent.click(screen.getByRole('button', { name: /Confirm — stop following/ }))

      expect(screen.queryByText('Shared with me')).toBeNull()
      expect(namesIn('My boards')).toEqual(['MoonBoard Masters 2019'])
    })
  })

  it('renders no board sections or share affordance at first run', () => {
    render(<MyBoards onActivated={() => {}} />)
    expect(screen.queryByText('My boards')).toBeNull()
    expect(screen.queryByText('Shared with me')).toBeNull()
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
  })

  it('renders no share affordance anywhere while sharing is unavailable', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('MoonBoard Masters 2019')
    addBoard('MoonBoard Masters 2017')
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
    expect(screen.queryByText(/^Share/)).toBeNull()
  })

  // ── U3: cross-device "Resume session" surface ──

  const tick = () => new Promise((r) => setTimeout(r))

  it('lists resumable sessions when signed in with no active session (R1)', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    render(<MyBoards onActivated={() => {}} />)
    expect(await screen.findByText('Resume session')).toBeInTheDocument()
    expect(screen.getByText('Tuesday crew')).toBeInTheDocument()
  })

  it('does not fetch or list resumable sessions while a session is active (R5)', async () => {
    h.activeSession = { id: 'S1', boardLayoutId: 7 }
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    render(<MyBoards onActivated={() => {}} />)
    await tick()
    expect(h.listMyLiveSessions).not.toHaveBeenCalled()
    expect(screen.queryByText('Resume session')).not.toBeInTheDocument()
  })

  it('does not fetch resumable sessions when signed out (R5)', async () => {
    h.status = 'signedOut'
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    render(<MyBoards onActivated={() => {}} />)
    await tick()
    expect(h.listMyLiveSessions).not.toHaveBeenCalled()
    expect(screen.queryByText('Resume session')).not.toBeInTheDocument()
  })

  it('renders no Resume section when there are no live sessions (R5)', async () => {
    h.liveSessions = []
    render(<MyBoards onActivated={() => {}} />)
    await waitFor(() => expect(h.listMyLiveSessions).toHaveBeenCalled())
    expect(screen.queryByText('Resume session')).not.toBeInTheDocument()
  })

  it('resumes a live session and lands in its board catalog (R3)', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    h.resumeResult = { live: true }
    render(<MyBoards onActivated={() => {}} />)
    fireEvent.click(await screen.findByText('Tuesday crew'))
    await waitFor(() =>
      expect(h.resumeSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'S9' })),
    )
    await waitFor(() =>
      expect(h.navigateToSessionBoard).toHaveBeenCalledWith(
        h.navigate,
        expect.objectContaining({ id: 'S9' }),
      ),
    )
  })

  it('shows an ended notice and drops the row for a dead-on-arrival session (R3)', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    h.resumeResult = { live: false }
    render(<MyBoards onActivated={() => {}} />)
    fireEvent.click(await screen.findByText('Tuesday crew'))
    expect(await screen.findByText('That session has ended.')).toBeInTheDocument()
    expect(h.navigateToSessionBoard).not.toHaveBeenCalled()
    expect(screen.queryByText('Tuesday crew')).not.toBeInTheDocument()
  })

  it('hides the ended notice once a refetch repopulates the resume list (R3/R5)', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    h.resumeResult = { live: false }
    render(<MyBoards onActivated={() => {}} />)
    fireEvent.click(await screen.findByText('Tuesday crew'))
    expect(await screen.findByText('That session has ended.')).toBeInTheDocument()
    // A later refetch surfaces a different live session — the stale ended notice must not coexist
    // with a populated Resume list.
    h.liveSessions = [{ id: 'S10', name: 'Wednesday crew', boardLayoutId: 7 }]
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('Wednesday crew')).toBeInTheDocument()
    expect(screen.queryByText('That session has ended.')).not.toBeInTheDocument()
  })

  it('does not resurrect the ended notice after a repopulate-then-empty refetch cycle (R3/R5)', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    h.resumeResult = { live: false }
    render(<MyBoards onActivated={() => {}} />)
    fireEvent.click(await screen.findByText('Tuesday crew'))
    expect(await screen.findByText('That session has ended.')).toBeInTheDocument()
    // A refetch surfaces a new session → the stale notice is cleared, not just masked.
    h.liveSessions = [{ id: 'S10', name: 'Wednesday crew', boardLayoutId: 7 }]
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('Wednesday crew')).toBeInTheDocument()
    // That session then ends elsewhere and the list empties again: the notice must NOT reappear —
    // the user never re-triggered it (guards against the phantom-notice edge).
    h.liveSessions = []
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(screen.queryByText('Wednesday crew')).not.toBeInTheDocument())
    expect(screen.queryByText('That session has ended.')).not.toBeInTheDocument()
  })

  it('refetches resumable sessions on foreground and reconnect (R5 self-heal)', async () => {
    render(<MyBoards onActivated={() => {}} />)
    await waitFor(() => expect(h.listMyLiveSessions).toHaveBeenCalledTimes(1))
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(h.listMyLiveSessions).toHaveBeenCalledTimes(2))
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(h.listMyLiveSessions).toHaveBeenCalledTimes(3))
  })
})
