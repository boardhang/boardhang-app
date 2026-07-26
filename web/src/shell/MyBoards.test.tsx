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

/** Add a board by name from the "Add a board" list. */
function addBoard(name: string) {
  const addSection = screen.getByText('Add a board').closest('section')!
  const addRow = within(addSection).getByText(name).closest('div')!
  fireEvent.click(within(addRow).getByRole('button', { name: 'Add' }))
}

/** The hero region (the active board). */
const hero = () => screen.getByRole('region', { name: 'Active board' })

/** The switcher section listing the non-active boards. */
const switcher = () => screen.getByText('My boards').closest('section')!

/** Board names in switcher order, for asserting the frozen order. */
const switcherOrder = () =>
  within(switcher())
    .getAllByRole('button', { name: /^Switch to / })
    .map((b) => b.getAttribute('aria-label')!.replace('Switch to ', ''))

/** Open the active board's config from the hero. */
function openHeroConfig() {
  fireEvent.click(within(hero()).getByRole('button', { name: 'Set up' }))
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

  it('leads with the active board as a hero and no switcher when it is the only one', () => {
    const onActivated = vi.fn()
    render(<MyBoards onActivated={onActivated} />)
    addBoard('MoonBoard Masters 2019') // first owned board → becomes active
    expect(getActiveInstanceId()).toBe('5')

    expect(within(hero()).getByRole('heading', { name: 'MoonBoard Masters 2019' })).toBeInTheDocument()
    expect(screen.queryByText('My boards')).toBeNull() // nothing to switch to

    fireEvent.click(within(hero()).getByRole('button', { name: 'Browse' }))
    expect(onActivated).toHaveBeenCalledWith('5')
    expect(getActiveInstanceId()).toBe('5') // Browse doesn't switch the active board
  })

  it('puts the active board in the hero and every other board in the switcher', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('MoonBoard Masters 2019') // active (id 5)
    addBoard('MoonBoard Masters 2017') // id 4
    addBoard('MoonBoard 2016') // id 2

    expect(within(hero()).getByRole('heading', { name: 'MoonBoard Masters 2019' })).toBeInTheDocument()
    expect(within(switcher()).getAllByRole('button', { name: /^Switch to / })).toHaveLength(2)
    // Exactly one Browse on the page — the hero's.
    expect(screen.getAllByRole('button', { name: 'Browse' })).toHaveLength(1)
  })

  it('promotes a switcher board into the hero, the outgoing hero taking its slot', () => {
    const onActivated = vi.fn()
    render(<MyBoards onActivated={onActivated} />)
    addBoard('MoonBoard Masters 2019') // id 5 → active, so it is the hero
    addBoard('MoonBoard Masters 2017') // id 4
    addBoard('MoonBoard 2016') // id 2

    // The switcher holds the two non-active boards. Order is frozen for this mount, so it
    // follows the sequence they were added in, not the store's MRU order.
    expect(switcherOrder()).toEqual(['MoonBoard Masters 2017', 'MoonBoard 2016'])

    // Promote the *second* switcher row (2016) — the case where the outgoing hero is not
    // adjacent to it, so a naive "frozen order minus active" would shuffle 2017 as well.
    fireEvent.click(within(switcher()).getAllByRole('button', { name: /^Switch to / })[1])

    expect(getActiveInstanceId()).toBe('2')
    expect(onActivated).not.toHaveBeenCalled() // stayed on the page, no navigation
    expect(within(hero()).getByRole('heading', { name: 'MoonBoard 2016' })).toBeInTheDocument()
    // The outgoing hero lands in the exact slot 2016 vacated, and 2017 has not moved.
    expect(switcherOrder()).toEqual(['MoonBoard Masters 2017', 'MoonBoard Masters 2019'])
  })

  it('tells two instances of one layout apart by the shared one’s owner-set name', () => {
    localStorage.setItem('addedBoards', '5|S:b1')
    localStorage.setItem('activeBoardId', '5')
    localStorage.setItem(
      'sharedBoard__S:b1',
      JSON.stringify({
        boardId: 'b1',
        role: 'member',
        name: 'Gym wall',
        layoutId: 5,
        angleMode: 'fixed',
        canonicalAngle: 25,
        canonicalHoldSetsRaw: '',
      }),
    )
    window.dispatchEvent(new StorageEvent('storage'))
    render(<MyBoards onActivated={() => {}} />)

    expect(within(hero()).getByRole('heading', { name: 'MoonBoard Masters 2019' })).toBeInTheDocument()
    expect(within(switcher()).getByText('Gym wall')).toBeInTheDocument()
  })

  it('states a fixed shared board’s angle and hold sets as read-only, offering no control', () => {
    // The store refuses these writes anyway, so offering a toggle that silently does
    // nothing would be worse than not offering one.
    localStorage.setItem('addedBoards', 'S:b1')
    localStorage.setItem('activeBoardId', 'S:b1')
    localStorage.setItem(
      'sharedBoard__S:b1',
      JSON.stringify({
        boardId: 'b1',
        role: 'member',
        name: 'Gym wall',
        layoutId: 5,
        angleMode: 'fixed',
        canonicalAngle: 25,
        canonicalHoldSetsRaw: '17|18',
      }),
    )
    window.dispatchEvent(new StorageEvent('storage'))
    render(<MyBoards onActivated={() => {}} />)
    openHeroConfig()

    expect(screen.queryByRole('button', { name: '40°' })).toBeNull()
    expect(screen.queryByRole('button', { name: '25°' })).toBeNull()
    expect(screen.getByText(/fixed by the board’s owner/)).toBeInTheDocument()
    expect(screen.getByText(/set by the board’s owner/)).toBeInTheDocument()
    expect(toggles()).toHaveLength(0)
  })

  it('still offers the controls to the owner of a shared board', () => {
    localStorage.setItem('addedBoards', 'S:b1')
    localStorage.setItem('activeBoardId', 'S:b1')
    localStorage.setItem(
      'sharedBoard__S:b1',
      JSON.stringify({
        boardId: 'b1',
        role: 'owner',
        name: 'My garage',
        layoutId: 5,
        angleMode: 'fixed',
        canonicalAngle: 25,
        canonicalHoldSetsRaw: '',
      }),
    )
    window.dispatchEvent(new StorageEvent('storage'))
    render(<MyBoards onActivated={() => {}} />)
    openHeroConfig()

    expect(screen.getByRole('button', { name: '25°' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/fixed by the board’s owner/)).toBeNull()
  })

  it('configures the active board’s angle from the hero’s Set up', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('MoonBoard Masters 2019')
    openHeroConfig()
    expect(screen.getByRole('button', { name: '40°' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    expect(screen.getByRole('button', { name: '25°' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('configures a non-active board from its switcher row', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('MoonBoard Masters 2019') // active
    addBoard('Mini MoonBoard 2025') // switcher; 4 hold sets, no angle choice
    fireEvent.click(screen.getByRole('button', { name: 'Configure Mini MoonBoard 2025' }))
    expect(toggles()).toHaveLength(4) // Mini's hold sets, not the active board's 7
  })

  it('toggles installed hold sets and blocks removing the last one', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('Mini MoonBoard 2025') // 4 hold sets, no angle choice
    openHeroConfig()
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
    expect(screen.getByRole('region', { name: 'Active board' })).toBeInTheDocument()

    openHeroConfig()
    fireEvent.click(screen.getByRole('button', { name: 'Remove board' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(screen.queryByRole('region', { name: 'Active board' })).toBeNull() // back to first-run
  })

  it('renders no hero, switcher, or share affordance at first run', () => {
    render(<MyBoards onActivated={() => {}} />)
    expect(screen.queryByRole('region', { name: 'Active board' })).toBeNull()
    expect(screen.queryByText('My boards')).toBeNull()
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
