import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getActiveBoardId } from '../board/boardStore'

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

/** Add a board by name from the "Add a board" list. */
function addBoard(name: string) {
  const addRow = screen.getByText(name).closest('div')!
  fireEvent.click(within(addRow).getByRole('button', { name: 'Add' }))
}

/** Open a board's config drawer. */
function openConfig(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Configure ${name}` }))
}

/** Hold-set / angle toggles in the open drawer (the aria-pressed buttons). */
const toggles = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))

describe('MyBoards', () => {
  it('shows the first-run prompt and every addable board when none are added', () => {
    render(<MyBoards onActivated={() => {}} />)
    expect(screen.getByText('Add your first board')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(5)
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
    expect(getActiveBoardId()).toBe(5)
    const myBoards = screen.getByText('My boards').closest('section')!
    fireEvent.click(within(myBoards).getByRole('button', { name: 'Browse' }))
    expect(onActivated).toHaveBeenCalledWith(5)
    expect(getActiveBoardId()).toBe(5) // Browse doesn't switch the active board
  })

  it('Set as active switches the active board without leaving the list', () => {
    const onActivated = vi.fn()
    render(<MyBoards onActivated={onActivated} />)
    addBoard('MoonBoard Masters 2019') // active (id 5)
    addBoard('MoonBoard Masters 2017') // owned but not active (id 4)
    const myBoards = screen.getByText('My boards').closest('section')!

    // Exactly one Browse (the active board) and one Set as active (the other).
    expect(within(myBoards).getAllByRole('button', { name: 'Browse' })).toHaveLength(1)
    const orderBefore = within(myBoards)
      .getAllByText(/MoonBoard Masters 20\d\d/)
      .map((el) => el.textContent)
    fireEvent.click(within(myBoards).getByRole('button', { name: 'Set as active' }))

    expect(getActiveBoardId()).toBe(4) // switched
    expect(onActivated).not.toHaveBeenCalled() // stayed on the list, no navigation
    // The row order does not reshuffle on activate — the badge/button swap in place.
    const orderAfter = within(myBoards)
      .getAllByText(/MoonBoard Masters 20\d\d/)
      .map((el) => el.textContent)
    expect(orderAfter).toEqual(orderBefore)
    // The Browse button (active board) is now on the board that was switched to.
    expect(within(myBoards).getAllByRole('button', { name: 'Browse' })).toHaveLength(1)
  })

  it('configures the angle from the board drawer', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('MoonBoard Masters 2019')
    openConfig('MoonBoard Masters 2019')
    expect(screen.getByRole('button', { name: '40°' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    expect(screen.getByRole('button', { name: '25°' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles installed hold sets and blocks removing the last one', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('Mini MoonBoard 2025') // 4 hold sets, no angle choice
    openConfig('Mini MoonBoard 2025')
    expect(toggles()).toHaveLength(4)

    fireEvent.click(toggles()[0])
    fireEvent.click(toggles()[1])
    fireEvent.click(toggles()[2])
    const stillOn = toggles().filter((t) => t.getAttribute('aria-pressed') === 'true')
    expect(stillOn).toHaveLength(1)
    expect(stillOn[0]).toBeDisabled()
  })

  it('removes a board from its drawer after a confirm click', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('MoonBoard Masters 2019')
    expect(screen.getByText('My boards')).toBeInTheDocument()

    openConfig('MoonBoard Masters 2019')
    fireEvent.click(screen.getByRole('button', { name: 'Remove board' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(screen.queryByText('My boards')).toBeNull() // back to first-run
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
