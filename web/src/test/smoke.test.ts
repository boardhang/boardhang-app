// Smoke test: proves the vitest runner and jsdom environment execute.
import { describe, expect, it } from 'vitest'

describe('test harness', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })

  it('has a jsdom document', () => {
    expect(typeof document).toBe('object')
    expect(document.createElement('div')).toBeInstanceOf(HTMLElement)
  })
})
