import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { CatalogProblem } from './catalogSync'
import { ProblemDetail } from './ProblemDetail'

// Configurable auth so we can flip signed-out → signed-in to exercise the KTD3 resume.
const authState = {
  status: 'signedOut' as string,
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

// Stub the sheet so this test isolates ProblemDetail's trigger + resume wiring.
vi.mock('../lists/AddToListSheet', () => ({
  AddToListSheet: ({ open }: { open: boolean }) => (open ? <div>ADD_TO_LIST_SHEET</div> : null),
}))

// Stub the sign-in dialog with a controllable dismiss so we can close it without a sign-in.
vi.mock('../auth/SignInDialog', () => ({
  SignInDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) =>
    open ? (
      <div>
        <span>Sign in to log ascents</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          DISMISS_SIGNIN
        </button>
      </div>
    ) : null,
}))

const board = boardByLayoutId(7)!

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

const p = problem('a', 'Alpha')

function mount() {
  return render(
    <ProblemDetail
      problem={p}
      displayed={[p]}
      board={board}
      angle={40}
      favoriteIds={new Set()}
      sentIds={new Set()}
      onNavigate={() => {}}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.status = 'signedOut'
  localStorage.clear()
})

describe('ProblemDetail — save-to-list trigger', () => {
  it('has a Save-to-list button distinct from the favorite heart', () => {
    authState.status = 'signedInWithProfile'
    mount()
    expect(screen.getByRole('button', { name: 'Save to list' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Favorite' })).toBeInTheDocument()
  })

  it('signed in: tapping the icon opens the add-to-list sheet', () => {
    authState.status = 'signedInWithProfile'
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Save to list' }))
    expect(screen.getByText('ADD_TO_LIST_SHEET')).toBeInTheDocument()
  })

  it('signed out: the icon opens the sign-in dialog, then resumes the sheet after sign-in', () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Save to list' }))

    // Sign-in prompt, not the sheet yet.
    expect(screen.getByText('Sign in to log ascents')).toBeInTheDocument()
    expect(screen.queryByText('ADD_TO_LIST_SHEET')).toBeNull()

    // Session lands → the pending intent reopens the sheet on the same problem.
    authState.status = 'signedInWithProfile'
    rerender(
      <ProblemDetail
        problem={p}
        displayed={[p]}
        board={board}
        angle={40}
        favoriteIds={new Set()}
        sentIds={new Set()}
        onNavigate={() => {}}
      />,
    )
    expect(screen.getByText('ADD_TO_LIST_SHEET')).toBeInTheDocument()
  })

  it('does NOT resume the sheet if the dialog was dismissed without signing in (#2)', () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Save to list' }))
    expect(screen.getByText('Sign in to log ascents')).toBeInTheDocument()

    // Dismiss the dialog without signing in — the pending intent must be cleared.
    fireEvent.click(screen.getByRole('button', { name: 'DISMISS_SIGNIN' }))

    // A later, unrelated sign-in must NOT auto-open the add-to-list sheet.
    authState.status = 'signedInWithProfile'
    rerender(
      <ProblemDetail
        problem={p}
        displayed={[p]}
        board={board}
        angle={40}
        favoriteIds={new Set()}
        sentIds={new Set()}
        onNavigate={() => {}}
      />,
    )
    expect(screen.queryByText('ADD_TO_LIST_SHEET')).toBeNull()
  })
})
