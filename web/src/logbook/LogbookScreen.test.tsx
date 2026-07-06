import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogbookScreen } from './LogbookScreen'

// LogbookScreen leans on three stores/hooks. We mock them so each test can pin a
// precise state (signed in?, boards added?, ascents present?) and assert what renders.
const authState = { status: 'signedIn' as string, isRestoring: false }
const boardState = { addedBoards: [] as unknown[], activeBoard: { layoutId: 7, name: 'Mini MoonBoard 2025' } }
const ascentsState = { status: 'loaded' as string, ascents: [] as unknown[], error: null as string | null }
const navigate = vi.fn()

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState,
}))
vi.mock('../board/boardStore', () => ({
  useBoardStore: () => boardState,
}))
vi.mock('./ascents', () => ({
  useAscents: () => ascentsState,
  loadAscents: vi.fn(),
  resetAscents: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

afterEach(() => {
  authState.status = 'signedIn'
  authState.isRestoring = false
  boardState.addedBoards = []
  ascentsState.ascents = []
  navigate.mockReset()
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

  it('shows the board name once a board is added', () => {
    boardState.addedBoards = [{ layoutId: 7, name: 'Mini MoonBoard 2025' }]
    render(<LogbookScreen />)

    expect(screen.queryByText('Add a board to start your logbook')).toBeNull()
    expect(screen.getByText('Mini MoonBoard 2025')).toBeInTheDocument()
  })
})
