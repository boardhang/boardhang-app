import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getActiveBoardId } from '../board/boardStore'
import { MyBoards } from './MyBoards'

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // reset boardStore snapshot
})

/** Add a board by name from the "Add a board" list. */
function addBoard(name: string) {
  const addRow = screen.getByText(name).closest('div')!
  fireEvent.click(within(addRow).getByRole('button', { name: 'Add' }))
}

/** Open a board's config drawer. */
function openConfig(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Configure ${name}` }))
}

/** Hold-set / angle toggles in the open drawer (the aria-pressed buttons). */
const toggles = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))

describe('MyBoards', () => {
  it('shows the first-run prompt and every addable board when none are added', () => {
    render(<MyBoards onActivated={() => {}} />)
    expect(screen.getByText('Add your first board')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(5)
  })

  it('makes the first owned board active, and Browse opens its catalog', () => {
    const onActivated = vi.fn()
    render(<MyBoards onActivated={onActivated} />)
    addBoard('MoonBoard Masters 2019') // first owned board → becomes active
    expect(getActiveBoardId()).toBe(5)
    const myBoards = screen.getByText('My boards').closest('section')!
    fireEvent.click(within(myBoards).getByRole('button', { name: 'Browse' }))
    expect(onActivated).toHaveBeenCalledWith(5)
    expect(getActiveBoardId()).toBe(5) // Browse doesn't switch the active board
  })

  it('Set as active switches the active board without leaving the list', () => {
    const onActivated = vi.fn()
    render(<MyBoards onActivated={onActivated} />)
    addBoard('MoonBoard Masters 2019') // active (id 5)
    addBoard('MoonBoard Masters 2017') // owned but not active (id 4)
    const myBoards = screen.getByText('My boards').closest('section')!

    // Exactly one Browse (the active board) and one Set as active (the other).
    expect(within(myBoards).getAllByRole('button', { name: 'Browse' })).toHaveLength(1)
    const orderBefore = within(myBoards)
      .getAllByText(/MoonBoard Masters 20\d\d/)
      .map((el) => el.textContent)
    fireEvent.click(within(myBoards).getByRole('button', { name: 'Set as active' }))

    expect(getActiveBoardId()).toBe(4) // switched
    expect(onActivated).not.toHaveBeenCalled() // stayed on the list, no navigation
    // The row order does not reshuffle on activate — the badge/button swap in place.
    const orderAfter = within(myBoards)
      .getAllByText(/MoonBoard Masters 20\d\d/)
      .map((el) => el.textContent)
    expect(orderAfter).toEqual(orderBefore)
    // The Browse button (active board) is now on the board that was switched to.
    expect(within(myBoards).getAllByRole('button', { name: 'Browse' })).toHaveLength(1)
  })

  it('configures the angle from the board drawer', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('MoonBoard Masters 2019')
    openConfig('MoonBoard Masters 2019')
    expect(screen.getByRole('button', { name: '40°' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '25°' }))
    expect(screen.getByRole('button', { name: '25°' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles installed hold sets and blocks removing the last one', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('Mini MoonBoard 2025') // 4 hold sets, no angle choice
    openConfig('Mini MoonBoard 2025')
    expect(toggles()).toHaveLength(4)

    fireEvent.click(toggles()[0])
    fireEvent.click(toggles()[1])
    fireEvent.click(toggles()[2])
    const stillOn = toggles().filter((t) => t.getAttribute('aria-pressed') === 'true')
    expect(stillOn).toHaveLength(1)
    expect(stillOn[0]).toBeDisabled()
  })

  it('removes a board from its drawer after a confirm click', () => {
    render(<MyBoards onActivated={() => {}} />)
    addBoard('MoonBoard Masters 2019')
    expect(screen.getByText('My boards')).toBeInTheDocument()

    openConfig('MoonBoard Masters 2019')
    fireEvent.click(screen.getByRole('button', { name: 'Remove board' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(screen.queryByText('My boards')).toBeNull() // back to first-run
  })
})
