import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogbookScreen } from './LogbookScreen'
import type { CatalogProblem } from '../catalog/catalogSync'

// LogbookScreen leans on several stores/hooks. We mock them so each test can pin a
// precise state (signed in?, boards added?, ascents present?) and assert what renders.
const authState = { status: 'signedIn' as string, isRestoring: false }
const boardState = { addedBoards: [] as unknown[], activeBoard: { layoutId: 7, name: 'Mini MoonBoard 2025' } }
const ascentsState = { status: 'loaded' as string, ascents: [] as unknown[], error: null as string | null }
const navigate = vi.fn()
const back = vi.fn()
const search = { problem: '' as string }
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
  navigate.mockReset()
  back.mockReset()
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

  it('does not make a user-created (unresolved) row tappable', () => {
    boardState.addedBoards = [addedBoard]
    // sourceCatalogId null → no catalog entry → not tappable, but still shown + editable.
    ascentsState.ascents = [{ ...baseAscent, sourceCatalogId: null }]

    render(<LogbookScreen />)

    expect(screen.queryByRole('button', { name: 'Open CRIMP CITY' })).toBeNull()
    expect(screen.getByText('CRIMP CITY')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit log for CRIMP CITY' })).toBeInTheDocument()
  })
})
