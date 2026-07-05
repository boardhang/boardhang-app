import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeSearch } from '../catalog/searchStore'
import { Navigation } from './Navigation'

beforeEach(() => closeSearch()) // reset the shared search store

describe('Navigation', () => {
  it('marks Search active on the catalog and Boards active on boards', () => {
    const { rerender } = render(<Navigation view="catalog" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Boards' })).not.toHaveAttribute('aria-current')
    rerender(<Navigation view="boards" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Boards' })).toHaveAttribute('aria-current', 'page')
  })

  it('navigates to boards on click', () => {
    const onNavigate = vi.fn()
    render(<Navigation view="catalog" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Boards' }))
    expect(onNavigate).toHaveBeenCalledWith('boards')
  })

  it('tapping Search lands on the catalog and opens the field', () => {
    const onNavigate = vi.fn()
    render(<Navigation view="boards" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onNavigate).toHaveBeenCalledWith('catalog')
    expect(screen.getByRole('textbox', { name: 'Search problems' })).toBeInTheDocument()
  })

  it('disables Search when the catalog is unreachable', () => {
    render(<Navigation view="boards" onNavigate={() => {}} disabled={['catalog']} />)
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  })

  it('Cancel collapses the field back to the tabs', () => {
    render(<Navigation view="catalog" onNavigate={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search problems' }), {
      target: { value: 'crimp' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Search problems' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
  })
})
