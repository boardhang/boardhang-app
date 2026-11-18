import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Navigation } from './Navigation'

// Navigation is fully prop-driven; the search query and its writes are owned by
// AppLayout. These props stand in for that owner.
const noop = () => {}
const baseProps = { query: '', onQueryChange: noop, onClear: noop }

const tab = (name: string) => screen.getByRole('button', { name })

describe('Navigation', () => {
  it('off the catalog shows Logbook, Lists, Settings and Search, and no Boards tab', () => {
    render(<Navigation {...baseProps} view="logbook" onNavigate={noop} />)
    expect(tab('Logbook')).toBeInTheDocument()
    expect(tab('Lists')).toBeInTheDocument()
    expect(tab('Settings')).toBeInTheDocument()
    expect(tab('Search')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Boards' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Search problems' })).toBeNull()
  })

  it('on the catalog shows Logbook, Lists and Settings beside the search field', () => {
    render(<Navigation {...baseProps} view="catalog" onNavigate={noop} />)
    expect(screen.getByRole('textbox', { name: 'Search problems' })).toBeInTheDocument()
    expect(tab('Logbook')).toBeInTheDocument()
    expect(tab('Lists')).toBeInTheDocument()
    expect(tab('Settings')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Boards' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
  })

  it('highlights no tab on a screen that belongs to none', () => {
    render(<Navigation {...baseProps} view="none" onNavigate={noop} />)
    for (const name of ['Logbook', 'Lists', 'Settings', 'Search']) {
      expect(tab(name)).not.toHaveAttribute('aria-current')
    }
  })

  it('highlights no tab on the catalog', () => {
    render(<Navigation {...baseProps} view="catalog" onNavigate={noop} />)
    for (const name of ['Logbook', 'Lists', 'Settings']) {
      expect(tab(name)).not.toHaveAttribute('aria-current')
    }
  })

  it('navigates to the catalog from the Search button', () => {
    const onNavigate = vi.fn()
    render(<Navigation {...baseProps} view="none" onNavigate={onNavigate} />)
    fireEvent.click(tab('Search'))
    expect(onNavigate).toHaveBeenCalledWith('catalog')
  })

  it('disables Search when the catalog is unreachable', () => {
    render(<Navigation {...baseProps} view="none" onNavigate={noop} disabled={['catalog']} />)
    expect(tab('Search')).toBeDisabled()
  })

  it.each([
    ['Logbook', 'logbook'],
    ['Lists', 'lists'],
    ['Settings', 'settings'],
  ] as const)('navigates to %s from the catalog and from another screen', (name, target) => {
    for (const view of ['catalog', 'none'] as const) {
      const onNavigate = vi.fn()
      const { unmount } = render(<Navigation {...baseProps} view={view} onNavigate={onNavigate} />)
      fireEvent.click(tab(name))
      expect(onNavigate).toHaveBeenCalledWith(target)
      unmount()
    }
  })

  it.each([
    ['Logbook', 'logbook'],
    ['Lists', 'lists'],
    ['Settings', 'settings'],
  ] as const)('marks %s current on its own view, keeping Search', (name, view) => {
    render(<Navigation {...baseProps} view={view} onNavigate={noop} />)
    expect(tab(name)).toHaveAttribute('aria-current', 'page')
    expect(tab('Search')).toBeInTheDocument()
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
