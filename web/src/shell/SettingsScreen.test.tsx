import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { SettingsScreen } from './SettingsScreen'
import { setTheme } from './themeStore'

// SettingsScreen renders a TanStack <Link>; stub it as a plain anchor so the screen can be
// rendered in isolation (without a RouterProvider).
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

// The logbook export section pulls in the ascents store (auth-gated) and catalog cache; it
// has its own test file. Stub it so these Settings tests stay focused on theme/previews/import
// without needing an AuthProvider.
vi.mock('../logbook/LogbookExportSection', () => ({ LogbookExportSection: () => null }))

beforeEach(() => {
  localStorage.clear()
  // Reset the previews snapshot (survives localStorage.clear()).
  window.dispatchEvent(new StorageEvent('storage'))
  document.documentElement.classList.remove('dark')
  // Deterministic start — jsdom has no matchMedia, so System resolves to light.
  setTheme('system')
})

describe('SettingsScreen', () => {
  it('renders the three appearance options', () => {
    render(<SettingsScreen />)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    for (const name of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('applies the Dark theme when the Dark segment is clicked', () => {
    render(<SettingsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('renders a preview switch per surface, all on by default', () => {
    render(<SettingsScreen />)
    for (const name of ['catalog', 'logbook', 'lists', 'last opened bar']) {
      const toggle = screen.getByRole('switch', { name: `Show climb previews in ${name}` })
      expect(toggle).toBeChecked()
    }
  })

  it('toggles one surface without touching the others', () => {
    render(<SettingsScreen />)
    fireEvent.click(screen.getByRole('switch', { name: /previews in logbook/i }))
    expect(screen.getByRole('switch', { name: /previews in logbook/i })).not.toBeChecked()
    expect(localStorage.getItem('showClimbPreviews.logbook')).toBe('false')
    expect(screen.getByRole('switch', { name: /previews in catalog/i })).toBeChecked()
    expect(localStorage.getItem('showClimbPreviews.catalog')).toBeNull()
  })

  it('links to the MoonBoard import flow', () => {
    render(<SettingsScreen />)
    const link = screen.getByRole('link', { name: /import from moonboard/i })
    expect(link).toHaveAttribute('href', '/logbook/import')
  })

  // These are the app's only links back to the content site on the apex. Without them
  // the link graph runs one way into a noindexed host, and someone who finds the app
  // first has no route to the guides — see docs/content-site.md.
  it('links out to the content site on the apex', () => {
    render(<SettingsScreen />)
    expect(screen.getByRole('link', { name: /guides/i })).toHaveAttribute(
      'href',
      'https://boardhang.app/guides',
    )
    expect(screen.getByRole('link', { name: /about boardhang/i })).toHaveAttribute(
      'href',
      'https://boardhang.app/about',
    )
  })

  // A standalone installed PWA has no back affordance, so navigating the window to
  // another origin would strand the user in the app window.
  it('opens the apex links in a new tab', () => {
    render(<SettingsScreen />)
    for (const name of [/guides/i, /about boardhang/i]) {
      const link = screen.getByRole('link', { name })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    }
  })
})
