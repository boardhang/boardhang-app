import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import {
  addBoard,
  getActiveBoardId,
  getActiveHoldSetsRaw,
  getAddedBoardIds,
  getAngle,
} from '../board/boardStore'
import { isAngleEdited, resetAngleEdited } from './angleEdited'

const h = vi.hoisted(() => ({
  activeSession: null as unknown,
  canGoBack: true,
  navigate: vi.fn(),
  historyBack: vi.fn(),
  exitSessionOnBoard: vi.fn(),
  endActiveSessionLocally: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@tanstack/react-router', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  useNavigate: () => h.navigate,
  useCanGoBack: () => h.canGoBack,
  useRouter: () => ({ history: { back: h.historyBack } }),
}))
vi.mock('../sessions/sessionsStore', () => ({
  useSessions: () => ({ activeSession: h.activeSession }),
  exitSessionOnBoard: (...a: unknown[]) => h.exitSessionOnBoard(...a),
  endActiveSessionLocally: (...a: unknown[]) => h.endActiveSessionLocally(...a),
  // Same class object the component imports, so its `instanceof` check holds.
  SessionExitError: class SessionExitError extends Error {
    intent: 'ended' | 'left'
    constructor(intent: 'ended' | 'left', _reason: unknown) {
      super('exit failed')
      this.name = 'SessionExitError'
      this.intent = intent
    }
  },
}))
vi.mock('sonner', () => ({ toast: (...a: unknown[]) => h.toast(...a) }))

import { SessionExitError } from '../sessions/sessionsStore'
import { EditBoard } from './EditBoard'

const MASTERS_2019 = boardByLayoutId(5)! // 40° and 25°
const MINI_2025 = boardByLayoutId(7)! // 40° only, sets 28–31

beforeEach(() => {
  h.activeSession = null
  h.canGoBack = true
  h.navigate.mockClear()
  h.historyBack.mockClear()
  h.exitSessionOnBoard.mockReset().mockResolvedValue(null)
  h.endActiveSessionLocally.mockClear()
  h.toast.mockClear()
  // The failed-exit paths log the real error on purpose; keep it out of the test output.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  resetAngleEdited()
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // reset boardStore snapshot
})

const removeButton = () => screen.getByRole('button', { name: 'Remove board' })

/** Press "Remove board", then the red "Remove board" that replaces it. */
function removeAndConfirm() {
  fireEvent.click(removeButton())
  fireEvent.click(removeButton())
}

describe('EditBoard', () => {
  it('is titled "Edit {board name}" and has no Save button', () => {
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    expect(screen.getByRole('heading', { name: 'Edit MoonBoard Masters 2019' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('writes a changed angle to the store at once and marks it as edited here', () => {
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    expect(screen.getByRole('button', { name: '40°' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    expect(getAngle(MASTERS_2019)).toBe(25)
    expect(screen.getByRole('button', { name: '25°' })).toHaveAttribute('aria-pressed', 'true')
    expect(isAngleEdited(5)).toBe(true)
  })

  it('writes a toggled hold set to the store at once', () => {
    addBoard(7)
    render(<EditBoard board={MINI_2025} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hold Set F' }))
    expect(getActiveHoldSetsRaw(7)).toBe('29|30|31')
    expect(screen.getByRole('button', { name: 'Hold Set F' })).toHaveAttribute('aria-pressed', 'false')
    expect(isAngleEdited(7)).toBe(false)
  })

  it('does not make the edited board active', () => {
    addBoard(7) // active
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    expect(getActiveBoardId()).toBe(7)
  })

  it('the back arrow goes back in history', () => {
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.historyBack).toHaveBeenCalledTimes(1)
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('the back arrow goes to / when the page was opened by deep link', () => {
    h.canGoBack = false
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.historyBack).not.toHaveBeenCalled()
    expect(h.navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('"Remove board" asks first, and Cancel leaves the board in place', () => {
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    fireEvent.click(removeButton())
    expect(screen.getByText(/Your logbook and lists are kept/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Your logbook and lists are kept/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(getAddedBoardIds()).toEqual([5])
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('moves focus to Cancel when asking, and back to "Remove board" on Cancel', () => {
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    expect(removeButton()).not.toHaveFocus() // nothing grabs focus on load
    fireEvent.click(removeButton())
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(removeButton()).toHaveFocus()
  })

  it('confirming removes the board and leaves the page for /', () => {
    addBoard(7)
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    removeAndConfirm()
    expect(getAddedBoardIds()).toEqual([7])
    expect(h.navigate).toHaveBeenCalledWith({ to: '/', replace: true })
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('removing the last board also leaves for /', () => {
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    removeAndConfirm()
    expect(getAddedBoardIds()).toEqual([])
    expect(h.navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('warns that removing takes you out of the session when the live session is on this board', () => {
    h.activeSession = { id: 'S1', boardLayoutId: 5 }
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    fireEvent.click(removeButton())
    expect(screen.getByText(/Removing it takes you out of the session/)).toBeInTheDocument()
    expect(screen.queryByText(/Your logbook and lists are kept/)).toBeNull()
  })

  it('does not warn for a board the session is not on', () => {
    h.activeSession = { id: 'S1', boardLayoutId: 7 }
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    fireEvent.click(removeButton())
    expect(screen.queryByText(/takes you out of the session/)).toBeNull()
    expect(screen.getByText(/Your logbook and lists are kept/)).toBeInTheDocument()
  })

  it('removing the board you are mid-session on drops you out of that session', async () => {
    h.activeSession = { id: 'S1', boardLayoutId: 5 }
    h.exitSessionOnBoard.mockResolvedValue('left')
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    removeAndConfirm()
    await waitFor(() => expect(h.exitSessionOnBoard).toHaveBeenCalledWith(5))
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith('Left the session on MoonBoard Masters 2019'),
    )
    expect(getAddedBoardIds()).toEqual([])
  })

  it('ends the session instead when the store reports the owner was alone', async () => {
    h.activeSession = { id: 'S1', boardLayoutId: 5 }
    h.exitSessionOnBoard.mockResolvedValue('ended')
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    removeAndConfirm()
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith('Ended your session on MoonBoard Masters 2019'),
    )
  })

  it('removes the board and leaves immediately, without waiting on the session call', () => {
    // The exit is a network call with no timeout; a stalled connection must not hold the
    // removal (or the page) hostage. A never-settling promise pins that.
    h.activeSession = { id: 'S1', boardLayoutId: 5 }
    h.exitSessionOnBoard.mockReturnValue(new Promise(() => {}))
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    removeAndConfirm()
    expect(getAddedBoardIds()).toEqual([]) // gone on the same tick
    expect(h.navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('tells the user the session is still live when an END fails', async () => {
    h.activeSession = { id: 'S1', boardLayoutId: 5 }
    h.exitSessionOnBoard.mockRejectedValue(new SessionExitError('ended', new Error('offline')))
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    removeAndConfirm()
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        'Couldn’t end the session yet',
        expect.objectContaining({ description: expect.stringContaining('invite link still works') }),
      ),
    )
    expect(getAddedBoardIds()).toEqual([])
  })

  it('tells the user only the others may still see them when a LEAVE fails', async () => {
    // The other half of the intent split: a failed leave must NOT claim the session is still
    // running under their name — that copy belongs to a failed end.
    h.activeSession = { id: 'S1', boardLayoutId: 5 }
    h.exitSessionOnBoard.mockRejectedValue(new SessionExitError('left', new Error('offline')))
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    removeAndConfirm()
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        'Left the session on this device',
        expect.objectContaining({ description: expect.stringContaining('may still see you') }),
      ),
    )
  })

  it('a failed leave still removes the board and retires the session on this device', async () => {
    h.activeSession = { id: 'S1', boardLayoutId: 5 }
    h.exitSessionOnBoard.mockRejectedValue(new Error('offline'))
    addBoard(5)
    render(<EditBoard board={MASTERS_2019} />)
    removeAndConfirm()
    await waitFor(() => expect(h.endActiveSessionLocally).toHaveBeenCalled())
    expect(getAddedBoardIds()).toEqual([])
    expect(h.navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('keeps the remove section below the hold sets', () => {
    addBoard(7)
    render(<EditBoard board={MINI_2025} />)
    const holdSets = screen.getByRole('group', { name: 'Hold sets on the wall' })
    expect(within(holdSets).getAllByRole('button')).toHaveLength(4)
    expect(holdSets.compareDocumentPosition(removeButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
