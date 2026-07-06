// Vitest setup: register jest-dom matchers (toBeInTheDocument, etc.) and clean
// up the DOM between tests. Referenced by `test.setupFiles` in vite.config.ts.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom defines scrollTo only as a throwing "Not implemented" stub; TanStack Router
// calls it during navigation (scroll restoration). Replace it with a no-op so
// route-level tests don't log the error.
if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as typeof window.scrollTo

  // jsdom has no matchMedia; the sonner toaster (via next-themes) reads it on mount.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
}

afterEach(() => {
  cleanup()
})
