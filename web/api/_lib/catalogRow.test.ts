import { describe, expect, it, vi } from 'vitest'
import { PROBLEM_ROW_COLUMNS, fetchProblemRow, type ProblemRow } from './catalogRow.js'

const env = { VITE_SUPABASE_URL: 'https://db.example.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon-key' }

const row: ProblemRow = {
  source_catalog_id: 'abc',
  layout_id: 7,
  angle: 40,
  name: 'Chunky Monkey',
  grade: '7A',
  user_grade: null,
  setter: 'Alice',
  stars: 3,
  repeats: 12,
  is_benchmark: true,
  method: null,
  holds: [{ c: 3, r: 5, t: 'start' }],
  updated_at: '2026-09-01T10:00:00+00:00',
  deleted: false,
}

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
}

describe('fetchProblemRow', () => {
  it('resolves the row and round-trips the {c, r, t} hold shape', async () => {
    const fetch = fetchReturning(200, [row])
    const got = await fetchProblemRow('abc', { fetch, env })
    expect(got).toEqual(row)
    expect(got?.holds).toEqual([{ c: 3, r: 5, t: 'start' }])
  })

  it('queries by primary key with the anon key, the exact column list and limit=1', async () => {
    const fetch = fetchReturning(200, [row])
    await fetchProblemRow('a+b', { fetch, env })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://db.example.supabase.co/rest/v1/catalog_problems')
    expect(u.searchParams.get('source_catalog_id')).toBe('eq.a+b')
    expect(url).toContain('source_catalog_id=eq.a%2Bb')
    expect(u.searchParams.get('limit')).toBe('1')
    expect(u.searchParams.get('select')).toBe(PROBLEM_ROW_COLUMNS.join(','))
    const headers = new Headers(init.headers)
    expect(headers.get('apikey')).toBe('anon-key')
    expect(headers.get('authorization')).toBe('Bearer anon-key')
  })

  it('resolves null for an empty result', async () => {
    expect(await fetchProblemRow('abc', { fetch: fetchReturning(200, []), env })).toBeNull()
  })

  it('resolves null for a deleted row', async () => {
    expect(await fetchProblemRow('abc', { fetch: fetchReturning(200, [{ ...row, deleted: true }]), env })).toBeNull()
  })

  it('resolves null for a layout that is not in the registry', async () => {
    expect(await fetchProblemRow('abc', { fetch: fetchReturning(200, [{ ...row, layout_id: 99 }]), env })).toBeNull()
  })

  it('resolves null on a 500, a thrown fetch, and a non-JSON body', async () => {
    expect(await fetchProblemRow('abc', { fetch: fetchReturning(500, 'boom'), env })).toBeNull()
    const throwing = vi.fn(async () => {
      throw new Error('network')
    })
    expect(await fetchProblemRow('abc', { fetch: throwing, env })).toBeNull()
    expect(await fetchProblemRow('abc', { fetch: fetchReturning(200, '<html>'), env })).toBeNull()
  })

  it('resolves null without fetching when the id is empty or the env is missing', async () => {
    const fetch = fetchReturning(200, [row])
    expect(await fetchProblemRow('', { fetch, env })).toBeNull()
    expect(await fetchProblemRow('abc', { fetch, env: {} })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
