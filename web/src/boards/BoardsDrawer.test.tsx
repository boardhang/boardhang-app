import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BOARDS } from '../board/boards'
import { activateBoard, addBoard, getActiveBoardId, getAddedBoardIds, setAngle } from '../board/boardStore'

const h = vi.hoisted(() => ({
  pathname: '/logbook',
  activeSession: null as unknown,
  status: 'signedInWithProfile' as string,
  liveSessions: [] as unknown[],
  resumeResult: { live: true } as { live: boolean },
  listMyLiveSessions: vi.fn(),
  resumeSession: vi.fn(),
  navigate: vi.fn(),
  navigateToSessionBoard: vi.fn(),
  refreshBenchmarkNews: vi.fn(),
  unseen: {} as Record<string, number>,
}))
vi.mock('@tanstack/react-router', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  useNavigate: () => h.navigate,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: h.pathname } }),
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
vi.mock('../catalog/benchmarkNewsStore', () => ({
  refreshBenchmarkNews: (...a: unknown[]) => h.refreshBenchmarkNews(...a),
  unseenCount: (layoutId: number, angle: number) => h.unseen[`${layoutId}:${angle}`] ?? 0,
  useBenchmarkNewsVersion: () => 0,
}))

import { BoardsDrawer } from './BoardsDrawer'

beforeEach(() => {
  h.pathname = '/logbook'
  h.activeSession = null
  h.status = 'signedInWithProfile'
  h.liveSessions = []
  h.resumeResult = { live: true }
  h.listMyLiveSessions.mockReset().mockImplementation(async () => h.liveSessions)
  h.resumeSession.mockReset().mockImplementation(async () => h.resumeResult)
  h.navigate.mockClear()
  h.navigateToSessionBoard.mockClear()
  h.refreshBenchmarkNews.mockReset().mockResolvedValue(undefined)
  h.unseen = {}
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // reset boardStore snapshot
})

const MINI = 'Mini MoonBoard 2025' // 7
const MB2024 = 'MoonBoard 2024' // 3

// `hidden`: while the drawer is open the page behind it, trigger included, is hidden
// from assistive tech — the queries below still need to reach it.
const trigger = () => screen.getByRole('button', { name: /, boards$/, hidden: true })
const drawer = () => within(screen.getByRole('dialog', { name: 'Boards' }))
const tiles = () => drawer().getAllByRole('button', { name: /^(Browse|Switch to) / })
const tileNames = () => tiles().map((t) => t.getAttribute('aria-label')!.replace(/^(Browse|Switch to) /, ''))

/** Mount the header trigger and open the drawer. */
async function openDrawer() {
  const utils = render(<BoardsDrawer />)
  fireEvent.click(trigger())
  await screen.findByRole('dialog', { name: 'Boards' })
  return utils
}

const drawerClosed = () => waitFor(() => expect(screen.queryByRole('dialog', { name: 'Boards' })).toBeNull())

describe('BoardsDrawer — header trigger', () => {
  it('shows the active board’s full name', () => {
    addBoard(3)
    render(<BoardsDrawer />)
    expect(trigger()).toHaveTextContent(MB2024)
    expect(trigger()).toHaveAccessibleName(`${MB2024}, boards`)
  })

  it('renders nothing when no board is added', () => {
    const { container } = render(<BoardsDrawer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('announces a dialog popup and whether it is open', async () => {
    addBoard(3)
    render(<BoardsDrawer />)
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger())
    await screen.findByRole('dialog', { name: 'Boards' })
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('BoardsDrawer — tiles', () => {
  it('shows one tile per added board, with short name and angle, plus the add tile', async () => {
    addBoard(3)
    setAngle(3, 25)
    addBoard(7) // 3 stays active
    await openDrawer()
    expect(tiles()).toHaveLength(2)
    expect(drawer().getByText('MB 2024')).toBeInTheDocument()
    expect(drawer().getByText('Mini MB 2025')).toBeInTheDocument()
    expect(within(drawer().getByRole('button', { name: `Browse ${MB2024}` })).getByText('25°')).toBeInTheDocument()
    expect(drawer().getByRole('button', { name: 'Add a board' })).toBeInTheDocument()
  })

  it('outlines only the active board’s tile, which offers Browse', async () => {
    addBoard(3)
    addBoard(7)
    await openDrawer()
    const active = drawer().getByRole('button', { name: `Browse ${MB2024}` })
    expect(active).toHaveAttribute('aria-current', 'true')
    expect(within(active).getByText('Browse')).toBeInTheDocument()
    const inactive = drawer().getByRole('button', { name: `Switch to ${MINI}` })
    expect(inactive).not.toHaveAttribute('aria-current')
    expect(within(inactive).queryByText('Browse')).toBeNull()
  })

  it('tapping an inactive tile activates it, keeps the drawer open and does not navigate', async () => {
    addBoard(3)
    addBoard(7)
    await openDrawer()
    const before = tileNames()
    fireEvent.click(drawer().getByRole('button', { name: `Switch to ${MINI}` }))

    expect(getActiveBoardId()).toBe(7)
    expect(drawer().getByRole('button', { name: `Browse ${MINI}` })).toHaveAttribute('aria-current', 'true')
    expect(trigger()).toHaveTextContent(MINI) // the header follows
    expect(tileNames()).toEqual(before) // tiles did not move
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('re-reads the stored order on the next open', async () => {
    addBoard(3)
    addBoard(7) // stored order: 7, 3 (3 active)
    await openDrawer()
    expect(tileNames()).toEqual([MINI, MB2024])
    act(() => activateBoard(3)) // promotes 3 to the front of the stored order
    expect(tileNames()).toEqual([MINI, MB2024]) // frozen while open

    fireEvent.click(drawer().getByRole('button', { name: `Browse ${MB2024}` })) // closes
    await drawerClosed()
    fireEvent.click(trigger())
    await screen.findByRole('dialog', { name: 'Boards' })
    expect(tileNames()).toEqual([MB2024, MINI])
  })

  it('tapping the active tile closes the drawer and opens its catalog', async () => {
    addBoard(3)
    addBoard(7)
    await openDrawer()
    fireEvent.click(drawer().getByRole('button', { name: `Browse ${MB2024}` }))
    await drawerClosed()
    expect(h.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/board/$layoutId/catalog', params: { layoutId: '3' } }),
    )
    expect(getActiveBoardId()).toBe(3)
  })

  it('tapping an inactive tile during a session switches the board and leaves the session alone', async () => {
    h.activeSession = { id: 'S1', boardLayoutId: 3 }
    addBoard(3)
    addBoard(7)
    await openDrawer()
    fireEvent.click(drawer().getByRole('button', { name: `Switch to ${MINI}` }))
    expect(getActiveBoardId()).toBe(7)
    expect(screen.getByRole('dialog', { name: 'Boards' })).toBeInTheDocument()
    expect(h.resumeSession).not.toHaveBeenCalled()
    expect(h.navigateToSessionBoard).not.toHaveBeenCalled()
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('the pencil opens that board’s edit page and closes the drawer', async () => {
    addBoard(3)
    addBoard(7)
    await openDrawer()
    fireEvent.click(drawer().getByRole('button', { name: `Edit ${MINI}` }))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/boards/$layoutId/edit', params: { layoutId: '7' } })
    await drawerClosed()
    expect(getActiveBoardId()).toBe(3) // editing does not activate
  })

  it('the add tile opens the add flow and closes the drawer', async () => {
    addBoard(3)
    await openDrawer()
    fireEvent.click(drawer().getByRole('button', { name: 'Add a board' }))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/boards/add' })
    await drawerClosed()
  })

  it('has no add tile once every registry board is added', async () => {
    for (const b of BOARDS) addBoard(b.layoutId)
    await openDrawer()
    expect(tiles()).toHaveLength(BOARDS.length)
    expect(drawer().queryByRole('button', { name: 'Add a board' })).toBeNull()
  })

  it('removes a tile when its board is removed elsewhere while open', async () => {
    addBoard(3)
    addBoard(7)
    await openDrawer()
    act(() => {
      localStorage.setItem('addedBoards', '3')
      window.dispatchEvent(new StorageEvent('storage'))
    })
    expect(tileNames()).toEqual([MB2024])
    expect(getAddedBoardIds()).toEqual([3])
  })
})

describe('BoardsDrawer — closing on navigation', () => {
  it('closes when the route changes to a screen that is not a catalog', async () => {
    addBoard(3)
    const { rerender } = await openDrawer()
    h.pathname = '/settings'
    rerender(<BoardsDrawer />)
    await drawerClosed()
  })

  it('stays open across a catalog-to-catalog change', async () => {
    h.pathname = '/board/3/catalog'
    addBoard(3)
    addBoard(7)
    const { rerender } = await openDrawer()
    h.pathname = '/board/7/catalog'
    rerender(<BoardsDrawer />)
    expect(screen.getByRole('dialog', { name: 'Boards' })).toBeInTheDocument()
  })
})

describe('BoardsDrawer — new-benchmark dots', () => {
  it('shows the dot on an inactive tile with unseen benchmarks', async () => {
    h.unseen = { '7:40': 2 }
    addBoard(3)
    addBoard(7)
    await openDrawer()
    expect(screen.getByTestId('new-benchmarks-dot-7')).toHaveTextContent('New benchmarks')
    expect(screen.queryByTestId('new-benchmarks-dot-3')).toBeNull()
  })

  it('never shows the dot on the active tile', async () => {
    h.unseen = { '3:40': 2 }
    addBoard(3)
    addBoard(7)
    await openDrawer()
    expect(screen.queryByTestId('new-benchmarks-dot-3')).toBeNull()
  })

  it('fetches benchmark news for every added board at its angle on open', async () => {
    addBoard(3)
    setAngle(3, 25)
    addBoard(7)
    render(<BoardsDrawer />)
    expect(h.refreshBenchmarkNews).not.toHaveBeenCalled() // nothing until the drawer opens
    fireEvent.click(trigger())
    await screen.findByRole('dialog', { name: 'Boards' })
    expect(h.refreshBenchmarkNews).toHaveBeenCalledWith([
      { layoutId: 7, angle: 40 },
      { layoutId: 3, angle: 25 },
    ])
  })
})

describe('BoardsDrawer — no join entry', () => {
  it('has no "Scan a QR code" row', async () => {
    addBoard(3)
    await openDrawer()
    expect(drawer().queryByRole('button', { name: /Scan a QR code/ })).toBeNull()
  })
})

describe('BoardsDrawer — resume session', () => {
  const tick = () => new Promise((r) => setTimeout(r))

  it('lists resumable sessions above the tiles when signed in with no active session', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    addBoard(3)
    await openDrawer()
    const heading = await drawer().findByText('Resume session')
    expect(drawer().getByText('Tuesday crew')).toBeInTheDocument()
    const boards = drawer().getByText('My boards')
    expect(heading.compareDocumentPosition(boards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('fetches per open, not while the drawer is closed', async () => {
    addBoard(3)
    render(<BoardsDrawer />)
    await tick()
    expect(h.listMyLiveSessions).not.toHaveBeenCalled()
    fireEvent.click(trigger())
    await waitFor(() => expect(h.listMyLiveSessions).toHaveBeenCalledTimes(1))
  })

  it('does not fetch or list resumable sessions while a session is active', async () => {
    h.activeSession = { id: 'S1', boardLayoutId: 7 }
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    addBoard(3)
    await openDrawer()
    await tick()
    expect(h.listMyLiveSessions).not.toHaveBeenCalled()
    expect(drawer().queryByText('Resume session')).toBeNull()
  })

  it('does not fetch resumable sessions when signed out', async () => {
    h.status = 'signedOut'
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    addBoard(3)
    await openDrawer()
    await tick()
    expect(h.listMyLiveSessions).not.toHaveBeenCalled()
    expect(drawer().queryByText('Resume session')).toBeNull()
  })

  it('renders no Resume section when there are no live sessions', async () => {
    addBoard(3)
    await openDrawer()
    await waitFor(() => expect(h.listMyLiveSessions).toHaveBeenCalled())
    expect(drawer().queryByText('Resume session')).toBeNull()
  })

  it('resumes a live session and lands on its board', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    addBoard(3)
    await openDrawer()
    fireEvent.click(await drawer().findByText('Tuesday crew'))
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

  it('closes once the resumed session is active', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    addBoard(3)
    const { rerender } = await openDrawer()
    await drawer().findByText('Tuesday crew')
    h.activeSession = { id: 'S9', boardLayoutId: 7 } // what a successful resume does to the store
    rerender(<BoardsDrawer />)
    await drawerClosed()
  })

  it('shows the ended notice and drops the row for a dead-on-arrival session', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    h.resumeResult = { live: false }
    addBoard(3)
    await openDrawer()
    fireEvent.click(await drawer().findByText('Tuesday crew'))
    expect(await drawer().findByText('That session has ended.')).toBeInTheDocument()
    expect(h.navigateToSessionBoard).not.toHaveBeenCalled()
    expect(drawer().queryByText('Tuesday crew')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Boards' })).toBeInTheDocument() // stays open
  })

  it('hides the ended notice once a refetch repopulates the resume list', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    h.resumeResult = { live: false }
    addBoard(3)
    await openDrawer()
    fireEvent.click(await drawer().findByText('Tuesday crew'))
    expect(await drawer().findByText('That session has ended.')).toBeInTheDocument()
    h.liveSessions = [{ id: 'S10', name: 'Wednesday crew', boardLayoutId: 7 }]
    window.dispatchEvent(new Event('online'))
    expect(await drawer().findByText('Wednesday crew')).toBeInTheDocument()
    expect(drawer().queryByText('That session has ended.')).toBeNull()
  })

  it('does not resurrect the ended notice after a repopulate-then-empty refetch cycle', async () => {
    h.liveSessions = [{ id: 'S9', name: 'Tuesday crew', boardLayoutId: 7 }]
    h.resumeResult = { live: false }
    addBoard(3)
    await openDrawer()
    fireEvent.click(await drawer().findByText('Tuesday crew'))
    expect(await drawer().findByText('That session has ended.')).toBeInTheDocument()
    // A refetch surfaces a new session: the stale notice is cleared, not just masked.
    h.liveSessions = [{ id: 'S10', name: 'Wednesday crew', boardLayoutId: 7 }]
    window.dispatchEvent(new Event('online'))
    expect(await drawer().findByText('Wednesday crew')).toBeInTheDocument()
    // That session then ends elsewhere and the list empties again: the notice must NOT
    // reappear, because the user never tapped it.
    h.liveSessions = []
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(drawer().queryByText('Wednesday crew')).toBeNull())
    expect(drawer().queryByText('That session has ended.')).toBeNull()
  })

  it('refetches resumable sessions on foreground and reconnect while open', async () => {
    addBoard(3)
    await openDrawer()
    await waitFor(() => expect(h.listMyLiveSessions).toHaveBeenCalledTimes(1))
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(h.listMyLiveSessions).toHaveBeenCalledTimes(2))
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(h.listMyLiveSessions).toHaveBeenCalledTimes(3))
  })
})
