import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from './test/renderWithRouter'
import {
  activateBoard,
  addBoard,
  getActiveBoardId,
  getActiveHoldSetsRaw,
  getAddedBoardIds,
  getAngle,
  removeBoard,
  setAngle,
} from './board/boardStore'
import { BOARDS, boardByLayoutId } from './board/boards'
import { resetAngleEdited } from './boards/angleEdited'
import { navigateToSessionBoard } from './sessions/sessionNav'
import type { Session } from './sessions/sessionsTypes'
import { catalogNavTarget } from './catalog/catalogNav'
import { resetLastOpened } from './catalog/lastOpenedStore'
import { loadSeed } from './catalog/filterSeed'
import type { CatalogProblem } from './catalog/catalogSync'

// Keep the slab deterministic and network-free so route behavior is what's tested.
function problem(id: string, name: string): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: 7,
    angle: 40,
    name,
    grade: '6B',
    user_grade: null,
    setter: 'Alice',
    stars: 0,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds: [{ c: 0, r: 1, t: 'start' }],
  }
}
const SLAB = [problem('a', 'Alpha'), problem('b', 'Bravo'), problem('c', 'Charlie')]

vi.mock('./catalog/useSlab', () => ({
  useSlab: () => ({ problems: SLAB, loading: false, degraded: false, resync: async () => true }),
}))

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // reset the boardStore snapshot
  resetLastOpened() // in-memory session singleton; clear so an open doesn't leak the bar
  resetAngleEdited()
})

// `hidden`: while the boards drawer is open the page behind it is hidden from
// assistive tech, the header's board name included.
const boardName = () => screen.getByRole('button', { name: /, boards$/, hidden: true })
const boardsDrawer = () => within(screen.getByRole('dialog', { name: 'Boards' }))
async function openBoardsDrawer() {
  fireEvent.click(boardName())
  await screen.findByRole('dialog', { name: 'Boards' })
}

describe('bare-/ redirect', () => {
  it('lands on the first-run page at /boards when no boards are added', async () => {
    const { router } = renderWithRouter('/')
    expect(await screen.findByText('Add your first board')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards')
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    // No board yet: the header names none, and the page carries the one add button.
    expect(screen.queryByRole('button', { name: /, boards$/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Add a board' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Scan a QR code/ })).toBeInTheDocument()
  })

  it('redirects to the active board catalog once a board is added', async () => {
    addBoard(7)
    renderWithRouter('/')
    // The catalog list renders the mocked slab.
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search problems' })).toBeInTheDocument()
  })

  it('lands on the active board, not the most recently added one', async () => {
    addBoard(7)
    addBoard(5) // front of the stored order, but 7 stays active
    const { router } = renderWithRouter('/')
    await screen.findByText('Alpha')
    expect(router.state.location.pathname).toBe('/board/7/catalog')
  })
})

describe('/boards', () => {
  it('redirects to the active board catalog once a board is added', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/boards')
    await screen.findByText('Alpha')
    expect(router.state.location.pathname).toBe('/board/7/catalog')
  })

  it('opens the add flow from the first-run button', async () => {
    const { router } = renderWithRouter('/boards')
    fireEvent.click(await screen.findByRole('button', { name: 'Add a board' }))
    expect(await screen.findByRole('heading', { name: 'Which board?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards/add')
  })
})

describe('bottom bar', () => {
  it('has no Boards tab, on the catalog or off it', async () => {
    addBoard(7)
    renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')
    const nav = () => within(screen.getByRole('navigation', { name: 'Primary' }))
    expect(nav().queryByRole('button', { name: 'Boards' })).toBeNull()
    fireEvent.click(nav().getByRole('button', { name: 'Logbook' }))
    await screen.findByRole('heading', { name: 'Logbook' })
    expect(nav().queryByRole('button', { name: 'Boards' })).toBeNull()
    expect(await nav().findByRole('button', { name: 'Search' })).toBeInTheDocument()
  })

  it('on the catalog shows only the tab last visited, Logbook to begin with', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')
    const nav = () => within(screen.getByRole('navigation', { name: 'Primary' }))
    const tabs = () =>
      nav()
        .getAllByRole('button')
        .map((b) => b.textContent)
    const path = (p: string) => waitFor(() => expect(router.state.location.pathname).toBe(p))
    expect(tabs()).toEqual(['Logbook'])

    fireEvent.click(nav().getByRole('button', { name: 'Logbook' }))
    await path('/logbook')
    fireEvent.click(await nav().findByRole('button', { name: 'Settings' }))
    await path('/settings')
    fireEvent.click(await nav().findByRole('button', { name: 'Search' }))
    await path('/board/7/catalog')
    await waitFor(() => expect(tabs()).toEqual(['Settings']))
  })

  it.each(['/boards', '/boards/add', '/boards/add/5', '/session/join/abc'])(
    'highlights no tab on %s',
    async (path) => {
      const { router } = renderWithRouter(path)
      await waitFor(() => expect(router.state.status).toBe('idle'))
      const nav = within(screen.getByRole('navigation', { name: 'Primary' }))
      for (const b of nav.getAllByRole('button')) expect(b).not.toHaveAttribute('aria-current')
    },
  )
})

describe('catalog route guards', () => {
  it('bounces an unknown board id to the active board catalog', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/board/999/catalog')
    await screen.findByText('Alpha')
    expect(router.state.location.pathname).toBe('/board/7/catalog')
  })

  it('bounces an unknown board id to the first-run page when no board is added', async () => {
    const { router } = renderWithRouter('/board/999/catalog')
    expect(await screen.findByText('Add your first board')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards')
  })

  it('previews a registry-valid but un-added board (does not bounce)', async () => {
    addBoard(7) // board 5 is valid but NOT added
    renderWithRouter('/board/5/catalog')
    expect(await screen.findByText('Add this board')).toBeInTheDocument()
    // Still browsable — the slab renders behind the preview banner.
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('adds the previewed board from the banner CTA and clears the banner', async () => {
    addBoard(7)
    renderWithRouter('/board/5/catalog')
    fireEvent.click(await screen.findByRole('button', { name: 'Add this board' }))
    await waitFor(() => expect(getAddedBoardIds()).toContain(5))
    expect(screen.queryByText('Add this board')).toBeNull()
  })
})

describe('settings route', () => {
  it('renders the Settings screen with the appearance toggle', async () => {
    renderWithRouter('/settings')
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument()
  })
})

describe('URL is the source of truth', () => {
  it('seeds the search field from ?q on a deep link', async () => {
    addBoard(7)
    renderWithRouter('/board/7/catalog?q=crimp')
    const field = await screen.findByRole('textbox', { name: 'Search problems' })
    expect(field).toHaveValue('crimp')
  })

  it('opens a deep-linked problem drawer', async () => {
    addBoard(7)
    renderWithRouter('/board/7/catalog?problem=b')
    // ProblemDetail renders the problem's name as a heading (uppercased via CSS).
    expect(await screen.findByRole('heading', { name: 'Bravo' })).toBeInTheDocument()
  })

  it('writes a filter change to the URL and through to the cold-launch seed', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')

    // Open the filter sheet and toggle Benchmarks.
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Benchmarks' }))

    await waitFor(() => expect(router.state.location.search).toMatchObject({ bench: 1 }))
    // Written through to the seed so a cold launch reproduces it.
    expect(loadSeed(7, 40).benchmarkOnly).toBe(true)
  })

  it('mirrors a deep-linked ?angle back into boardStore', async () => {
    addBoard(5) // board 5 supports [40, 25]
    renderWithRouter('/board/5/catalog?angle=25')
    await screen.findByText('Alpha')
    await waitFor(() => expect(getAngle(boardByLayoutId(5)!)).toBe(25))
  })
})

describe('search field <-> URL sync', () => {
  it('does not strand a half-typed query when switching boards mid-debounce', async () => {
    addBoard(7)
    renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')

    // Type without waiting for the 250ms debounce to write ?q.
    const field = screen.getByRole('textbox', { name: 'Search problems' })
    fireEvent.change(field, { target: { value: 'carafes' } })
    expect(field).toHaveValue('carafes')

    // Leave the catalog before the debounce fires, then come back. AppLayout is the
    // persistent root, so its field state survives — it must resync to the URL (empty
    // ?q) rather than showing a query the list isn't actually filtered by.
    fireEvent.click(screen.getByRole('button', { name: 'Logbook' }))
    await screen.findByRole('button', { name: 'Search' })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    const back = await screen.findByRole('textbox', { name: 'Search problems' })
    expect(back).toHaveValue('')
  })
})

describe('drawer history semantics', () => {
  it('Back closes a push-opened drawer without exiting the catalog', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')

    // Open a problem (push).
    fireEvent.click(screen.getByText('Bravo'))
    expect(await screen.findByRole('heading', { name: 'Bravo' })).toBeInTheDocument()
    expect(router.state.location.search).toMatchObject({ problem: 'b' })

    // Back closes the drawer (removes ?problem) and stays on the catalog.
    router.history.back()
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('problem'))
    expect(router.state.location.pathname).toBe('/board/7/catalog')
  })

  it('pages a cold deep-linked problem across the filtered list (no recents session)', async () => {
    addBoard(7)
    renderWithRouter('/board/7/catalog?problem=a')
    // No recents interaction → pagerStack is null → the pager domain is `displayed`.
    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next problem' }))
    expect(await screen.findByRole('heading', { name: 'Bravo' })).toBeInTheDocument()
  })

  it('pages with replace so a single Back returns to the catalog, not prior problems', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')

    // Open the first problem (push), then page forward twice (each a replace).
    fireEvent.click(screen.getByText('Alpha'))
    await screen.findByRole('heading', { name: 'Alpha' })
    fireEvent.click(screen.getByRole('button', { name: 'Next problem' }))
    expect(await screen.findByRole('heading', { name: 'Bravo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next problem' }))
    expect(await screen.findByRole('heading', { name: 'Charlie' })).toBeInTheDocument()

    // One Back skips the replaced pages and lands on the clean catalog entry.
    router.history.back()
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('problem'))
    expect(router.state.location.pathname).toBe('/board/7/catalog')
  })
})

describe('lists routes', () => {
  it('renders the lists index at /lists and marks the Lists tab current', async () => {
    renderWithRouter('/lists')
    expect(await screen.findByTestId('lists-screen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lists' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders the detail screen for a deep-linked /lists/$listId', async () => {
    renderWithRouter('/lists/abc')
    expect(await screen.findByTestId('list-detail-screen')).toBeInTheDocument()
    // Lists tab stays current on the detail sub-route.
    expect(screen.getByRole('button', { name: 'Lists' })).toHaveAttribute('aria-current', 'page')
  })

  it('routes /lists while signed out (the screen owns the sign-in prompt)', async () => {
    renderWithRouter('/lists')
    expect(await screen.findByTestId('lists-screen')).toBeInTheDocument()
  })
})

// ── Boards: the header name, the drawer, and the add / edit pages ────────────────

const session = (boardLayoutId: number): Session => ({
  id: 'S1',
  name: 'Crew',
  ownerId: 'me',
  boardLayoutId,
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
  expiresAt: '2026-07-21T00:00:00Z',
  deleted: false,
  litProblemId: null,
  litBy: null,
  litAt: null,
})

const tileNames = () =>
  boardsDrawer()
    .getAllByRole('button', { name: /^(Browse|Switch to) / })
    .map((t) => t.getAttribute('aria-label')!.replace(/^(Browse|Switch to) /, ''))

describe('header board name', () => {
  it('names the active board on every screen, add and edit pages included', async () => {
    addBoard(3)
    addBoard(7) // 3 stays active
    const { router } = renderWithRouter('/settings')
    await screen.findByRole('heading', { name: 'Settings' })
    expect(boardName()).toHaveTextContent('MoonBoard 2024')

    await act(() => router.navigate({ to: '/boards/add' }))
    await screen.findByRole('heading', { name: 'Which board?' })
    expect(boardName()).toHaveTextContent('MoonBoard 2024')

    // Editing another board: the header still names the active one.
    await act(() => router.navigate({ to: '/boards/$layoutId/edit', params: { layoutId: '7' } }))
    await screen.findByRole('heading', { name: 'Edit Mini MoonBoard 2025' })
    expect(boardName()).toHaveTextContent('MoonBoard 2024')
  })

  it('keeps naming the active board on the preview of a board that is not added', async () => {
    addBoard(7)
    renderWithRouter('/board/5/catalog')
    await screen.findByText('Add this board')
    expect(boardName()).toHaveTextContent('Mini MoonBoard 2025')
    expect(getActiveBoardId()).toBe(7)
    expect(getAddedBoardIds()).toEqual([7])
  })
})

describe('the catalog and the active board stay in step', () => {
  it('AE1: switching boards from the drawer on a non-catalog screen stays on that screen', async () => {
    addBoard(3)
    addBoard(7) // 3 active
    const { router } = renderWithRouter('/settings')
    await screen.findByRole('heading', { name: 'Settings' })
    await openBoardsDrawer()
    const before = tileNames()

    fireEvent.click(boardsDrawer().getByRole('button', { name: 'Switch to Mini MoonBoard 2025' }))

    expect(
      boardsDrawer().getByRole('button', { name: 'Browse Mini MoonBoard 2025' }),
    ).toHaveAttribute('aria-current', 'true')
    expect(boardName()).toHaveTextContent('Mini MoonBoard 2025')
    expect(tileNames()).toEqual(before)
    await waitFor(() => expect(router.state.status).toBe('idle'))
    expect(router.state.location.pathname).toBe('/settings')
    expect(screen.getByRole('dialog', { name: 'Boards' })).toBeInTheDocument()
  })

  it('AE2: switching boards from the drawer on a catalog swaps the catalog behind it', async () => {
    addBoard(3)
    addBoard(7) // 3 active
    const { router, history } = renderWithRouter('/board/3/catalog')
    await screen.findByText('Alpha')
    const entries = history.length
    await openBoardsDrawer()

    fireEvent.click(boardsDrawer().getByRole('button', { name: 'Switch to Mini MoonBoard 2025' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/board/7/catalog'))
    expect(history.length).toBe(entries) // the entry was swapped, none added
    expect(screen.getByRole('dialog', { name: 'Boards' })).toBeInTheDocument() // still open
    expect(getActiveBoardId()).toBe(7)
  })

  it('tapping the active tile closes the drawer and shows its catalog', async () => {
    addBoard(3)
    const { router } = renderWithRouter('/settings')
    await screen.findByRole('heading', { name: 'Settings' })
    await openBoardsDrawer()
    fireEvent.click(boardsDrawer().getByRole('button', { name: 'Browse MoonBoard 2024' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/board/3/catalog'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Boards' })).toBeNull())
  })

  it('a catalog URL for an added, inactive board makes that board active', async () => {
    addBoard(7)
    addBoard(5) // 7 active
    const { router } = renderWithRouter('/board/5/catalog?problem=b')
    await screen.findByRole('heading', { name: 'Bravo' })
    await waitFor(() => expect(getActiveBoardId()).toBe(5))
    expect(boardName()).toHaveTextContent('MoonBoard Masters 2019')
    // The link is left as it was: same board, same open problem.
    expect(router.state.location.pathname).toBe('/board/5/catalog')
    expect(router.state.location.search).toMatchObject({ problem: 'b' })
  })

  it('browser Back onto another board’s catalog makes that board active', async () => {
    addBoard(3)
    addBoard(7) // 3 active
    const { router } = renderWithRouter('/board/3/catalog')
    await screen.findByText('Alpha')
    await act(() => router.navigate(catalogNavTarget(boardByLayoutId(7)!)))
    await waitFor(() => expect(getActiveBoardId()).toBe(7))

    act(() => router.history.back())
    await waitFor(() => expect(router.state.location.pathname).toBe('/board/3/catalog'))
    await waitFor(() => expect(getActiveBoardId()).toBe(3))
    expect(boardName()).toHaveTextContent('MoonBoard 2024')
  })

  it('adding the previewed board as the first board keeps the URL’s search params', async () => {
    const { router } = renderWithRouter('/board/5/catalog?q=crimp&problem=b')
    // `hidden`: the open problem drawer hides the page behind it from assistive tech.
    fireEvent.click(await screen.findByRole('button', { name: 'Add this board', hidden: true }))
    await waitFor(() => expect(getActiveBoardId()).toBe(5))
    await waitFor(() => expect(boardName()).toHaveTextContent('MoonBoard Masters 2019'))
    await waitFor(() => expect(router.state.status).toBe('idle'))
    expect(router.state.location.pathname).toBe('/board/5/catalog')
    expect(router.state.location.search).toMatchObject({ q: 'crimp', problem: 'b' })
  })

  it('adding the previewed board beside another makes it active and keeps the params', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/board/5/catalog?q=crimp')
    fireEvent.click(await screen.findByRole('button', { name: 'Add this board' }))
    await waitFor(() => expect(getActiveBoardId()).toBe(5))
    await waitFor(() => expect(router.state.status).toBe('idle'))
    expect(router.state.location.pathname).toBe('/board/5/catalog')
    expect(router.state.location.search).toMatchObject({ q: 'crimp' })
  })

  it('resuming a session from another board’s catalog produces one navigation', async () => {
    addBoard(3)
    addBoard(7) // 3 active
    const { router, history } = renderWithRouter('/board/3/catalog')
    await screen.findByText('Alpha')
    const entries = history.length

    // What a resume does: activate the session's board and navigate to its catalog.
    act(() => navigateToSessionBoard(router.navigate, session(7)))

    await waitFor(() => expect(router.state.location.pathname).toBe('/board/7/catalog'))
    await waitFor(() => expect(router.state.status).toBe('idle'))
    expect(history.length).toBe(entries + 1) // exactly one new entry
    act(() => router.history.back())
    await waitFor(() => expect(router.state.location.pathname).toBe('/board/3/catalog'))
  })

  it('removing the active board while on its catalog moves to the next board’s catalog', async () => {
    addBoard(7)
    addBoard(3)
    activateBoard(3)
    const { router, history } = renderWithRouter('/board/3/catalog')
    await screen.findByText('Alpha')
    const entries = history.length

    act(() => removeBoard(3)) // as another tab would

    await waitFor(() => expect(router.state.location.pathname).toBe('/board/7/catalog'))
    expect(history.length).toBe(entries)
    expect(boardName()).toHaveTextContent('Mini MoonBoard 2025')
  })

  it('switching boards while previewing an un-added board moves to the new active board', async () => {
    addBoard(3)
    addBoard(7) // 3 active
    const { router } = renderWithRouter('/board/5/catalog')
    await screen.findByText('Add this board')
    expect(getActiveBoardId()).toBe(3) // showing a preview activates nothing

    act(() => activateBoard(7))

    await waitFor(() => expect(router.state.location.pathname).toBe('/board/7/catalog'))
    expect(getAddedBoardIds()).not.toContain(5)
  })

  it('starts the catalog screen fresh when the board changes in place', async () => {
    addBoard(3)
    addBoard(7) // 3 active
    renderWithRouter('/board/3/catalog')
    await screen.findByText('Alpha')
    // Screen-local state: the open filter sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await screen.findByRole('dialog')

    act(() => activateBoard(7))

    // A remount drops it; a reused screen would carry it (and the old slab) over.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('does not navigate when the active board changes off the catalog', async () => {
    addBoard(3)
    addBoard(7)
    const { router } = renderWithRouter('/settings')
    await screen.findByRole('heading', { name: 'Settings' })
    act(() => activateBoard(7))
    await waitFor(() => expect(router.state.status).toBe('idle'))
    expect(router.state.location.pathname).toBe('/settings')
  })
})

describe('adding a board', () => {
  it('adds a board end to end and lands on its catalog', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/boards/add')
    fireEvent.click((await screen.findByText('MoonBoard Masters 2019')).closest('button')!)
    expect(await screen.findByRole('heading', { name: 'How is it set up?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards/add/5')

    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hold Set A' }))
    expect(screen.getByText('25° · 5 of 6 hold sets')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add board' }))

    await screen.findByText('Alpha')
    expect(router.state.location.pathname).toBe('/board/5/catalog')
    expect(router.state.location.search).toMatchObject({ angle: 25 })
    expect(getAddedBoardIds()).toEqual([5, 7])
    expect(getActiveBoardId()).toBe(5)
    expect(getAngle(boardByLayoutId(5)!)).toBe(25)
    expect(getActiveHoldSetsRaw(5)).toBe('18|19|21|22|23')
    expect(boardName()).toHaveTextContent('MoonBoard Masters 2019')
    // The docked bar belongs to step 2 only.
    expect(screen.queryByRole('button', { name: 'Add board' })).toBeNull()

    // Back from the catalog does not re-enter the finished step 2.
    act(() => router.history.back())
    await waitFor(() => expect(router.state.location.pathname).toBe('/boards/add'))
  })

  it('AE3: tapping an added board in step 1 opens its edit page, adding no second copy', async () => {
    addBoard(3)
    const { router } = renderWithRouter('/boards/add')
    fireEvent.click((await screen.findByText('You have this one')).closest('button')!)
    expect(await screen.findByRole('heading', { name: 'Edit MoonBoard 2024' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards/3/edit')
    expect(getAddedBoardIds()).toEqual([3])
  })

  it('AE4: going back from step 2 returns to step 1 and adds nothing', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/boards/add')
    fireEvent.click((await screen.findByText('MoonBoard Masters 2019')).closest('button')!)
    await screen.findByRole('heading', { name: 'How is it set up?' })
    fireEvent.click(screen.getByRole('button', { name: '25°' }))

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Which board?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards/add')

    await openBoardsDrawer()
    expect(tileNames()).toEqual(['Mini MoonBoard 2025'])
    expect(getAddedBoardIds()).toEqual([7])
    expect(getAngle(boardByLayoutId(5)!)).toBe(40)
  })

  it('redirects an unknown layout id in the step-2 URL to step 1', async () => {
    const { router } = renderWithRouter('/boards/add/999')
    expect(await screen.findByRole('heading', { name: 'Which board?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards/add')
  })

  it('redirects step 2 for an already-added board to its edit page', async () => {
    addBoard(3)
    const { router } = renderWithRouter('/boards/add/3')
    expect(await screen.findByRole('heading', { name: 'Edit MoonBoard 2024' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards/3/edit')
  })

  it('AE6: with every registry board added the drawer has no add tile', async () => {
    for (const b of BOARDS) addBoard(b.layoutId)
    renderWithRouter('/settings')
    await screen.findByRole('heading', { name: 'Settings' })
    await openBoardsDrawer()
    expect(tileNames()).toHaveLength(6)
    expect(boardsDrawer().queryByRole('button', { name: 'Add a board' })).toBeNull()
  })
})

describe('editing and removing a board', () => {
  it('redirects the edit page of a board that is not added to its add step', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/boards/5/edit')
    expect(await screen.findByRole('heading', { name: 'How is it set up?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards/add/5')
  })

  it('redirects the edit page of an unknown board to step 1', async () => {
    const { router } = renderWithRouter('/boards/999/edit')
    expect(await screen.findByRole('heading', { name: 'Which board?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards/add')
  })

  it('AE7: an angle set on the edit page survives browser Back onto the catalog', async () => {
    addBoard(3) // MoonBoard 2024: 40° and 25°
    const { router } = renderWithRouter('/board/3/catalog')
    await screen.findByText('Alpha')
    expect(getAngle(boardByLayoutId(3)!)).toBe(40)

    await openBoardsDrawer()
    fireEvent.click(boardsDrawer().getByRole('button', { name: 'Edit MoonBoard 2024' }))
    await screen.findByRole('heading', { name: 'Edit MoonBoard 2024' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Boards' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    expect(getAngle(boardByLayoutId(3)!)).toBe(25)

    act(() => router.history.back()) // onto the catalog entry that still says 40°
    await waitFor(() => expect(router.state.location.pathname).toBe('/board/3/catalog'))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ angle: 25 }))
    expect(getAngle(boardByLayoutId(3)!)).toBe(25)
  })

  it('an angle set on the edit page survives Back past several older catalog entries', async () => {
    addBoard(3)
    const { router } = renderWithRouter('/board/3/catalog')
    await screen.findByText('Alpha')
    // A second catalog entry for the same board, both at 40°.
    await act(() => router.navigate({ to: '/settings' }))
    await screen.findByRole('heading', { name: 'Settings' })
    await act(() => router.navigate(catalogNavTarget(boardByLayoutId(3)!)))
    await screen.findByText('Alpha')

    await act(() => router.navigate({ to: '/boards/$layoutId/edit', params: { layoutId: '3' } }))
    fireEvent.click(await screen.findByRole('button', { name: '25°' }))

    act(() => router.history.back()) // newest catalog entry
    await waitFor(() => expect(router.state.location.search).toMatchObject({ angle: 25 }))
    act(() => router.history.back()) // settings
    await screen.findByRole('heading', { name: 'Settings' })
    act(() => router.history.back()) // oldest catalog entry, still 40° in its URL
    await waitFor(() => expect(router.state.location.pathname).toBe('/board/3/catalog'))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ angle: 25 }))
    expect(getAngle(boardByLayoutId(3)!)).toBe(25)
  })

  it('an edit back to the default angle survives Back onto an entry with the old angle', async () => {
    addBoard(3)
    setAngle(3, 25)
    const { router } = renderWithRouter('/board/3/catalog?angle=25')
    await screen.findByText('Alpha')

    await act(() => router.navigate({ to: '/boards/$layoutId/edit', params: { layoutId: '3' } }))
    fireEvent.click(await screen.findByRole('button', { name: '40°' }))

    act(() => router.history.back())
    await waitFor(() => expect(router.state.location.pathname).toBe('/board/3/catalog'))
    // 40° is the default, which the URL leaves out.
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('angle'))
    expect(getAngle(boardByLayoutId(3)!)).toBe(40)
  })

  it('a deep-linked ?angle still wins when the angle was not just edited', async () => {
    addBoard(3)
    setAngle(3, 25)
    const { router } = renderWithRouter('/board/3/catalog?angle=40')
    await screen.findByText('Alpha')
    await waitFor(() => expect(getAngle(boardByLayoutId(3)!)).toBe(40))
    expect(router.state.location.pathname).toBe('/board/3/catalog')
  })

  it('removing one of two boards lands on the other board’s catalog', async () => {
    addBoard(7)
    addBoard(5) // 7 active
    const { router } = renderWithRouter('/boards/5/edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove board' }))
    await screen.findByText('Alpha')
    expect(router.state.location.pathname).toBe('/board/7/catalog')
    expect(getAddedBoardIds()).toEqual([7])
  })

  it('AE5: removing the last board shows the first-run page', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/boards/7/edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove board' }))
    expect(await screen.findByText('Add your first board')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/boards')
    expect(getAddedBoardIds()).toEqual([])
    expect(screen.queryByRole('button', { name: /, boards$/ })).toBeNull()
  })

  it('the remove confirm resets when the page is opened again', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/boards/7/edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove board' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    await act(() => router.navigate({ to: '/settings' }))
    await screen.findByRole('heading', { name: 'Settings' })
    await act(() => router.navigate({ to: '/boards/$layoutId/edit', params: { layoutId: '7' } }))
    await screen.findByRole('heading', { name: 'Edit Mini MoonBoard 2025' })
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(getAddedBoardIds()).toEqual([7])
  })
})
