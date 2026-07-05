import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSearch } from './catalog/searchStore'
import App from './App'

// The catalog screen pulls a slab; stub it out so App tests focus on routing.
vi.mock('./catalog/useSlab', () => ({
  useSlab: () => ({ problems: [], loading: false, degraded: false }),
}))

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // reset boardStore snapshot
  clearSearch()
})

describe('App first-run routing', () => {
  it('lands on My Boards with Search disabled when no boards are added', () => {
    render(<App />)
    expect(screen.getByText('Add your first board')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  })

  it('shows the search field once a board is added', () => {
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    expect(screen.getByRole('textbox', { name: 'Search problems' })).toBeInTheDocument()
  })
})
