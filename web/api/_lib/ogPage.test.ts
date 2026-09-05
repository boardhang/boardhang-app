import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProblemRow } from './catalogRow.js'
import { handleOgPage } from './ogPage.js'

const env = {
  VITE_SUPABASE_URL: 'https://db.example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VERCEL_URL: 'preview.example',
}

const row: ProblemRow = {
  source_catalog_id: 'abc',
  layout_id: 2,
  angle: 40,
  name: 'Chunky Monkey',
  grade: '7A',
  user_grade: null,
  setter: 'Alice',
  stars: 4,
  repeats: 120,
  is_benchmark: false,
  method: null,
  holds: [{ c: 0, r: 1, t: 'start' }],
  updated_at: '2026-09-01T10:00:00+00:00',
  deleted: false,
}

function fetchReturning(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
}

function request(query: string, host = 'preview.example') {
  return new Request(`https://${host}/api/og-page?${query}`, { headers: { host } })
}

function meta(html: string, key: string): string | null {
  const m = html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))
  return m ? m[1] : null
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('handleOgPage', () => {
  it('returns the per-problem document on the request host, never cached, and reads Supabase with the anon key', async () => {
    const fetch = fetchReturning([row])
    const res = await handleOgPage(request('layoutId=2&problem=abc'), { fetch, env })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(meta(html, 'og:title')).toBe('Chunky Monkey 7A')
    expect(meta(html, 'og:url')).toMatch(/^https:\/\/preview\.example\/board\/2\/catalog/)
    expect(meta(html, 'og:image')).toMatch(/^https:\/\/preview\.example\/api\/og-image\?problem=abc/)
    expect(html.match(/property="og:title"/g)).toHaveLength(1)
    const headers = new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers)
    expect(headers.get('apikey')).toBe('anon-key')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('falls back to the canonical origin for a spoofed host', async () => {
    const res = await handleOgPage(request('layoutId=2&problem=abc', 'evil.example'), { fetch: fetchReturning([row]), env })
    const html = await res.text()
    expect(meta(html, 'og:url')).toMatch(/^https:\/\/www\.boardhang\.app\//)
    expect(meta(html, 'og:image')).toMatch(/^https:\/\/www\.boardhang\.app\//)
  })

  it.each([
    ['unknown id', 'layoutId=2&problem=nope', fetchReturning([])],
    ['missing problem', 'layoutId=2', fetchReturning([row])],
    ['layout mismatch', 'layoutId=7&problem=abc', fetchReturning([row])],
    [
      'reader throws',
      'layoutId=2&problem=abc',
      vi.fn(async () => {
        throw new Error('boom')
      }),
    ],
  ])('serves the generic document (200, no-store) and logs once when %s', async (_label, query, fetch) => {
    const res = await handleOgPage(request(query), { fetch, env })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(meta(html, 'og:title')).toBe('Boardhang')
    expect(meta(html, 'og:image')).toBe('https://preview.example/og.png')
    expect(console.error).toHaveBeenCalledTimes(1)
  })
})
