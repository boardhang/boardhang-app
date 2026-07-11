import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogProblem } from './catalogSync'
import { recordRecent } from './recentsStore'
import { dismissLastOpened } from './lastOpenedStore'
import { addBoard } from '../board/boardStore'
import { renderWithRouter } from '../test/renderWithRouter'
import { useSlab } from './useSlab'
import { useEnsureAscentsLoaded } from '../logbook/ascents'
import type { Ascent } from '../logbook/ascents'
import { useAuth } from '../auth/AuthProvider'
import type { SavedList } from '../lists/listsTypes'

// The saved-list filter reads the lists store + the union-membership hook. Mock both so
// the suite controls list state without a real IndexedDB / cloud. Defaults (loaded, no
// lists, empty ready membership) leave every pre-existing test untouched: no ?list means
// an empty listFilter, no "Lists" control, and a no-op predicate.
const listsMock = vi.hoisted(() => ({
  saved: { status: 'loaded' as string, lists: [] as SavedList[], error: null as string | null },
  members: { ids: new Set<string>(), ready: true },
  loadLists: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../lists/listsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lists/listsStore')>()
  return {
    ...actual,
    useSavedLists: () => listsMock.saved,
    loadLists: (...a: unknown[]) => listsMock.loadLists(...a),
  }
})
vi.mock('../lists/useListMemberIds', () => ({ useListMemberIds: () => listsMock.members }))

function savedListFixture(id: string, name: string, boardLayoutId = LAYOUT): SavedList {
  return {
    id,
    ownerId: 'user-A',
    name,
    boardLayoutId,
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    deleted: false,
  }
}

// Board 7 / angle 40 is the default board+angle (board 7's only angle is 40).
const LAYOUT = 7
const ANGLE = 40

function problem(
  id: string,
  name: string,
  stars: number,
  holds: CatalogProblem['holds'] = [{ c: 0, r: 1, t: 'start' }],
): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: LAYOUT,
    angle: ANGLE,
    name,
    grade: '6B',
    user_grade: null,
    setter: 'Alice',
    stars,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds,
  }
}

const H = (c: number, r: number): CatalogProblem['holds'][number] => ({ c, r, t: 'start' })

// Full slab: 'Visible' passes a minStars filter, the two 'Hidden' problems don't.
// Slab order (a, b, c) is deliberately different from the recents order so a test
// that pages the recents stack can't be satisfied by slab-order neighbors. Holds
// differ per problem so a ?holds filter can narrow the list.
const SLAB = [
  problem('a', 'Visible', 5, [H(0, 1), H(2, 3)]),
  problem('b', 'HiddenB', 0, [H(0, 1)]),
  problem('c', 'HiddenC', 0, [H(4, 5)]),
]

// Feed CatalogScreen a controllable slab instead of the async cache/sync layer.
vi.mock('./useSlab', () => ({ useSlab: vi.fn() }))

// Control the logbook store the sent-check derives from. addAttemptTries is also
// exported here (used by ProblemDetail when a problem opens), so the mock keeps it.
vi.mock('../logbook/ascents', () => ({
  useEnsureAscentsLoaded: vi.fn(() => ({ status: 'loaded', ascents: [], error: null })),
  addAttemptTries: vi.fn(),
}))

function ascent(over: Partial<Ascent> = {}): Ascent {
  return {
    id: 'x',
    date: '2026-01-01T00:00:00.000Z',
    sourceCatalogId: 'a',
    userProblemId: null,
    problemName: 'Visible',
    problemGrade: '6B',
    votedGrade: '6B',
    tries: 1,
    stars: 0,
    comment: '',
    sent: true,
    boardLayoutId: LAYOUT,
    ...over,
  }
}

// useAuth drives the status-filter gates (statusReady / signedOut). Keep the real
// AuthProvider (renderWithRouter mounts it) but stub useAuth so tests can pick the
// auth state. Default: signed out — matching the untouched suite's expectations.
vi.mock('../auth/AuthProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/AuthProvider')>()
  return { ...actual, useAuth: vi.fn(() => authValue('signedOut')) }
})

function authValue(status: 'signedOut' | 'signedInWithProfile') {
  return {
    status,
    profile: null,
    isRestoring: false,
    isConfigured: status !== 'signedOut',
    sendEmailCode: vi.fn(),
    verifyEmailCode: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    deleteAccount: vi.fn(),
    isHandleAvailable: vi.fn(),
    saveProfile: vi.fn(),
  }
}

// ProblemDetail (opened by tapping a recent) reaches for Web Bluetooth.
vi.mock('../ble/useBle', () => ({
  useBle: vi.fn(() => ({ state: 'disconnected', deviceName: null, error: null })),
  connectBoard: vi.fn(),
  isConnected: vi.fn(() => false),
  setBleError: vi.fn(),
  bleClient: { send: vi.fn(), state: 'disconnected' },
}))

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage'))
  // The last-opened store is an in-memory singleton (not localStorage), so reset the
  // slab this suite uses so an open in one test doesn't leak the bar into the next.
  dismissLastOpened(LAYOUT, ANGLE)
  vi.clearAllMocks()
  vi.mocked(useSlab).mockReturnValue({ problems: SLAB, loading: false, degraded: false, resync: vi.fn().mockResolvedValue(true) })
  // clearAllMocks keeps mockReturnValue overrides, so reset the auth + ascents stubs
  // to their defaults each test (else a signed-in / ascent-heavy test leaks forward).
  vi.mocked(useAuth).mockReturnValue(authValue('signedOut'))
  vi.mocked(useEnsureAscentsLoaded).mockReturnValue({ status: 'loaded', ascents: [], error: null })
  // Reset the saved-list mocks to their inert defaults so a list-filter test can't leak.
  listsMock.saved = { status: 'loaded', lists: [], error: null }
  listsMock.members = { ids: new Set<string>(), ready: true }
})

describe('CatalogScreen — recents open as their own stack', () => {
  it('opens a filtered-out recent and pages within the recents stack, not the slab', async () => {
    addBoard(LAYOUT)
    // Both hidden by the minStars filter; recents order becomes [C, B] (newest first).
    recordRecent(LAYOUT, ANGLE, 'b')
    recordRecent(LAYOUT, ANGLE, 'c')
    // The filter is URL-driven now: ?stars=1 narrows the displayed list to 'Visible'.
    renderWithRouter(`/board/${LAYOUT}/catalog?stars=1`)

    // Precondition: the filter hides both recents from the main list.
    expect(await screen.findByText('Visible')).toBeInTheDocument()
    expect(screen.queryByText('HiddenB')).toBeNull()
    expect(screen.queryByText('HiddenC')).toBeNull()

    // Open the recents sheet and tap the newest recent (C), which is filtered out.
    fireEvent.click(screen.getByRole('button', { name: /recently viewed/i }))
    fireEvent.click(await screen.findByText('HiddenC'))

    // Detail opens on C. C is first in the recents stack, so Previous is disabled and
    // Next is enabled — unlike slab paging, where C (last slab entry) would have Next
    // disabled and Previous -> the non-recent 'HiddenB'/'Visible'.
    expect(await screen.findByRole('heading', { name: 'HiddenC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous problem/i })).toBeDisabled()
    const next = screen.getByRole('button', { name: /next problem/i })
    expect(next).toBeEnabled()

    // Next steps to the other recent (B), proving the pager traverses the recents
    // stack (newest->oldest), never the in-between slab entries.
    fireEvent.click(next)
    expect(await screen.findByRole('heading', { name: 'HiddenB' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next problem/i })).toBeDisabled()
  })

  it('resets the pager to the filtered list after Back-closing a recent (no stale stack)', async () => {
    addBoard(LAYOUT)
    recordRecent(LAYOUT, ANGLE, 'b')
    recordRecent(LAYOUT, ANGLE, 'c') // recents [C, B]
    const { router } = renderWithRouter(`/board/${LAYOUT}/catalog`) // no filter: displayed = [a, b, c]
    await screen.findByText('Visible')

    // Open recent C (pages the recents stack), then Back to close. Scope the tap to
    // the recents sheet — HiddenC is also in the unfiltered list.
    fireEvent.click(screen.getByRole('button', { name: /recently viewed/i }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByText('HiddenC'))
    await screen.findByRole('heading', { name: 'HiddenC' })
    router.history.back()
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('problem'))

    // Open HiddenB from the LIST now. The pager must traverse `displayed` (slab order
    // a,b,c) — B is the middle entry, so Next -> HiddenC. If the recents snapshot [C,B]
    // had leaked, B would be last and Next would be disabled.
    fireEvent.click(screen.getByText('HiddenB'))
    await screen.findByRole('heading', { name: 'HiddenB' })
    const next = screen.getByRole('button', { name: /next problem/i })
    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(await screen.findByRole('heading', { name: 'HiddenC' })).toBeInTheDocument()
  })
})

describe('CatalogScreen — last-opened bar', () => {
  async function closeDrawer(router: { history: { back: () => void }; state: { location: { search: object } } }) {
    router.history.back()
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('problem'))
  }

  it('is hidden on a cold load and appears after opening then closing a problem', async () => {
    addBoard(LAYOUT)
    const { router } = renderWithRouter(`/board/${LAYOUT}/catalog`)
    await screen.findByText('Visible')
    // Cold: nothing opened this session → no bar.
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()

    fireEvent.click(screen.getByText('Visible'))
    await screen.findByRole('heading', { name: 'Visible' })
    await closeDrawer(router)

    // The bar now offers a one-tap reopen of the just-closed problem.
    expect(await screen.findByRole('button', { name: 'Open Visible' })).toBeInTheDocument()
  })

  it('reopens the drawer when the bar body is tapped', async () => {
    addBoard(LAYOUT)
    const { router } = renderWithRouter(`/board/${LAYOUT}/catalog`)
    await screen.findByText('Visible')
    fireEvent.click(screen.getByText('Visible'))
    await screen.findByRole('heading', { name: 'Visible' })
    await closeDrawer(router)

    fireEvent.click(await screen.findByRole('button', { name: 'Open Visible' }))
    expect(await screen.findByRole('heading', { name: 'Visible' })).toBeInTheDocument()
  })

  it('dismiss hides the bar; opening another problem brings it back seeded to that one', async () => {
    addBoard(LAYOUT)
    const { router } = renderWithRouter(`/board/${LAYOUT}/catalog`)
    await screen.findByText('Visible')
    fireEvent.click(screen.getByText('Visible'))
    await screen.findByRole('heading', { name: 'Visible' })
    await closeDrawer(router)
    await screen.findByRole('button', { name: 'Open Visible' })

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Visible' })).toBeNull())

    fireEvent.click(screen.getByText('HiddenB'))
    await screen.findByRole('heading', { name: 'HiddenB' })
    await closeDrawer(router)
    expect(await screen.findByRole('button', { name: 'Open HiddenB' })).toBeInTheDocument()
  })
})

describe('CatalogScreen — deep-linked problem loading', () => {
  it('shows a loading state for a deep-linked problem while its slab is still syncing', async () => {
    vi.mocked(useSlab).mockReturnValue({ problems: [], loading: true, degraded: false, resync: vi.fn().mockResolvedValue(true) })
    addBoard(LAYOUT)
    renderWithRouter(`/board/${LAYOUT}/catalog?problem=782b2b3b`)
    // The slab hasn't resolved, so the drawer opens on a spinner rather than nothing.
    expect(await screen.findByTestId('problem-pending')).toBeInTheDocument()
    expect(screen.getByText('Loading problem…')).toBeInTheDocument()
  })
})

describe('CatalogScreen — sent indicator', () => {
  // Scope the "Sent" check lookup to a named row, since several rows render.
  const rowFor = (name: string) => screen.getByText(name).closest('button') as HTMLElement

  it('checks only board-scoped true sends — not attempts or other-board sends', async () => {
    vi.mocked(useEnsureAscentsLoaded).mockReturnValue({
      status: 'loaded',
      error: null,
      ascents: [
        ascent({ sourceCatalogId: 'a', sent: true, boardLayoutId: LAYOUT }), // sent, this board
        ascent({ sourceCatalogId: 'b', sent: false, boardLayoutId: LAYOUT }), // attempt only
        ascent({ sourceCatalogId: 'c', sent: true, boardLayoutId: LAYOUT + 1 }), // sent, other board
      ],
    })
    addBoard(LAYOUT)
    renderWithRouter(`/board/${LAYOUT}/catalog`)
    await screen.findByText('Visible')

    expect(within(rowFor('Visible')).getByLabelText('Sent')).toBeInTheDocument()
    expect(within(rowFor('HiddenB')).queryByLabelText('Sent')).toBeNull()
    expect(within(rowFor('HiddenC')).queryByLabelText('Sent')).toBeNull()
  })

  it('drops ascents with a null catalog id without erroring', async () => {
    vi.mocked(useEnsureAscentsLoaded).mockReturnValue({
      status: 'loaded',
      error: null,
      ascents: [ascent({ sourceCatalogId: null, sent: true })],
    })
    addBoard(LAYOUT)
    renderWithRouter(`/board/${LAYOUT}/catalog`)
    await screen.findByText('Visible')
    expect(within(rowFor('Visible')).queryByLabelText('Sent')).toBeNull()
  })
})

describe('CatalogScreen — ascent-status filter', () => {
  it('filters to attempted (logged-not-sent) problems when signed in', async () => {
    vi.mocked(useAuth).mockReturnValue(authValue('signedInWithProfile'))
    vi.mocked(useEnsureAscentsLoaded).mockReturnValue({
      status: 'loaded',
      error: null,
      ascents: [
        ascent({ sourceCatalogId: 'a', sent: true }), // sent
        ascent({ sourceCatalogId: 'b', sent: false }), // attempt only → "attempted"
        // 'c' has no ascent → "not logged"
      ],
    })
    addBoard(LAYOUT)
    renderWithRouter(`/board/${LAYOUT}/catalog?status=attempted`)

    // Only HiddenB (attempted) survives; Visible (sent) and HiddenC (unlogged) are hidden.
    expect(await screen.findByText('HiddenB')).toBeInTheDocument()
    expect(screen.queryByText('Visible')).toBeNull()
    expect(screen.queryByText('HiddenC')).toBeNull()
  })

  it('ignores the status filter when signed out — a shared ?status= link does not blank the list', async () => {
    // Default useAuth mock is signed out; statusReady is false so status is skipped.
    addBoard(LAYOUT)
    renderWithRouter(`/board/${LAYOUT}/catalog?status=sent`)
    // All three problems remain visible despite ?status=sent.
    expect(await screen.findByText('Visible')).toBeInTheDocument()
    expect(screen.getByText('HiddenB')).toBeInTheDocument()
    expect(screen.getByText('HiddenC')).toBeInTheDocument()
  })

  it('does not blank a ?status= link while signed in but ascents are still loading', async () => {
    // statusReady requires ascents 'loaded'; during the load the predicate must be
    // skipped so a deep-linked ?status=sent shows the full list, not an empty one.
    vi.mocked(useAuth).mockReturnValue(authValue('signedInWithProfile'))
    vi.mocked(useEnsureAscentsLoaded).mockReturnValue({ status: 'loading', ascents: [], error: null })
    addBoard(LAYOUT)
    renderWithRouter(`/board/${LAYOUT}/catalog?status=sent`)
    expect(await screen.findByText('Visible')).toBeInTheDocument()
    expect(screen.getByText('HiddenB')).toBeInTheDocument()
    expect(screen.getByText('HiddenC')).toBeInTheDocument()
  })

  it('does not flash the sign-in hint during session restore (isRestoring)', async () => {
    // Mid-restore auth reads status:'signedOut' while isRestoring is true; the derived
    // `signedOut` must stay false so a returning user never sees the sign-in hint.
    vi.mocked(useAuth).mockReturnValue({ ...authValue('signedOut'), isRestoring: true })
    addBoard(LAYOUT)
    renderWithRouter(`/board/${LAYOUT}/catalog`)
    await screen.findByText('Visible')
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('Sign in to filter by status')).toBeNull()
  })
})

describe('CatalogScreen — saved-list filter over routing', () => {
  it('does NOT strip a valid ?list= deep-link while the lists store is still loading (cold-launch guard)', async () => {
    // Cold launch: lists haven't loaded yet. A deep-linked ?list=L1 must survive — pruning
    // against the empty store here would destroy a legitimate shared link (the P1 bug).
    // NOTE members.ready is true (realistic: the IndexedDB read resolves fast against the empty
    // cache) — the fail-open must come from listsStatus !== 'loaded', NOT from a not-ready read.
    listsMock.saved = { status: 'loading', lists: [], error: null }
    listsMock.members = { ids: new Set(), ready: true }
    addBoard(LAYOUT)
    const { router } = renderWithRouter(`/board/${LAYOUT}/catalog?list=L1`)
    // Fail-open: all problems visible, not a blanked grid.
    expect(await screen.findByText('Visible')).toBeInTheDocument()
    expect(screen.getByText('HiddenB')).toBeInTheDocument()
    // The param is retained (not self-healed away) until lists actually load.
    expect(router.state.location.search).toHaveProperty('list', 'L1')
  })

  it('filters to a list’s members once loaded', async () => {
    listsMock.saved = { status: 'loaded', lists: [savedListFixture('L1', 'Projects')], error: null }
    listsMock.members = { ids: new Set(['a']), ready: true } // only 'Visible' (a) is in the list
    addBoard(LAYOUT)
    renderWithRouter(`/board/${LAYOUT}/catalog?list=L1`)
    expect(await screen.findByText('Visible')).toBeInTheDocument()
    expect(screen.queryByText('HiddenB')).toBeNull()
    expect(screen.queryByText('HiddenC')).toBeNull()
  })

  it('a ?list= link never blanks the grid when the store never loads (signed-out / idle)', async () => {
    // Regression guard: a resolved-but-empty membership read (empty/cleared cache) must NOT
    // filter to zero. With the store idle (loadLists never ran, e.g. signed out), the facet
    // stays a no-op even though the membership read "resolved" with ready:true and an empty set.
    listsMock.saved = { status: 'idle', lists: [], error: null }
    listsMock.members = { ids: new Set(), ready: true }
    addBoard(LAYOUT)
    renderWithRouter(`/board/${LAYOUT}/catalog?list=X`)
    expect(await screen.findByText('Visible')).toBeInTheDocument()
    expect(screen.getByText('HiddenB')).toBeInTheDocument()
    expect(screen.getByText('HiddenC')).toBeInTheDocument()
    // No "Lists" control either (no lists for this board).
    expect(screen.queryByRole('button', { name: 'Filter by list' })).toBeNull()
  })

  it('prunes a stale/unknown list id once loaded and self-heals the URL', async () => {
    // Loaded, but ?list=ghost matches no live board list → dropped, URL rewritten, grid unfiltered.
    listsMock.saved = { status: 'loaded', lists: [savedListFixture('L1', 'Projects')], error: null }
    listsMock.members = { ids: new Set(), ready: true }
    addBoard(LAYOUT)
    const { router } = renderWithRouter(`/board/${LAYOUT}/catalog?list=ghost`)
    await screen.findByText('Visible')
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('list'))
    expect(screen.getByText('HiddenB')).toBeInTheDocument()
    expect(screen.getByText('HiddenC')).toBeInTheDocument()
  })
})

describe('CatalogScreen — hold filter over routing', () => {
  it('narrows the list to superset-matching problems from ?holds', async () => {
    addBoard(LAYOUT)
    // Only 'Visible' (a) has hold 2-3; the others do not.
    renderWithRouter(`/board/${LAYOUT}/catalog?holds=2-3`)
    expect(await screen.findByText('Visible')).toBeInTheDocument()
    expect(screen.queryByText('HiddenB')).toBeNull()
    expect(screen.queryByText('HiddenC')).toBeNull()
  })

  it('rings the highlighted hold on the detail board from a ?holds deep link', async () => {
    addBoard(LAYOUT)
    // b (HiddenB) has hold 0-1; deep-link it open with 0-1 highlighted.
    renderWithRouter(`/board/${LAYOUT}/catalog?holds=0-1&problem=b`)
    await screen.findByRole('heading', { name: 'HiddenB' })
    // The detail board (inside the drawer) rings the highlighted position b uses.
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getAllByTestId('hold-highlight')).toHaveLength(1)
  })
})
