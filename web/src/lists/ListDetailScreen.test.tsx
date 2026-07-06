import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '../test/renderWithRouter'
import type { CatalogProblem } from '../catalog/catalogSync'
import type { ListsState } from './listsStore'
import type { ListProblemsState } from './useListProblems'
import type { SavedList, SavedListProblem } from './listsTypes'

const authState = {
  status: 'signedInWithProfile' as string,
  profile: null,
  isRestoring: false,
  isConfigured: true,
  signOut: vi.fn(),
  deleteAccount: vi.fn(),
  sendEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
  signInWithGoogle: vi.fn(),
  isHandleAvailable: vi.fn(),
  saveProfile: vi.fn(),
}
vi.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => authState,
}))

vi.mock('../ble/useBle', () => ({
  useBle: vi.fn(() => ({ state: 'disconnected', deviceName: null, error: null })),
  connectBoard: vi.fn(),
  isConnected: vi.fn(() => false),
  setBleError: vi.fn(),
  bleClient: { send: vi.fn(), state: 'disconnected' },
}))

let storeState: ListsState = { status: 'loaded', lists: [], error: null }
const removeProblem = vi.fn().mockResolvedValue(undefined)
const addProblem = vi.fn().mockResolvedValue(undefined)
vi.mock('./listsStore', () => ({
  useSavedLists: () => storeState,
  loadLists: vi.fn().mockResolvedValue(undefined),
  removeProblem: (...a: unknown[]) => removeProblem(...a),
  addProblem: (...a: unknown[]) => addProblem(...a),
}))

let problemsState: ListProblemsState = { problems: [], loading: false, degraded: false }
vi.mock('./useListProblems', () => ({
  useListProblems: () => problemsState,
}))

// Ascents feed the sent check. Keep the real module (ProblemDetail uses addAttemptTries)
// but inject a configurable ascents list via the hook.
let ascentsList: Array<{ sent: boolean; boardLayoutId: number; sourceCatalogId: string | null }> = []
vi.mock('../logbook/ascents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logbook/ascents')>()
  return { ...actual, useEnsureAscentsLoaded: () => ({ ascents: ascentsList, status: 'loaded' }) }
})

const catalogById = vi.fn<(ids: string[]) => Promise<Map<string, CatalogProblem>>>()
vi.mock('../catalog/catalogSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../catalog/catalogSync')>()
  return { ...actual, getCatalogProblemsByIds: (ids: string[]) => catalogById(ids) }
})

function saved(id: string, catId: string): SavedListProblem {
  return {
    id,
    listId: 'list-1',
    sourceCatalogId: catId,
    boardLayoutId: 5,
    addedBy: 'user-A',
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    deleted: false,
  }
}

function catalog(catId: string, name: string, angle: number): CatalogProblem {
  return {
    source_catalog_id: catId,
    layout_id: 5,
    angle,
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

function listWithBoard(id: string, name: string): SavedList {
  return {
    id,
    ownerId: 'user-A',
    name,
    boardLayoutId: 5, // MoonBoard Masters 2019 — two angles (40, 25).
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    deleted: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.status = 'signedInWithProfile'
  storeState = { status: 'loaded', lists: [listWithBoard('list-1', 'Projects')], error: null }
  problemsState = {
    problems: [saved('lp1', 'c40'), saved('lp2', 'c25')],
    loading: false,
    degraded: false,
  }
  ascentsList = []
  catalogById.mockResolvedValue(
    new Map([
      ['c40', catalog('c40', 'Forty', 40)],
      ['c25', catalog('c25', 'Twentyfive', 25)],
    ]),
  )
})

describe('ListDetailScreen', () => {
  it('renders the list name, board label, and its problems', async () => {
    renderWithRouter('/lists/list-1')
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByText('Masters 2019')).toBeInTheDocument()
    expect(await screen.findByText('Forty')).toBeInTheDocument()
    expect(screen.getByText('Twentyfive')).toBeInTheDocument()
  })

  it('the angle filter narrows the shown problems; All shows every angle', async () => {
    renderWithRouter('/lists/list-1')
    await screen.findByText('Forty')

    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    expect(screen.queryByText('Forty')).toBeNull()
    expect(screen.getByText('Twentyfive')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(await screen.findByText('Forty')).toBeInTheDocument()
  })

  it('with an angle filter active, the pager stays within the filtered subset', async () => {
    renderWithRouter('/lists/list-1')
    await screen.findByText('Twentyfive')

    // Filter to a single-problem subset, then open it: prev/next have nowhere to go.
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    fireEvent.click(screen.getByText('Twentyfive'))

    expect(await screen.findByRole('heading', { name: 'Twentyfive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next problem' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous problem' })).toBeDisabled()
  })

  it('shows the sent check on rows with a logged send for this board', async () => {
    ascentsList = [{ sent: true, boardLayoutId: 5, sourceCatalogId: 'c40' }]
    renderWithRouter('/lists/list-1')
    await screen.findByText('Forty')
    // c40 has a send on board 5 → its row shows the "Sent" check; c25 does not.
    const sent = screen.getAllByRole('img', { name: 'Sent' })
    expect(sent).toHaveLength(1)
  })

  it('remove calls removeProblem for that problem', async () => {
    renderWithRouter('/lists/list-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Forty' }))
    await waitFor(() => expect(removeProblem).toHaveBeenCalledWith('list-1', 'c40'))
  })

  it('offers an Undo toast that revives the removed problem', async () => {
    renderWithRouter('/lists/list-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Forty' }))
    await waitFor(() => expect(removeProblem).toHaveBeenCalledWith('list-1', 'c40'))

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    // Re-add with the list's board layout so the tombstoned row is revived.
    await waitFor(() => expect(addProblem).toHaveBeenCalledWith('list-1', 'c40', 5))
  })

  it('an unknown / other-user listId shows "list not found", no crash', async () => {
    storeState = { status: 'loaded', lists: [], error: null }
    renderWithRouter('/lists/ghost')
    expect(await screen.findByText('List not found')).toBeInTheDocument()
  })

  it('an empty list shows an empty state, not an error', async () => {
    problemsState = { problems: [], loading: false, degraded: false }
    renderWithRouter('/lists/list-1')
    expect(await screen.findByText('No problems in this list yet')).toBeInTheDocument()
  })
})
