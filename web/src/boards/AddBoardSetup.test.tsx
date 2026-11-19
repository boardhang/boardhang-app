import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import {
  addBoard,
  getActiveBoardId,
  getActiveHoldSetsRaw,
  getAddedBoardIds,
  getAngle,
  removeBoard,
  setActiveHoldSetsRaw,
  setAngle,
} from '../board/boardStore'
import { BottomSlotContext } from '../shell/bottomSlot'

const h = vi.hoisted(() => ({ canGoBack: true, navigate: vi.fn(), historyBack: vi.fn() }))
vi.mock('@tanstack/react-router', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  useNavigate: () => h.navigate,
  useCanGoBack: () => h.canGoBack,
  useRouter: () => ({ history: { back: h.historyBack } }),
}))

import { AddBoardSetup } from './AddBoardSetup'

const MASTERS_2019 = boardByLayoutId(5)! // 40° and 25°, six filterable hold sets
const MINI_2025 = boardByLayoutId(7)! // 40° only, sets 28–31

let slot: HTMLElement

beforeEach(() => {
  h.canGoBack = true
  h.navigate.mockClear()
  h.historyBack.mockClear()
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // reset boardStore snapshot
  slot = document.createElement('div')
  slot.setAttribute('data-testid', 'bottom-slot')
  document.body.appendChild(slot)
  return () => slot.remove()
})

/** Mount step 2 with the shell's bottom slot, where the docked bar portals. */
function renderSetup(board = MASTERS_2019) {
  return render(
    <BottomSlotContext.Provider value={slot}>
      <AddBoardSetup board={board} />
    </BottomSlotContext.Provider>,
  )
}

const bar = () => within(screen.getByTestId('bottom-slot'))
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('AddBoardSetup', () => {
  it('asks "How is it set up?" as step 2 of 2', () => {
    renderSetup()
    expect(screen.getByRole('heading', { name: 'How is it set up?' })).toBeInTheDocument()
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
  })

  it('pre-selects the default angle and every hold set for a board never added', () => {
    renderSetup()
    expect(pressed('40°')).toBe('true')
    expect(pressed('25°')).toBe('false')
    const sets = within(screen.getByRole('group', { name: 'Hold sets on the wall' })).getAllByRole('button')
    expect(sets.every((s) => s.getAttribute('aria-pressed') === 'true')).toBe(true)
    expect(bar().getByText('MoonBoard Masters 2019')).toBeInTheDocument()
    expect(bar().getByText('40° · all hold sets')).toBeInTheDocument()
  })

  it('starts from the remembered setup of a board that was removed earlier', () => {
    addBoard(7)
    setActiveHoldSetsRaw(7, '28|30')
    addBoard(5)
    setAngle(5, 25)
    removeBoard(7)
    removeBoard(5)

    const { unmount } = renderSetup(MASTERS_2019)
    expect(pressed('25°')).toBe('true')
    unmount()

    renderSetup(MINI_2025)
    expect(pressed('Hold Set F')).toBe('true')
    expect(pressed('Original School Holds')).toBe('false')
    expect(bar().getByText('40° · 2 of 4 hold sets')).toBeInTheDocument()
  })

  it('updates the bar summary as the angle and hold sets change', () => {
    renderSetup()
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    expect(bar().getByText('25° · all hold sets')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hold Set A' }))
    expect(bar().getByText('25° · 5 of 6 hold sets')).toBeInTheDocument()
  })

  it('saves nothing until "Add board" is pressed', () => {
    addBoard(7)
    const { unmount } = renderSetup()
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hold Set A' }))
    unmount() // leave without adding

    expect(getAddedBoardIds()).toEqual([7])
    expect(getActiveBoardId()).toBe(7)
    expect(getAngle(MASTERS_2019)).toBe(40)
    expect(getActiveHoldSetsRaw(5)).toBe('')
    expect(localStorage.getItem('angle_5')).toBeNull()
    expect(localStorage.getItem('activeHoldSets_5')).toBeNull()
  })

  it('"Add board" adds the board with the chosen setup and makes it active over another board', () => {
    addBoard(7) // already active
    renderSetup()
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hold Set A' })) // 17 off
    fireEvent.click(bar().getByRole('button', { name: 'Add board' }))

    expect(getAddedBoardIds()).toEqual([5, 7])
    expect(getActiveBoardId()).toBe(5)
    expect(getAngle(MASTERS_2019)).toBe(25)
    // The same keys and value formats the old settings drawer wrote.
    expect(localStorage.getItem('addedBoards')).toBe('5|7')
    expect(localStorage.getItem('activeBoardId')).toBe('5')
    expect(localStorage.getItem('angle_5')).toBe('25')
    expect(localStorage.getItem('activeHoldSets_5')).toBe('18|19|21|22|23')
  })

  it('"Add board" lands on the board’s catalog at the chosen angle, replacing this step', () => {
    renderSetup()
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    fireEvent.click(bar().getByRole('button', { name: 'Add board' }))
    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(h.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/board/$layoutId/catalog',
        params: { layoutId: '5' },
        search: expect.objectContaining({ angle: 25 }),
        replace: true,
      }),
    )
  })

  it('stores an unchanged full selection as the "all hold sets" value', () => {
    renderSetup(MINI_2025)
    fireEvent.click(bar().getByRole('button', { name: 'Add board' }))
    expect(localStorage.getItem('activeHoldSets_7')).toBe('')
    expect(localStorage.getItem('angle_7')).toBe('40')
  })

  it('the back arrow returns to step 1 through history', () => {
    renderSetup()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.historyBack).toHaveBeenCalledTimes(1)
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('the back arrow opens step 1 directly when this step was deep-linked', () => {
    h.canGoBack = false
    renderSetup()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/boards/add', replace: true })
  })
})
