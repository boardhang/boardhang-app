import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId, type CatalogBoardDef } from '../board/boards'
import { ProblemEditorDrawer } from './ProblemEditorDrawer'
import { readDraft } from './problemDraftStore'
import * as ble from '../ble/useBle'

vi.mock('../ble/useBle', () => ({
  useBle: vi.fn(() => ({ state: 'disconnected', deviceName: null, error: null })),
  connectBoard: vi.fn(),
  isConnected: vi.fn(() => false),
  setBleError: vi.fn(),
  bleClient: { send: vi.fn(), state: 'disconnected' },
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
  const utils = render(
    <ProblemEditorDrawer board={board} angle={ANGLE} open onOpenChange={onOpenChange} {...over} />,
  )
  return { onOpenChange, ...utils }
}

const target = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(ble.useBle).mockReturnValue({ state: 'disconnected', deviceName: null, error: null })
  vi.mocked(ble.isConnected).mockReturnValue(false)
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
