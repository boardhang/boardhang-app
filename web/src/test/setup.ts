// Vitest setup: register jest-dom matchers (toBeInTheDocument, etc.) and clean
// up the DOM between tests. Referenced by `test.setupFiles` in vite.config.ts.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
