import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTheme, resolveTheme, setTheme } from './themeStore'

// Mock matchMedia to a given system preference. jsdom ships no matchMedia, so the
// store treats "no matchMedia" as light — these tests install one when they need to
// exercise the System → dark path.
function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefersDark,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  // Reset the module-level snapshot to the stored value (empty → 'system'), the same
  // trick router.test uses to reset boardStore between tests.
  window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }))
})

afterEach(() => {
  // @ts-expect-error — allow deleting the test-installed matchMedia.
  delete window.matchMedia
})

describe('themeStore', () => {
  it('defaults to System when nothing is stored', () => {
    expect(getTheme()).toBe('system')
  })

  it('persists an explicit choice and reflects it in getTheme', () => {
    setTheme('dark')
    expect(getTheme()).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('adds the dark class on <html> for the Dark theme', () => {
    setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the dark class for the Light theme', () => {
    setTheme('dark')
    setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('resolves System via matchMedia', () => {
    mockMatchMedia(true)
    expect(resolveTheme('system')).toBe('dark')
    mockMatchMedia(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('applies the OS preference when set to System', () => {
    mockMatchMedia(true)
    setTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('updates the theme-color meta to match the resolved theme', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
    setTheme('light')
    expect(meta.getAttribute('content')).toBe('#ffffff')
    setTheme('dark')
    expect(meta.getAttribute('content')).toBe('#111111')
    meta.remove()
  })
})
