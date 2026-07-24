import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { CatalogProblem } from '../catalog/catalogSync'
import { useAddToList } from './useAddToList'

// Configurable auth so we can flip signed-out → signed-in to exercise the KTD3 resume.
const authState = { status: 'signedOut' as string }
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState,
}))

// Stub the sheet so this test isolates the hook's trigger + resume wiring.
vi.mock('./AddToListSheet', () => ({
  AddToListSheet: ({ open, problem }: { open: boolean; problem: CatalogProblem }) =>
    open ? <div>ADD_TO_LIST_SHEET:{problem.source_catalog_id}</div> : null,
}))

// Stub the sign-in dialog with a controllable dismiss so we can close it without signing in.
vi.mock('../auth/SignInDialog', () => ({
  SignInDialog: ({
    open,
    onOpenChange,
    title,
  }: {
    open: boolean
    onOpenChange: (o: boolean) => void
    title: string
  }) =>
    open ? (
      <div>
        <span>{title}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          DISMISS_SIGNIN
        </button>
      </div>
    ) : null,
}))

const board = boardByLayoutId(7)!

// A minimal problem — the hook only reads its id (passed through to the sheet); the rest
// satisfies the CatalogProblem type.
function makeProblem(id: string): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: board.layoutId,
    angle: 40,
    name: 'Test Problem',
    grade: '6C+',
    user_grade: null,
    setter: 'Tester',
    stars: 0,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds: [],
  }
}

function Harness({ id = 'a' }: { id?: string }) {
  const addToList = useAddToList({ problem: makeProblem(id), board })
  return (
    <div>
      <button type="button" onClick={addToList.saveToList}>
        SAVE
      </button>
      {addToList.element}
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.status = 'signedOut'
})

describe('useAddToList', () => {
  it('signed in: saveToList opens the sheet on the given problem', () => {
    authState.status = 'signedInWithProfile'
    render(<Harness id="p1" />)
    fireEvent.click(screen.getByText('SAVE'))
    expect(screen.getByText('ADD_TO_LIST_SHEET:p1')).toBeInTheDocument()
  })

  it('signed out: saveToList opens the sign-in dialog and NOT the sheet', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('SAVE'))
    expect(screen.getByText('Sign in to save to a list')).toBeInTheDocument()
    expect(screen.queryByText(/ADD_TO_LIST_SHEET/)).toBeNull()
  })

  it('signed out → signed in resumes the sheet on the same problem', () => {
    const { rerender } = render(<Harness id="p2" />)
    fireEvent.click(screen.getByText('SAVE'))
    expect(screen.queryByText(/ADD_TO_LIST_SHEET/)).toBeNull()

    authState.status = 'signedInWithProfile'
    rerender(<Harness id="p2" />)
    expect(screen.getByText('ADD_TO_LIST_SHEET:p2')).toBeInTheDocument()
  })

  it('does NOT resume if the sign-in dialog was dismissed without signing in', () => {
    const { rerender } = render(<Harness />)
    fireEvent.click(screen.getByText('SAVE'))
    fireEvent.click(screen.getByText('DISMISS_SIGNIN'))

    authState.status = 'signedInWithProfile'
    rerender(<Harness />)
    expect(screen.queryByText(/ADD_TO_LIST_SHEET/)).toBeNull()
  })
})
