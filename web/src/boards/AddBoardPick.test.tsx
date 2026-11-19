import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BOARDS } from '../board/boards'
import { addBoard, getAddedBoardIds } from '../board/boardStore'

const h = vi.hoisted(() => ({ canGoBack: true, navigate: vi.fn(), historyBack: vi.fn() }))
vi.mock('@tanstack/react-router', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  useNavigate: () => h.navigate,
  useCanGoBack: () => h.canGoBack,
  useRouter: () => ({ history: { back: h.historyBack } }),
}))

import { AddBoardPick } from './AddBoardPick'

beforeEach(() => {
  h.canGoBack = true
  h.navigate.mockClear()
  h.historyBack.mockClear()
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // reset boardStore snapshot
})

const tile = (name: string) => screen.getByText(name).closest('button')!

describe('AddBoardPick', () => {
  it('asks "Which board?" as step 1 of 2', () => {
    render(<AddBoardPick />)
    expect(screen.getByRole('heading', { name: 'Which board?' })).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
  })

  it('lists every registry board', () => {
    render(<AddBoardPick />)
    expect(BOARDS).toHaveLength(6)
    for (const board of BOARDS) expect(tile(board.name)).toBeInTheDocument()
  })

  it('marks only the added boards "You have this one"', () => {
    addBoard(3)
    render(<AddBoardPick />)
    expect(screen.getAllByText('You have this one')).toHaveLength(1)
    expect(within(tile('MoonBoard 2024')).getByText('You have this one')).toBeInTheDocument()
  })

  it('opens step 2 for a board that is not added', () => {
    render(<AddBoardPick />)
    fireEvent.click(tile('MoonBoard Masters 2019'))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/boards/add/$layoutId', params: { layoutId: '5' } })
    expect(getAddedBoardIds()).toEqual([]) // picking adds nothing
  })

  it('opens the edit page for a board that is already added, adding no second copy', () => {
    addBoard(3)
    render(<AddBoardPick />)
    fireEvent.click(tile('MoonBoard 2024'))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/boards/$layoutId/edit', params: { layoutId: '3' } })
    expect(getAddedBoardIds()).toEqual([3])
  })

  it('the back arrow goes back in history', () => {
    render(<AddBoardPick />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.historyBack).toHaveBeenCalledTimes(1)
  })
})
