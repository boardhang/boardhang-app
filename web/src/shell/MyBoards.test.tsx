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

  it('adds a non-default board, then activates it via Browse', () => {
    const onActivated = vi.fn()
    render(<MyBoards onActivated={onActivated} />)
    addBoard('MoonBoard Masters 2019')
    const myBoards = screen.getByText('My boards').closest('section')!
    fireEvent.click(within(myBoards).getByRole('button', { name: 'Browse' }))
    expect(onActivated).toHaveBeenCalled()
    expect(getActiveBoardId()).toBe(5)
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
