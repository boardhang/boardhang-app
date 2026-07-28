// U5 — the author's own-problem controls on the detail view: the owner-only "…" overflow
// cell (Edit / visibility / Delete), the AE3 handle gate on publishing, and the beta-videos
// gate that keeps custom problems out of the (imported-catalog-only) beta pipeline.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { CatalogProblem } from './catalogSync'
import { ProblemDetail } from './ProblemDetail'
import { AscentRow } from '../logbook/AscentRow'
import type { Ascent } from '../logbook/ascents'
import { getUserProblemsByIds, ownUserProblemIds } from './userProblemsSync'
import { deleteUserProblem, setUserProblemVisibility } from './userProblemsStore'
import type { UserProblem } from './userProblemsTypes'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// Configurable auth: the handle gate (AE3) reads `profile.handle`.
const authState = {
  status: 'signedInWithProfile' as string,
  profile: null as { handle: string } | null,
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

// The handle prompt hosts the real profile-setup panel; stub it to a marker so this test
// asserts "prompted to set up a profile", not the panel's own behavior.
vi.mock('../auth/ProfileSetup', () => ({
  ProfileSetup: ({ onDone }: { onDone: () => void }) => (
    <button type="button" onClick={onDone}>
      PROFILE_SETUP
    </button>
  ),
}))

vi.mock('../ble/useBle', () => ({
  useBle: vi.fn(() => ({ state: 'disconnected', deviceName: null, error: null })),
  connectBoard: vi.fn(),
  isConnected: vi.fn(() => false),
  setBleError: vi.fn(),
  bleClient: { send: vi.fn(), state: 'disconnected' },
}))

// Beta videos are imported-catalog-only (Scope Boundaries) — stub to a marker so the gate
// is assertable without the YouTube-backed section.
vi.mock('../beta/BetaVideos', () => ({
  BetaVideos: ({ sourceCatalogId }: { sourceCatalogId: string }) => (
    <div>BETA_VIDEOS:{sourceCatalogId}</div>
  ),
}))

// Logbook rows must survive a delete on their own snapshot (R15) — hold them in a mutable
// array so the test can prove nothing rewrote them.
const ascentsMock = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('../logbook/ascents', () => ({
  useAscents: () => ({ status: 'loaded', ascents: ascentsMock.rows, error: null }),
  getAscentsSnapshot: () => ascentsMock.rows,
  settleAscents: vi.fn(async () => {}),
  addAttemptTries: vi.fn(async () => {}),
  createAscent: vi.fn(async () => {}),
  deleteAscent: vi.fn(async () => {}),
  updateAscent: vi.fn(async () => {}),
  absorbAttemptRow: vi.fn(async () => {}),
}))

vi.mock('../sessions/useActiveQueueProblems', () => ({
  useActiveQueueProblems: vi.fn(() => []),
}))

// Ownership + the owner's row come from the cache; mutations go through the store.
vi.mock('./userProblemsSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./userProblemsSync')>()),
  ownUserProblemIds: vi.fn(async () => new Set<string>()),
  getUserProblemsByIds: vi.fn(async () => new Map<string, UserProblem>()),
}))

// Capture the change listener so a test can fire the same notification a mutation does.
const listeners = vi.hoisted(() => ({ fns: new Set<() => void>() }))
vi.mock('./userProblemsStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./userProblemsStore')>()),
  deleteUserProblem: vi.fn(async () => {}),
  setUserProblemVisibility: vi.fn(async () => {}),
  subscribeUserProblemsChanged: (fn: () => void) => {
    listeners.fns.add(fn)
    return () => listeners.fns.delete(fn)
  },
}))

const board = boardByLayoutId(7)!
const OWN_ID = 'user:11111111-1111-4111-8111-111111111111'
const OTHER_ID = 'user:22222222-2222-4222-8222-222222222222'

function problem(id: string, name: string): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: 7,
    angle: 40,
    name,
    grade: '6B',
    user_grade: null,
    setter: '',
    stars: 0,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds: [{ c: 0, r: 1, t: 'start' }],
  }
}

function userProblem(id: string, visibility: 'private' | 'public'): UserProblem {
  return {
    id: id.slice('user:'.length),
    sourceCatalogId: id,
    userId: 'me',
    name: 'Mine',
    grade: '6B',
    holds: [{ c: 0, r: 1, t: 'start' }],
    layoutId: 7,
    angle: 40,
    visibility,
    updatedAt: '2026-07-28T00:00:00Z',
    deleted: false,
  }
}

/** Say "this id is the signed-in user's, and here is its row". */
function ownsRow(row: UserProblem) {
  vi.mocked(ownUserProblemIds).mockResolvedValue(new Set([row.sourceCatalogId]))
  vi.mocked(getUserProblemsByIds).mockResolvedValue(new Map([[row.sourceCatalogId, row]]))
}

function mount(
  p: CatalogProblem,
  props: { onEditProblem?: (id: string) => void; onClose?: () => void } = {},
) {
  return render(
    <ProblemDetail
      problem={p}
      displayed={[p]}
      board={board}
      angle={40}
      favoriteIds={new Set()}
      sentIds={new Set()}
      onNavigate={() => {}}
      {...props}
    />,
  )
}

/** Open the owner overflow menu, waiting for the ownership read to settle. */
async function openOwnerMenu() {
  const trigger = await screen.findByRole('button', { name: 'Problem options' })
  fireEvent.click(trigger)
  return trigger
}

beforeEach(() => {
  vi.clearAllMocks()
  listeners.fns.clear()
  localStorage.clear()
  ascentsMock.rows = []
  authState.status = 'signedInWithProfile'
  authState.profile = { handle: 'alice' }
  vi.mocked(ownUserProblemIds).mockResolvedValue(new Set<string>())
  vi.mocked(getUserProblemsByIds).mockResolvedValue(new Map<string, UserProblem>())
})

describe('ProblemDetail owner controls', () => {
  it('offers the author Edit, a visibility toggle and Delete from an overflow cell', async () => {
    ownsRow(userProblem(OWN_ID, 'private'))
    mount(problem(OWN_ID, 'Mine'), { onEditProblem: () => {} })

    await openOwnerMenu()
    expect(screen.getByRole('menuitem', { name: 'Edit problem' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Make public' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete problem' })).toBeInTheDocument()
  })

  it("leaves the six-cell toolbar untouched on another author's public problem", async () => {
    // The `user:` prefix alone is not ownership — this row is not in the own-ids set.
    vi.mocked(ownUserProblemIds).mockResolvedValue(new Set([OWN_ID]))
    mount(problem(OTHER_ID, 'Theirs'))

    const toolbar = screen.getByRole('toolbar', { name: 'Problem actions' })
    expect(toolbar.children).toHaveLength(6)
    await waitFor(() => expect(ownUserProblemIds).toHaveBeenCalled())
    expect(toolbar.children).toHaveLength(6)
    expect(screen.queryByRole('button', { name: 'Problem options' })).not.toBeInTheDocument()
  })

  it('appends a seventh cell for the author', async () => {
    ownsRow(userProblem(OWN_ID, 'private'))
    mount(problem(OWN_ID, 'Mine'))

    await screen.findByRole('button', { name: 'Problem options' })
    const toolbar = screen.getByRole('toolbar', { name: 'Problem actions' })
    expect(toolbar.children).toHaveLength(7)
  })

  it('shows no owner menu on an imported catalog problem', async () => {
    vi.mocked(ownUserProblemIds).mockResolvedValue(new Set([OWN_ID]))
    mount(problem('imported-1', 'Imported'))

    await waitFor(() =>
      expect(screen.getByRole('toolbar', { name: 'Problem actions' }).children).toHaveLength(6),
    )
    expect(ownUserProblemIds).not.toHaveBeenCalled()
  })

  it('opens the editor on the shown problem', async () => {
    ownsRow(userProblem(OWN_ID, 'private'))
    const onEditProblem = vi.fn()
    mount(problem(OWN_ID, 'Mine'), { onEditProblem })

    await openOwnerMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit problem' }))
    expect(onEditProblem).toHaveBeenCalledWith(OWN_ID)
  })

  it('deletes after a confirm and closes the drawer, leaving logged ascents on their snapshot', async () => {
    const logged: Ascent = {
      id: 'asc-1',
      sourceCatalogId: OWN_ID,
      problemName: 'Mine',
      problemGrade: '6B',
      votedGrade: '6B',
      boardLayoutId: 7,
      date: '2026-07-20T10:00:00Z',
      sent: true,
      tries: 1,
      stars: 0,
      comment: '',
    } as unknown as Ascent
    ascentsMock.rows = [logged]

    ownsRow(userProblem(OWN_ID, 'private'))
    const onClose = vi.fn()
    mount(problem(OWN_ID, 'Mine'), { onClose })

    await openOwnerMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete problem' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteUserProblem).toHaveBeenCalledWith(OWN_ID))
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    // R15: the ascent row is untouched and still renders from its own denormalized copy,
    // with no catalog entry behind it.
    expect(ascentsMock.rows).toEqual([logged])
    const row = render(<AscentRow ascent={logged} board={board} onEdit={() => {}} />)
    expect(within(row.container).getByText('Mine')).toBeInTheDocument()
    expect(within(row.container).getByText('6B')).toBeInTheDocument()
  })

  it('unpublishes a public problem straight from the menu', async () => {
    ownsRow(userProblem(OWN_ID, 'public'))
    mount(problem(OWN_ID, 'Mine'))

    await openOwnerMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make private' }))
    await waitFor(() => expect(setUserProblemVisibility).toHaveBeenCalledWith(OWN_ID, 'private'))
  })

  it('publishes when the author has a handle', async () => {
    ownsRow(userProblem(OWN_ID, 'private'))
    mount(problem(OWN_ID, 'Mine'))

    await openOwnerMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make public' }))
    await waitFor(() => expect(setUserProblemVisibility).toHaveBeenCalledWith(OWN_ID, 'public'))
  })

  it('prompts for profile setup instead of publishing when the author has no handle (AE3)', async () => {
    authState.status = 'signedInNoProfile'
    authState.profile = null
    ownsRow(userProblem(OWN_ID, 'private'))
    mount(problem(OWN_ID, 'Mine'))

    await openOwnerMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make public' }))

    expect(await screen.findByText('PROFILE_SETUP')).toBeInTheDocument()
    expect(setUserProblemVisibility).not.toHaveBeenCalled()
  })

  it('re-reads the owner row when the cached problems change', async () => {
    const row = userProblem(OWN_ID, 'private')
    ownsRow(row)
    mount(problem(OWN_ID, 'Mine'))

    await openOwnerMenu()
    expect(screen.getByRole('menuitem', { name: 'Make public' })).toBeInTheDocument()

    // An edit elsewhere (or this device's own mutation) published the row.
    ownsRow(userProblem(OWN_ID, 'public'))
    for (const fn of listeners.fns) fn()

    expect(await screen.findByRole('menuitem', { name: 'Make private' })).toBeInTheDocument()
  })
})

describe('ProblemDetail beta videos', () => {
  it('renders the beta section for an imported problem', async () => {
    mount(problem('imported-1', 'Imported'))
    expect(await screen.findByText('BETA_VIDEOS:imported-1')).toBeInTheDocument()
  })

  it('omits the beta section on a custom problem', async () => {
    ownsRow(userProblem(OWN_ID, 'private'))
    mount(problem(OWN_ID, 'Mine'))
    await screen.findByRole('button', { name: 'Problem options' })
    expect(screen.queryByText(`BETA_VIDEOS:${OWN_ID}`)).not.toBeInTheDocument()
  })
})
