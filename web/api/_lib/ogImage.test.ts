import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProblemRow } from './catalogRow.js'
import { IMAGE_CACHE_CONTROL, handleOgImage } from './ogImage.js'

const env = { VITE_SUPABASE_URL: 'https://db.example.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon-key' }

const row: ProblemRow = {
  source_catalog_id: 'abc',
  layout_id: 7,
  angle: 40,
  name: 'Chunky Monkey',
  grade: '7A',
  user_grade: null,
  setter: 'Alice',
  stars: 4,
  repeats: 120,
  is_benchmark: false,
  method: null,
  holds: [{ c: 2, r: 1, t: 'start' }],
  updated_at: '2026-09-01T10:00:00+00:00',
  deleted: false,
}
const v = encodeURIComponent(row.updated_at)

function fetchReturning(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
}

function deps(overrides: Partial<Parameters<typeof handleOgImage>[1]> = {}) {
  return {
    fetch: fetchReturning([row]),
    env,
    loadArt: vi.fn(async () => ['data:image/png;base64,AAAA']),
    render: vi.fn(async (_element: unknown, opts: { headers: Record<string, string> }) =>
      new Response('PNG', { status: 200, headers: { 'content-type': 'image/png', ...opts.headers } }),
    ),
    ...overrides,
  }
}

function request(query: string) {
  return new Request(`https://preview.example/api/og-image?${query}`, { headers: { host: 'preview.example' } })
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('handleOgImage', () => {
  it('renders the card with the CDN cache header when v matches the row', async () => {
    const d = deps()
    const res = await handleOgImage(request(`problem=abc&v=${v}`), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe(IMAGE_CACHE_CONTROL)
    expect(d.loadArt).toHaveBeenCalledTimes(1)
    expect(d.render).toHaveBeenCalledTimes(1)
    const [, opts] = vi.mocked(d.render).mock.calls[0] as unknown as [
      unknown,
      { width: number; height: number; headers: Record<string, string> },
    ]
    expect(opts.width).toBe(1200)
    expect(opts.height).toBe(630)
    expect(opts.headers['cache-control']).toBe(IMAGE_CACHE_CONTROL)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('redirects a stale or forged v to the canonical URL without rendering (AE10)', async () => {
    for (const query of ['problem=abc&v=forged', 'problem=abc']) {
      const d = deps()
      const res = await handleOgImage(request(query), d)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`/api/og-image?problem=abc&v=${v}`)
      expect(d.render).not.toHaveBeenCalled()
      expect(d.loadArt).not.toHaveBeenCalled()
    }
  })

  it('redirects to the static og.png (relative) and logs once when the row is unknown', async () => {
    const d = deps({ fetch: fetchReturning([]) })
    const res = await handleOgImage(request(`problem=nope&v=${v}`), d)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/og.png')
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('redirects to og.png and logs once when rendering throws', async () => {
    const d = deps({
      render: vi.fn(async () => {
        throw new Error('satori exploded')
      }),
    })
    const res = await handleOgImage(request(`problem=abc&v=${v}`), d)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/og.png')
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('redirects to og.png and logs once when the art cannot be loaded', async () => {
    const d = deps({
      loadArt: vi.fn(async () => {
        throw new Error('ENOENT')
      }),
    })
    const res = await handleOgImage(request(`problem=abc&v=${v}`), d)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/og.png')
    expect(console.error).toHaveBeenCalledTimes(1)
  })
})
