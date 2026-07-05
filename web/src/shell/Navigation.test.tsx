import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSearch } from '../catalog/searchStore'
import { Navigation } from './Navigation'

beforeEach(() => clearSearch()) // reset the shared search query

describe('Navigation', () => {
  it('shows the always-present search field on the catalog, with a Boards button', () => {
    render(<Navigation view="catalog" onNavigate={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'Search problems' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Boards' })).toBeInTheDocument()
  })

  it('shows Search + Boards on the boards screen, marking Boards current', () => {
    render(<Navigation view="boards" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Boards' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search problems' })).toBeNull()
  })

  it('navigates to the catalog from the Search button', () => {
    const onNavigate = vi.fn()
    render(<Navigation view="boards" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onNavigate).toHaveBeenCalledWith('catalog')
  })

  it('navigates to boards from the catalog', () => {
    const onNavigate = vi.fn()
    render(<Navigation view="catalog" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Boards' }))
    expect(onNavigate).toHaveBeenCalledWith('boards')
  })

  it('disables Search when the catalog is unreachable', () => {
    render(<Navigation view="boards" onNavigate={() => {}} disabled={['catalog']} />)
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  })

  it('clears the query via the ✕ button', () => {
    render(<Navigation view="catalog" onNavigate={() => {}} />)
    const field = screen.getByRole('textbox', { name: 'Search problems' })
    fireEvent.change(field, { target: { value: 'crimp' } })
    expect(field).toHaveValue('crimp')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(field).toHaveValue('')
  })
})
