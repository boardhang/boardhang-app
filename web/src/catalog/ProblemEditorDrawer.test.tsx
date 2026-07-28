import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId, type CatalogBoardDef } from '../board/boards'
import { ProblemEditorDrawer } from './ProblemEditorDrawer'
import { readDraft } from './problemDraftStore'
import { createUserProblem, updateUserProblem } from './userProblemsStore'
import type { UserProblem } from './userProblemsTypes'
import * as ble from '../ble/useBle'

vi.mock('../ble/useBle', () => ({
  useBle: vi.fn(() => ({ state: 'disconnected', deviceName: null, error: null })),
  connectBoard: vi.fn(),
  isConnected: vi.fn(() => false),
  setBleError: vi.fn(),
  bleClient: { send: vi.fn(), state: 'disconnected' },
}))

// Auth is a plain mutable object so a test can flip signed-out → signed-in across a
// remount (the AE1 resume) without a provider.
const authState: { status: string; profile: { handle: string } | null } = {
  status: 'signedOut',
  profile: null,
}
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => authState }))

// Stub the sign-in dialog with a controllable dismiss, mirroring useAddToList.test.
vi.mock('../auth/SignInDialog', () => ({
  SignInDialog: ({
    open: isOpen,
    onOpenChange,
    title,
  }: {
    open: boolean
    onOpenChange: (o: boolean) => void
    title: string
  }) =>
    isOpen ? (
      <div>
        <span>{title}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          DISMISS_SIGNIN
        </button>
      </div>
    ) : null,
}))

vi.mock('./userProblemsStore', () => ({
  createUserProblem: vi.fn(),
  updateUserProblem: vi.fn(),
}))

// Lighting an UNSAVED draft must never touch the session's shared "on the wall" pointer
// (R3/AE5). The editor doesn't import this module at all; the mock is the tripwire that
// catches a future refactor onto useLightUp, which does report.
vi.mock('../sessions/sessionsStore', () => ({ reportProblemLit: vi.fn().mockResolvedValue(undefined) }))
import { reportProblemLit } from '../sessions/sessionsStore'

const board = boardByLayoutId(7)! // Mini MoonBoard 2025, 12 rows, one angle (40)
const ANGLE = 40

// C1 (col 2, row 1) is on the grid but owned by no hold set in the Mini's bundled
// membership map — the "not installed, not tappable" case.
const UNOWNED = 'C1, empty'

function open(over: Partial<Parameters<typeof ProblemEditorDrawer>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()
  const utils = render(
    <ProblemEditorDrawer
      board={board}
      angle={ANGLE}
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      {...over}
    />,
  )
  return { onOpenChange, onSaved, ...utils }
}

const target = (name: string) => screen.getByRole('button', { name })

/** A saved problem to open the editor on (?edit=<id>). */
function userProblem(over: Partial<UserProblem> = {}): UserProblem {
  return {
    id: 'p-1',
    sourceCatalogId: 'user:p-1',
    userId: 'u-1',
    name: 'Crimp ladder',
    grade: '7A',
    holds: [{ c: 0, r: 1, t: 'start' }],
    layoutId: board.layoutId,
    angle: ANGLE,
    visibility: 'private',
    updatedAt: '2026-07-28T00:00:00Z',
    deleted: false,
    setterUserId: null,
    setterHandle: null,
    ...over,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(ble.useBle).mockReturnValue({ state: 'disconnected', deviceName: null, error: null })
  vi.mocked(ble.isConnected).mockReturnValue(false)
  authState.status = 'signedOut'
  authState.profile = null
  vi.mocked(createUserProblem).mockResolvedValue(userProblem({ sourceCatalogId: 'user:new' }))
  vi.mocked(updateUserProblem).mockResolvedValue(userProblem())
})

describe('ProblemEditorDrawer — tap cycle', () => {
  it('cycles an empty position through start, move, end and back to empty', async () => {
    open()
    await screen.findByRole('dialog')

    fireEvent.click(target('A1, empty'))
    expect(target('A1, start hold')).toBeInTheDocument()

    fireEvent.click(target('A1, start hold'))
    expect(target('A1, right hold')).toBeInTheDocument()

    fireEvent.click(target('A1, right hold'))
    expect(target('A1, end hold')).toBeInTheDocument()

    fireEvent.click(target('A1, end hold'))
    expect(target('A1, empty')).toBeInTheDocument()
  })
})

describe('ProblemEditorDrawer — role brush palette', () => {
  it('assigns left and match with an explicit brush, and un-assigns a same-role tap', async () => {
    open()
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Left brush' }))
    fireEvent.click(target('A1, empty'))
    expect(target('A1, left hold')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Match brush' }))
    fireEvent.click(target('B2, empty'))
    expect(target('B2, match hold')).toBeInTheDocument()

    // Tapping a hold that already carries the active brush's role removes it.
    fireEvent.click(target('B2, match hold'))
    expect(target('B2, empty')).toBeInTheDocument()
    // The left hold, painted with a different brush, is untouched.
    expect(target('A1, left hold')).toBeInTheDocument()
  })
})

describe('ProblemEditorDrawer — installed hold sets', () => {
  it('offers no tap target for a position outside the installed hold sets', async () => {
    open()
    await screen.findByRole('dialog')

    expect(target('A1, empty')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: UNOWNED })).toBeNull()
  })

  it('allows every position on a board with no bundled membership map (fail open)', async () => {
    const unmapped: CatalogBoardDef = { ...board, membershipResource: 'NoSuchMembership' }
    open({ board: unmapped })
    await screen.findByRole('dialog')

    expect(target(UNOWNED)).toBeInTheDocument()
  })
})

describe('ProblemEditorDrawer — light up', () => {
  it('sends the draft over BLE without reporting a session lit pointer', async () => {
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty')) // start

    fireEvent.click(screen.getByRole('button', { name: 'Light up' }))

    await waitFor(() =>
      expect(ble.bleClient.send).toHaveBeenCalledWith(
        [{ col: 0, row: 1, type: 'start' }],
        expect.objectContaining({ rows: board.geometry.numRows, showBeta: true }),
      ),
    )
    expect(reportProblemLit).not.toHaveBeenCalled()
  })

  it('surfaces a send failure inline', async () => {
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    vi.mocked(ble.bleClient.send).mockRejectedValue(new Error('Board out of range'))
    open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))

    fireEvent.click(screen.getByRole('button', { name: 'Light up' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Board out of range')
  })

  it('drops a send that settles after the editor was closed and reopened', async () => {
    // The component is mounted with an `open` prop, not keyed, so it survives close+reopen —
    // a send left in flight must not paint the previous sitting's busy/error onto the new one.
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    let rejectSend!: () => void
    vi.mocked(ble.bleClient.send).mockReturnValueOnce(
      new Promise<void>((_, rej) => {
        rejectSend = () => rej(new Error('Board out of range'))
      }),
    )
    const props = { board, angle: ANGLE, onOpenChange: vi.fn(), onSaved: vi.fn() }
    const { rerender } = render(<ProblemEditorDrawer {...props} open />)
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))

    fireEvent.click(screen.getByRole('button', { name: 'Light up' }))
    expect(screen.getByRole('button', { name: /Sending/ })).toBeInTheDocument()

    rerender(<ProblemEditorDrawer {...props} open={false} />)
    rerender(<ProblemEditorDrawer {...props} open />)
    await screen.findByRole('dialog')

    await act(async () => {
      rejectSend()
    })

    // The new sitting is idle and clean: no stale "Sending…" and no stale error.
    expect(await screen.findByRole('button', { name: 'Light up' })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('ProblemEditorDrawer — draft persistence', () => {
  it('persists holds on every change and restores them across a remount', async () => {
    const first = open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))
    fireEvent.click(target('B2, empty'))
    fireEvent.click(target('B2, start hold')) // -> right

    expect(readDraft(board.layoutId, ANGLE).holds).toEqual([
      { c: 0, r: 1, t: 'start' },
      { c: 1, r: 2, t: 'right' },
    ])

    // A full unmount/remount stands in for the page reload (AE1 groundwork).
    first.unmount()
    open()
    await screen.findByRole('dialog')
    expect(target('A1, start hold')).toBeInTheDocument()
    expect(target('B2, right hold')).toBeInTheDocument()
  })

  it('keys the draft by board and angle', async () => {
    open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))

    expect(readDraft(board.layoutId, ANGLE).holds).toHaveLength(1)
    expect(readDraft(board.layoutId, 25).holds).toHaveLength(0)
    expect(readDraft(5, ANGLE).holds).toHaveLength(0)
  })
})

describe('ProblemEditorDrawer — dismissal', () => {
  it('closes silently when nothing was placed since it opened', async () => {
    const { onOpenChange } = open()
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByText(/discard/i)).toBeNull()
  })

  it('asks for confirmation before discarding a dirty draft', async () => {
    const { onOpenChange } = open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(await screen.findByText('Discard this problem?')).toBeInTheDocument()

    // Keeping the draft leaves the editor open and the holds intact.
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByText('Discard this problem?')).toBeNull())
    expect(target('A1, start hold')).toBeInTheDocument()

    // Discarding closes and clears the persisted draft.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(readDraft(board.layoutId, ANGLE).holds).toEqual([])
  })
})

describe('ProblemEditorDrawer — save sheet sign-in gate (AE1)', () => {
  it('opens the sign-in dialog signed out, and resumes the save sheet after a full remount', async () => {
    const first = open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))

    fireEvent.click(target('Save'))

    // Signed out: the sign-in dialog, not the save sheet.
    expect(screen.getByText('Sign in to save your problem')).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).toBeNull()

    // The OAuth redirect stand-in: the whole editor unmounts, the session lands, the
    // editor remounts from the URL. The persisted draft AND the pending save intent
    // both have to survive it.
    first.unmount()
    authState.status = 'signedInWithProfile'
    authState.profile = { handle: 'ada' }
    open()

    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByText(`${board.name} · ${ANGLE}° · 1 hold`)).toBeInTheDocument()
  })

  it('restores name, grade and visibility with the resumed sheet', async () => {
    authState.status = 'signedInWithProfile'
    authState.profile = { handle: 'ada' }
    const first = open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))
    fireEvent.click(target('Save'))

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Sloper trip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Public' }))
    // Every field is persisted as it changes, not only on save.
    expect(readDraft(board.layoutId, ANGLE)).toMatchObject({
      name: 'Sloper trip',
      visibility: 'public',
    })

    first.unmount()
    open()

    expect(await screen.findByLabelText('Name')).toHaveValue('Sloper trip')
    expect(screen.getByRole('combobox', { name: 'Grade', hidden: true })).toHaveTextContent('6A+')
    // `hidden` because unmounting with the drawer + sheet open leaves base-ui's inert
    // markers on the old tree, which jsdom then applies to the remounted one.
    expect(screen.getByRole('button', { name: 'Public', hidden: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('drops the pending save when the sign-in dialog is dismissed without a session', async () => {
    const first = open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))
    fireEvent.click(target('Save'))
    fireEvent.click(screen.getByText('DISMISS_SIGNIN'))

    first.unmount()
    authState.status = 'signedInWithProfile'
    open()
    await screen.findByRole('dialog')

    expect(screen.queryByLabelText('Name')).toBeNull()
  })
})

describe('ProblemEditorDrawer — save', () => {
  async function openSheet() {
    authState.status = 'signedInWithProfile'
    authState.profile = { handle: 'ada' }
    const utils = open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))
    fireEvent.click(target('Save'))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Sloper trip' } })
    return utils
  }

  it('writes the slab it was drawn on, clears the draft and opens the new problem', async () => {
    const { onSaved, onOpenChange } = await openSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Save problem' }))

    await waitFor(() =>
      expect(createUserProblem).toHaveBeenCalledWith({
        layoutId: board.layoutId,
        angle: ANGLE,
        name: 'Sloper trip',
        grade: '6A+',
        holds: [{ c: 0, r: 1, t: 'start' }],
        visibility: 'private',
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('user:new'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(readDraft(board.layoutId, ANGLE).holds).toEqual([])
  })

  it('surfaces a failed save inline and leaves the draft intact for a retry', async () => {
    vi.mocked(createUserProblem).mockRejectedValue(
      new Error("You're offline — this problem can't be saved until you're back online."),
    )
    const { onSaved } = await openSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Save problem' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i)
    expect(onSaved).not.toHaveBeenCalled()
    expect(readDraft(board.layoutId, ANGLE)).toMatchObject({
      holds: [{ c: 0, r: 1, t: 'start' }],
      name: 'Sloper trip',
    })
  })

  it('requires a name and clamps it to 60 characters', async () => {
    await openSheet()
    const name = screen.getByLabelText('Name')

    fireEvent.change(name, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save problem' })).toBeDisabled()

    fireEvent.change(name, { target: { value: 'x'.repeat(70) } })
    expect(name).toHaveValue('x'.repeat(60))
  })

  it('shows the picked grade as its label and saves it', async () => {
    await openSheet()
    // The closed trigger renders from the `items` label map, not the open list.
    const grade = screen.getByRole('combobox', { name: 'Grade' })
    expect(grade).toHaveTextContent('6A+')

    fireEvent.click(grade)
    // base-ui commits a selection on the pointer sequence, not a bare click.
    const option = await screen.findByRole('option', { name: '7A' })
    fireEvent.pointerDown(option)
    fireEvent.pointerUp(option)
    fireEvent.click(option)
    await waitFor(() => expect(grade).toHaveTextContent('7A'))

    fireEvent.click(screen.getByRole('button', { name: 'Save problem' }))
    await waitFor(() =>
      expect(createUserProblem).toHaveBeenCalledWith(expect.objectContaining({ grade: '7A' })),
    )
  })

  it('disables the public option with a hint until the author has a handle (AE3)', async () => {
    authState.status = 'signedInNoProfile'
    open()
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, empty'))
    fireEvent.click(target('Save'))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Sloper trip' } })

    expect(screen.getByRole('button', { name: 'Public' })).toBeDisabled()
    expect(screen.getByText(/pick a handle/i)).toBeInTheDocument()

    // Saving private still works without a handle.
    fireEvent.click(screen.getByRole('button', { name: 'Save problem' }))
    await waitFor(() =>
      expect(createUserProblem).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' })),
    )
  })
})

describe('ProblemEditorDrawer — edit mode', () => {
  it('pre-populates from the loaded problem and closes silently when untouched (KTD10)', async () => {
    const { onOpenChange } = open({ editing: userProblem() })
    await screen.findByRole('dialog')

    expect(screen.getByText('Edit problem')).toBeInTheDocument()
    expect(target('A1, start hold')).toBeInTheDocument()

    fireEvent.click(target('Cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByText(/discard/i)).toBeNull()
  })

  it('never writes the create draft, so an in-progress new problem survives an edit', async () => {
    // A create draft is already parked on this slab.
    const first = open()
    await screen.findByRole('dialog')
    fireEvent.click(target('B2, empty'))
    first.unmount()

    open({ editing: userProblem() })
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, start hold')) // -> right; an edit-mode change

    expect(readDraft(board.layoutId, ANGLE).holds).toEqual([{ c: 1, r: 2, t: 'start' }])
  })

  it('saves through updateUserProblem and reopens the edited problem', async () => {
    const { onSaved } = open({ editing: userProblem() })
    await screen.findByRole('dialog')

    fireEvent.click(target('Save'))
    expect(await screen.findByLabelText('Name')).toHaveValue('Crimp ladder')
    expect(screen.getByRole('combobox', { name: 'Grade' })).toHaveTextContent('7A')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crimp ladder v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(updateUserProblem).toHaveBeenCalledWith('user:p-1', {
        name: 'Crimp ladder v2',
        grade: '7A',
        holds: [{ c: 0, r: 1, t: 'start' }],
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('user:p-1'))
  })

  it('asks for confirmation before dropping edits, and never gates on sign-in', async () => {
    const { onOpenChange } = open({ editing: userProblem() })
    await screen.findByRole('dialog')
    fireEvent.click(target('A1, start hold'))

    fireEvent.click(target('Cancel'))
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    // Signed out (the beforeEach default) the edit save sheet still opens directly.
    fireEvent.click(target('Save'))
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
  })
})
