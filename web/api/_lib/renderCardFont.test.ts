// @vitest-environment node
// A failed font read must not be memoised: Vercel reuses warm module instances, so a
// cached rejection would poison every later card on that instance.

import { readFile } from 'node:fs/promises'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return { ...real, readFile: vi.fn(real.readFile) }
})

import { renderCard } from './renderCard.js'

afterEach(() => {
  vi.mocked(readFile).mockReset()
})

describe('renderCard font memo', () => {
  it('retries the font read after a failure instead of caching the rejection', async () => {
    const real = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).readFile
    vi.mocked(readFile).mockRejectedValueOnce(new Error('EIO: transient'))
    vi.mocked(readFile).mockImplementation(real as typeof readFile)

    const element = h('div', { style: { display: 'flex', width: 1200, height: 630, color: '#fff' } }, 'retry')
    await expect(renderCard(element, { headers: {} })).rejects.toThrow('EIO: transient')

    const res = await renderCard(element, { headers: {} })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    // Two font reads: the failed one and the retry (later calls reuse the memo).
    expect(vi.mocked(readFile).mock.calls.length).toBeGreaterThanOrEqual(2)
  }, 60_000)
})
