import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProblemRow } from './catalogRow.js'
import { IMAGE_CACHE_CONTROL, handleOgImage } from './ogImage.js'
import { problemImageSearch, problemImageVersion } from './problemMeta.js'

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
const v = problemImageVersion(row)
const canonical = problemImageSearch(row)

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
}

function deps(overrides: Partial<Parameters<typeof handleOgImage>[1]> = {}) {
  return {
    fetch: fetchReturning(200, [row]),
    env,
    loadArt: vi.fn(async () => ['data:image/png;base64,AAAA']),
    render: vi.fn(async (_element: unknown, opts: { headers: Record<string, string> }) =>
      new Response('PNG', { status: 200, headers: { 'content-type': 'image/png', ...opts.headers } }),
    ),
    ...overrides,
  }
}

function request(search: string) {
  return new Request(`https://preview.example/api/og-image${search}`, { headers: { host: 'preview.example' } })
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('handleOgImage', () => {
  it('uses a digits-only version token so the canonical URL needs no percent-encoding', () => {
    expect(v).toMatch(/^\d+$/)
    expect(canonical).toBe(`?problem=abc&v=${v}`)
  })

  it('renders the card with the CDN cache header for the canonical query', async () => {
    const d = deps()
    const res = await handleOgImage(request(canonical), d)
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

  it.each([
    ['forged v', `?problem=abc&v=forged`],
    ['missing v', `?problem=abc`],
    ['extra param', `?problem=abc&v=${v}&x=1`],
    ['reordered', `?v=${v}&problem=abc`],
    ['re-encoded id', `?problem=%61bc&v=${v}`],
  ])('redirects a non-canonical query (%s) to the canonical URL without rendering (AE10)', async (_label, search) => {
    const d = deps()
    const res = await handleOgImage(request(search), d)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`/api/og-image${canonical}`)
    expect(res.headers.get('cache-control')).toContain('s-maxage')
    expect(d.render).not.toHaveBeenCalled()
    expect(d.loadArt).not.toHaveBeenCalled()
  })

  it('redirects to the static og.png (relative) and logs the miss reason when the row is unknown', async () => {
    const d = deps({ fetch: fetchReturning(200, []) })
    const res = await handleOgImage(request(`?problem=nope&v=${v}`), d)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/og.png')
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.error).mock.calls[0][1]).toMatchObject({ problem: 'nope', reason: 'not-found' })
  })

  it('logs an operational reason distinct from not-found when Supabase fails', async () => {
    const d = deps({ fetch: fetchReturning(503, 'down') })
    await handleOgImage(request(canonical), d)
    expect(vi.mocked(console.error).mock.calls[0][1]).toMatchObject({ reason: 'http-503' })
  })

  it('redirects to og.png and logs once when rendering throws', async () => {
    const d = deps({
      render: vi.fn(async () => {
        throw new Error('satori exploded')
      }),
    })
    const res = await handleOgImage(request(canonical), d)
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
    const res = await handleOgImage(request(canonical), d)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/og.png')
    expect(console.error).toHaveBeenCalledTimes(1)
  })
})
