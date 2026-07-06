import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Navigation } from './Navigation'

// Navigation is fully prop-driven; the search query and its writes are owned by
// AppLayout. These props stand in for that owner.
const noop = () => {}
const baseProps = { query: '', onQueryChange: noop, onClear: noop }

describe('Navigation', () => {
  it('shows the always-present search field on the catalog, with a Boards button', () => {
    render(<Navigation {...baseProps} view="catalog" onNavigate={noop} />)
    expect(screen.getByRole('textbox', { name: 'Search problems' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Boards' })).toBeInTheDocument()
  })

  it('shows Search + Boards on the boards screen, marking Boards current', () => {
    render(<Navigation {...baseProps} view="boards" onNavigate={noop} />)
    expect(screen.getByRole('button', { name: 'Boards' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search problems' })).toBeNull()
  })

  it('navigates to the catalog from the Search button', () => {
    const onNavigate = vi.fn()
    render(<Navigation {...baseProps} view="boards" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onNavigate).toHaveBeenCalledWith('catalog')
  })

  it('navigates to boards from the catalog', () => {
    const onNavigate = vi.fn()
    render(<Navigation {...baseProps} view="catalog" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Boards' }))
    expect(onNavigate).toHaveBeenCalledWith('boards')
  })

  it('disables Search when the catalog is unreachable', () => {
    render(<Navigation {...baseProps} view="boards" onNavigate={noop} disabled={['catalog']} />)
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  })

  it('shows both home tabs on a home screen and navigates to Logbook', () => {
    const onNavigate = vi.fn()
    render(<Navigation {...baseProps} view="boards" onNavigate={onNavigate} />)
    expect(screen.getByRole('button', { name: 'Boards' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Logbook' }))
    expect(onNavigate).toHaveBeenCalledWith('logbook')
  })

  it('marks Logbook current when on the logbook view', () => {
    render(<Navigation {...baseProps} view="logbook" onNavigate={noop} />)
    expect(screen.getByRole('button', { name: 'Logbook' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search problems' })).toBeNull()
  })

  it('on the catalog shows ONLY the origin tab beside the search field', () => {
    render(<Navigation {...baseProps} view="catalog" origin="logbook" onNavigate={noop} />)
    expect(screen.getByRole('textbox', { name: 'Search problems' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Logbook' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Boards' })).toBeNull()
  })

  it('on the catalog with a Boards origin, hides the Logbook tab', () => {
    render(<Navigation {...baseProps} view="catalog" origin="boards" onNavigate={noop} />)
    expect(screen.getByRole('button', { name: 'Boards' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Logbook' })).toBeNull()
  })

  it('shows the Settings tab on a home screen and navigates to it', () => {
    const onNavigate = vi.fn()
    render(<Navigation {...baseProps} view="boards" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('marks Settings current when on the settings view, keeping Search rightmost', () => {
    render(<Navigation {...baseProps} view="settings" onNavigate={noop} />)
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
  })

  it('on the catalog with a Settings origin, shows only the Settings tab beside search', () => {
    const onNavigate = vi.fn()
    render(<Navigation {...baseProps} view="catalog" origin="settings" onNavigate={onNavigate} />)
    expect(screen.getByRole('textbox', { name: 'Search problems' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Boards' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Logbook' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('reports typing through onQueryChange and clearing through onClear', () => {
    const onQueryChange = vi.fn()
    const onClear = vi.fn()
    render(
      <Navigation
        view="catalog"
        onNavigate={noop}
        query="crimp"
        onQueryChange={onQueryChange}
        onClear={onClear}
      />,
    )
    const field = screen.getByRole('textbox', { name: 'Search problems' })
    expect(field).toHaveValue('crimp')
    fireEvent.change(field, { target: { value: 'crimpy' } })
    expect(onQueryChange).toHaveBeenCalledWith('crimpy')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onClear).toHaveBeenCalled()
  })
})
