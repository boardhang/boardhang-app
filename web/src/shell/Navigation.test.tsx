import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Navigation } from './Navigation'

describe('Navigation', () => {
  it('renders the tabs and marks the current one', () => {
    render(<Navigation view="catalog" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Catalog' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'My Boards' })).not.toHaveAttribute('aria-current')
  })

  it('navigates on click', () => {
    const onNavigate = vi.fn()
    render(<Navigation view="catalog" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    expect(onNavigate).toHaveBeenCalledWith('build')
  })
})
