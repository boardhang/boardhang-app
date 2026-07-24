import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { LogbookScreen } from './LogbookScreen'
import type { CatalogProblem } from '../catalog/catalogSync'
import { setShowPreviews } from '../catalog/previewsStore'
import { boardByLayoutId } from '../board/boards'

// LogbookScreen leans on several stores/hooks. We mock them so each test can pin a
// precise state (signed in?, boards added?, ascents present?) and assert what renders.
const authState = { status: 'signedIn' as string, isRestoring: false }
const boardState = { addedBoards: [] as unknown[], activeBoard: { layoutId: 7, name: 'Mini MoonBoard 2025' } }
const ascentsState = { status: 'loaded' as string, ascents: [] as unknown[], error: null as string | null }
const back = vi.fn()
const search = { problem: '' as string }
// The mock navigate applies the search reducer to `search` so pushing ?problem actually
// opens the drawer on the next render (a re-render is triggered by the sessionStack state
// update in openProblem).
type NavOpts = {
  to?: string
  replace?: boolean
  search?: (p: { problem: string }) => { problem?: string }
}
const navigate = vi.fn((opts?: NavOpts) => {
  if (opts && typeof opts.search === 'function') {
    search.problem = opts.search({ problem: search.problem }).problem ?? ''
  }
})
// The catalog entries getCatalogProblemsByIds resolves for the current ascents.
let catalogMap = new Map<string, CatalogProblem>()

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState,
}))
vi.mock('../board/boardStore', () => ({
  useBoardStore: () => boardState,
}))
vi.mock('./ascents', () => ({
  useAscents: () => ascentsState,
  useEnsureAscentsLoaded: () => ascentsState,
  loadAscents: vi.fn(),
  resetAscents: vi.fn(),
}))
vi.mock('../catalog/favoritesStore', () => ({
  useFavorites: () => ({ favoriteIds: new Set<string>() }),
}))
// Stub ProblemDetail so we can assert the pager domain (`displayed`) it receives and drive
// its onNavigate (prev/next paging) without rendering the full board / pager UI.
vi.mock('../catalog/ProblemDetail', () => ({
  ProblemDetail: ({
    displayed,
    onNavigate,
  }: {
    displayed: CatalogProblem[]
    onNavigate: (id: string) => void
  }) => (
    <div data-testid="detail" data-ids={displayed.map((p) => p.source_catalog_id).join(',')}>
      <button
        type="button"
        data-testid="pager-next"
        onClick={() => onNavigate(displayed[1]?.source_catalog_id ?? '')}
      >
        next
      </button>
    </div>
  ),
}))
// Stub the Drawer so a controlled close (onOpenChange(false)) is drivable in jsdom — the
// real base-ui Drawer only fires it on swipe/backdrop/Esc, which jsdom can't simulate.
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: ReactNode
  }) =>
    open ? (
      <div data-testid="drawer">
        <button type="button" data-testid="drawer-close" onClick={() => onOpenChange(false)}>
          close
        </button>
        {children}
      </div>
    ) : null,
  DrawerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('../catalog/catalogSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../catalog/catalogSync')>()
  return { ...actual, getCatalogProblemsByIds: vi.fn(async () => catalogMap) }
})
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ history: { back } }),
  getRouteApi: () => ({
    useSearch: () => search,
    useNavigate: () => navigate,
  }),
  // The import banner renders a <Link>; stub it as a plain anchor for jsdom.
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

afterEach(() => {
  authState.status = 'signedIn'
  authState.isRestoring = false
  boardState.addedBoards = []
  boardState.activeBoard = { layoutId: 7, name: 'Mini MoonBoard 2025' }
  ascentsState.status = 'loaded'
  ascentsState.ascents = []
  ascentsState.error = null
  search.problem = ''
  catalogMap = new Map()
  navigate.mockClear() // clear calls but keep the search-applying implementation
  back.mockReset()
  localStorage.clear() // reset the import-banner dismissal between tests
  // Reset the previews snapshot (survives localStorage.clear()).
  window.dispatchEvent(new StorageEvent('storage'))
})

describe('LogbookScreen — no board added', () => {
  it('shows the add-a-board empty state instead of any board name', () => {
    boardState.addedBoards = []
    render(<LogbookScreen />)

    expect(screen.getByText('Add a board to start your logbook')).toBeInTheDocument()
    // The phantom default board name must NOT leak into the header.
    expect(screen.queryByText('Mini MoonBoard 2025')).toBeNull()
  })

  it('routes to /boards from the CTA', () => {
    boardState.addedBoards = []
    render(<LogbookScreen />)

    fireEvent.click(screen.getByRole('button', { name: 'Add a board' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/boards' })
  })

  it('the guard beats cloud ascents on the default board', () => {
    // A signed-in user can have cloud ascents on the default board (7) without
    // having added it here. The empty state must still win.
    boardState.addedBoards = []
    ascentsState.ascents = [
      { id: '1', boardLayoutId: 7, sent: true, sourceCatalogId: null, date: '2026-07-01' },
    ]
    render(<LogbookScreen />)

    expect(screen.getByText('Add a board to start your logbook')).toBeInTheDocument()
  })

  it('shows the board name once the active board is added', () => {
    boardState.addedBoards = [{ layoutId: 7, name: 'Mini MoonBoard 2025' }]
    render(<LogbookScreen />)

    expect(screen.queryByText('Add a board to start your logbook')).toBeNull()
    expect(screen.getByText('Mini MoonBoard 2025')).toBeInTheDocument()
  })

  it('still gates when a board is added but the active board is the phantom default', () => {
    // Adding a board doesn't activate it, so `activeBoard` can stay the store's
    // default (Mini 2025) while the added board is something else. The logbook must
    // gate on membership, not count — otherwise the default board leaks right back in.
    boardState.addedBoards = [{ layoutId: 1, name: 'MoonBoard Masters 2019' }]
    boardState.activeBoard = { layoutId: 7, name: 'Mini MoonBoard 2025' }
    render(<LogbookScreen />)

    expect(screen.getByText('Add a board to start your logbook')).toBeInTheDocument()
    expect(screen.queryByText('Mini MoonBoard 2025')).toBeNull()
  })

  it('shows the sign-in panel — not the add-a-board state — when signed out', () => {
    // The signed-out guard runs ahead of the no-board guard; ordering is load-bearing.
    authState.status = 'signedOut'
    boardState.addedBoards = []
    render(<LogbookScreen />)

    expect(screen.getByText('Sign in to see your logbook')).toBeInTheDocument()
    expect(screen.queryByText('Add a board to start your logbook')).toBeNull()
  })
})

describe('LogbookScreen — import-from-MoonBoard affordance', () => {
  const addedBoard = { layoutId: 7, name: 'Mini MoonBoard 2025' }

  it('offers Import from MoonBoard in the empty logbook and routes to /logbook/import', () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = []
    render(<LogbookScreen />)

    expect(screen.getByText('No logged ascents yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import from MoonBoard' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/logbook/import' })
  })

  it('offers the import affordance when nothing is logged on the active board', () => {
    boardState.addedBoards = [addedBoard]
    // Ascents exist, but on a different board → the active board's list is empty.
    ascentsState.ascents = [
      { id: 'x', boardLayoutId: 1, sent: true, sourceCatalogId: null, date: '2026-07-01' },
    ]
    render(<LogbookScreen />)

    expect(screen.getByText('No ascents on Mini MoonBoard 2025')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import from MoonBoard' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/logbook/import' })
  })

  const populatedAscent = {
    id: 'a1',
    date: '2026-07-01',
    boardLayoutId: 7,
    problemName: 'CRIMP CITY',
    problemGrade: '6A',
    votedGrade: '6A',
    tries: 1,
    stars: 0,
    comment: '',
    sent: false,
    sourceCatalogId: null,
    userProblemId: null,
  }

  it('shows a dismissable import banner in the populated logbook, linking to /logbook/import', () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [populatedAscent]
    render(<LogbookScreen />)

    expect(screen.getByText('CRIMP CITY')).toBeInTheDocument()
    const banner = screen.getByRole('region', { name: 'Import from MoonBoard' })
    expect(banner).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute('href', '/logbook/import')
  })

  it('hides the import banner once dismissed and remembers it', () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [populatedAscent]
    const first = render(<LogbookScreen />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss import banner' }))
    expect(screen.queryByRole('region', { name: 'Import from MoonBoard' })).toBeNull()

    // Dismissal persists (localStorage) — a fresh mount keeps the banner hidden.
    first.unmount()
    render(<LogbookScreen />)
    expect(screen.queryByRole('region', { name: 'Import from MoonBoard' })).toBeNull()
  })
})

describe('LogbookScreen — row tap-through to problem detail', () => {
  const addedBoard = { layoutId: 7, name: 'Mini MoonBoard 2025' }
  const baseAscent = {
    id: 'a1',
    date: '2026-07-01',
    boardLayoutId: 7,
    problemName: 'CRIMP CITY',
    problemGrade: '6A',
    votedGrade: '6A',
    tries: 1,
    stars: 0,
    comment: '',
    sent: false,
    sourceCatalogId: null as string | null,
    userProblemId: null as string | null,
  }

  it('opens the drawer via ?problem when a resolvable row is tapped', async () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [{ ...baseAscent, sourceCatalogId: 'p-1' }]
    // Resolvable: the catalog entry is cached (holds omitted so no board thumbnail
    // renders — keeps the test off CatalogBoard's geometry).
    catalogMap = new Map([['p-1', { source_catalog_id: 'p-1', angle: 40 } as CatalogProblem]])

    render(<LogbookScreen />)

    const row = await screen.findByRole('button', { name: 'Open CRIMP CITY' })
    fireEvent.click(row)

    // Pushes ?problem=p-1 via the search reducer (not a `to`/replace navigation).
    expect(navigate).toHaveBeenCalledTimes(1)
    const arg = navigate.mock.calls[0][0] as { search: (p: { problem: string }) => unknown; replace?: boolean }
    expect(arg.replace).toBeUndefined()
    expect(arg.search({ problem: '' })).toEqual({ problem: 'p-1' })
  })

  it('hides row thumbnails when the logbook previews toggle is off', async () => {
    boardState.addedBoards = [addedBoard]
    // A real board object so CatalogBoard's geometry can render the thumbnail.
    boardState.activeBoard = boardByLayoutId(7)!
    ascentsState.ascents = [{ ...baseAscent, sourceCatalogId: 'p-1' }]
    // Holds present → AscentRow draws the board thumbnail while the toggle is on.
    catalogMap = new Map([
      ['p-1', { source_catalog_id: 'p-1', angle: 40, holds: [{ c: 0, r: 1, t: 'start' }] } as CatalogProblem],
    ])

    const { container } = render(<LogbookScreen />)

    await screen.findByRole('button', { name: 'Open CRIMP CITY' })
    expect(container.querySelector('.catalog-board')).not.toBeNull()
    act(() => setShowPreviews('logbook', false))
    expect(container.querySelector('.catalog-board')).toBeNull()
  })

  it('does not make a user-created (unresolved) row tappable', () => {
    boardState.addedBoards = [addedBoard]
    // sourceCatalogId null → no catalog entry → not tappable, but still shown + editable.
    ascentsState.ascents = [{ ...baseAscent, sourceCatalogId: null }]

    render(<LogbookScreen />)

    expect(screen.queryByRole('button', { name: 'Open CRIMP CITY' })).toBeNull()
    expect(screen.getByText('CRIMP CITY')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit log for CRIMP CITY' })).toBeInTheDocument()
  })

  it('scopes the pager to the tapped row’s day-session, deduped', async () => {
    boardState.addedBoards = [addedBoard]
    // Two sessions: Mon (1 problem) and Fri (3 problems, one logged twice → deduped).
    ascentsState.ascents = [
      { ...baseAscent, id: 'm1', date: '2026-07-06', problemName: 'STRETCHY PANTS', sourceCatalogId: 'p-mon' },
      { ...baseAscent, id: 'f1', date: '2026-07-03', problemName: 'ULTIMATE', sourceCatalogId: 'p-1' },
      { ...baseAscent, id: 'f2', date: '2026-07-03', problemName: 'WILLOW', sourceCatalogId: 'p-2' },
      { ...baseAscent, id: 'f3', date: '2026-07-03', problemName: 'NICE TRY', sourceCatalogId: 'p-3' },
      { ...baseAscent, id: 'f4', date: '2026-07-03', problemName: 'ULTIMATE (again)', sourceCatalogId: 'p-1' },
    ]
    catalogMap = new Map(
      ['p-mon', 'p-1', 'p-2', 'p-3'].map((id) => [id, { source_catalog_id: id, angle: 40 } as CatalogProblem]),
    )

    render(<LogbookScreen />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open ULTIMATE' }))

    // Fri session only, in on-screen order, deduped (p-1 once) — not Mon's p-mon.
    const detail = await screen.findByTestId('detail')
    expect(detail.getAttribute('data-ids')).toBe('p-1,p-2,p-3')
  })

  it('gives a single-problem day no pager domain', async () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [
      { ...baseAscent, id: 'm1', date: '2026-07-06', problemName: 'STRETCHY PANTS', sourceCatalogId: 'p-mon' },
    ]
    catalogMap = new Map([['p-mon', { source_catalog_id: 'p-mon', angle: 40 } as CatalogProblem]])

    render(<LogbookScreen />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open STRETCHY PANTS' }))

    const detail = await screen.findByTestId('detail')
    expect(detail.getAttribute('data-ids')).toBe('p-mon')
  })

  it('closes a tap-opened drawer with Back (stays on the tab)', async () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [{ ...baseAscent, sourceCatalogId: 'p-1' }]
    catalogMap = new Map([['p-1', { source_catalog_id: 'p-1', angle: 40 } as CatalogProblem]])

    render(<LogbookScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open CRIMP CITY' }))

    // Push-opened → closing pops history (Back) rather than clearing the param in place.
    fireEvent.click(await screen.findByTestId('drawer-close'))
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('closes a cold deep-linked drawer by clearing ?problem in place', async () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [{ ...baseAscent, sourceCatalogId: 'p-1' }]
    catalogMap = new Map([['p-1', { source_catalog_id: 'p-1', angle: 40 } as CatalogProblem]])
    // Deep-link: ?problem set on first render, no tap → `pushed` stays false.
    search.problem = 'p-1'

    render(<LogbookScreen />)
    fireEvent.click(await screen.findByTestId('drawer-close'))

    // No history pop; instead ?problem is replaced back to '' (strip middleware removes it).
    expect(back).not.toHaveBeenCalled()
    const replaceCall = navigate.mock.calls.find((c) => (c[0] as NavOpts | undefined)?.replace)
    expect(replaceCall).toBeTruthy()
    expect((replaceCall![0] as NavOpts).search!({ problem: 'p-1' })).toEqual({ problem: '' })
  })

  it('pages within the session via replace navigation, keeping the domain', async () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [
      { ...baseAscent, id: 'f1', date: '2026-07-03', problemName: 'ULTIMATE', sourceCatalogId: 'p-1' },
      { ...baseAscent, id: 'f2', date: '2026-07-03', problemName: 'WILLOW', sourceCatalogId: 'p-2' },
    ]
    catalogMap = new Map(
      ['p-1', 'p-2'].map((id) => [id, { source_catalog_id: id, angle: 40 } as CatalogProblem]),
    )

    render(<LogbookScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open ULTIMATE' }))
    expect((await screen.findByTestId('detail')).getAttribute('data-ids')).toBe('p-1,p-2')

    // Next → replace-navigate to p-2 (no new history push); pager domain unchanged.
    fireEvent.click(screen.getByTestId('pager-next'))
    const replaceCall = navigate.mock.calls.find((c) => (c[0] as NavOpts | undefined)?.replace)
    expect((replaceCall![0] as NavOpts).search!({ problem: 'p-1' })).toEqual({ problem: 'p-2' })
    expect((await screen.findByTestId('detail')).getAttribute('data-ids')).toBe('p-1,p-2')
  })
})

describe('LogbookScreen — filters', () => {
  const addedBoard = { layoutId: 7, name: 'Mini MoonBoard 2025' }
  const baseAscent = {
    id: 'a1',
    date: '2026-07-01T10:00:00',
    boardLayoutId: 7,
    problemName: 'CRIMP CITY',
    problemGrade: '6A',
    votedGrade: '6A',
    tries: 1,
    stars: 0,
    comment: '',
    sent: false,
    sourceCatalogId: null as string | null,
    userProblemId: null as string | null,
  }

  function openFilterSheet() {
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
  }

  it('narrows the sessions to a picked date span and removes it via the chip', async () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [
      { ...baseAscent, id: 'j1', date: '2026-07-01T10:00:00', problemName: 'EARLY PROB' },
      { ...baseAscent, id: 'j6', date: '2026-07-06T10:00:00', problemName: 'LATE PROB' },
    ]
    render(<LogbookScreen />)

    expect(screen.getByText('EARLY PROB')).toBeInTheDocument()
    expect(screen.getByText('LATE PROB')).toBeInTheDocument()

    // Pick Jul 1 → Jul 3 in the sheet's inline calendar (today is 2026-07-24).
    openFilterSheet()
    fireEvent.click(await screen.findByRole('button', { name: /July 1st/ }))
    fireEvent.click(screen.getByRole('button', { name: /July 3rd/ }))

    expect(screen.getByText('EARLY PROB')).toBeInTheDocument()
    expect(screen.queryByText('LATE PROB')).toBeNull()

    // The active filter surfaces as a removable chip; tapping it clears the span.
    fireEvent.click(screen.getByRole('button', { name: /Remove .* filter/ }))
    expect(screen.getByText('LATE PROB')).toBeInTheDocument()
  })

  it('shows an empty state when the picked span has no ascents', async () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [{ ...baseAscent, id: 'j1', problemName: 'EARLY PROB' }]
    render(<LogbookScreen />)

    openFilterSheet()
    fireEvent.click(await screen.findByRole('button', { name: /July 10th/ }))
    fireEvent.click(screen.getByRole('button', { name: /July 12th/ }))

    expect(screen.queryByText('EARLY PROB')).toBeNull()
    expect(screen.getByText('No ascents match your filters')).toBeInTheDocument()
  })

  it('shows the grade slider spanning the logged grades', () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [
      { ...baseAscent, id: 'g1', problemGrade: '6A' },
      { ...baseAscent, id: 'g2', problemGrade: '7A', problemName: 'HARD ONE' },
    ]
    render(<LogbookScreen />)

    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
    openFilterSheet()
    expect(screen.getByText('Grade · 6A – 7A')).toBeInTheDocument()
  })

  it('hides the grade slider when only one grade is logged', () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [{ ...baseAscent, id: 'g1', problemGrade: '6A' }]
    render(<LogbookScreen />)

    openFilterSheet()
    expect(screen.queryByText(/Grade ·/)).toBeNull()
  })

  it('Clear filters in the sheet resets everything', async () => {
    boardState.addedBoards = [addedBoard]
    ascentsState.ascents = [
      { ...baseAscent, id: 'j1', date: '2026-07-01T10:00:00', problemName: 'EARLY PROB' },
      { ...baseAscent, id: 'j6', date: '2026-07-06T10:00:00', problemName: 'LATE PROB' },
    ]
    render(<LogbookScreen />)

    openFilterSheet()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /July 1st/ }))
    fireEvent.click(screen.getByRole('button', { name: /July 3rd/ }))
    expect(screen.queryByText('LATE PROB')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('LATE PROB')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })
})
