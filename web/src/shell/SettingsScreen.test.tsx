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

// The privacy card reads useAuth; in isolation there's no provider, so stub it signed-out
// (the card then renders nothing, leaving the rest of the settings screen unchanged).
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'signedOut', profile: null, setPrivacyChoice: vi.fn() }),
}))

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
})
