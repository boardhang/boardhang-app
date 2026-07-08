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

  // jsdom has no PointerEvent; base-ui controls (e.g. Checkbox) construct one on click.
  // Polyfill a minimal subclass of MouseEvent so pointer-driven handlers run in tests.
  if (typeof window.PointerEvent !== 'function') {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number
      pointerType: string
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params)
        this.pointerId = params.pointerId ?? 0
        this.pointerType = params.pointerType ?? 'mouse'
      }
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof window.PointerEvent
  }

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
