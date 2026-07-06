import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SettingsScreen } from './SettingsScreen'
import { setTheme } from './themeStore'

beforeEach(() => {
  localStorage.clear()
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
})
