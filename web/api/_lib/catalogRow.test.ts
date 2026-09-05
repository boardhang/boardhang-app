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

function fetchThrowing(name?: string) {
  return vi.fn(async () => {
    const e = new Error('boom')
    if (name) e.name = name
    throw e
  })
}

describe('fetchProblemRow', () => {
  it('resolves the row and round-trips the {c, r, t} hold shape', async () => {
    const got = await fetchProblemRow('abc', { fetch: fetchReturning(200, [row]), env })
    expect(got.row).toEqual(row)
    expect(got.reason).toBeUndefined()
    expect(got.row?.holds).toEqual([{ c: 3, r: 5, t: 'start' }])
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

  it.each([
    ['not-found', fetchReturning(200, [])],
    ['deleted', fetchReturning(200, [{ ...row, deleted: true }])],
    ['unknown-layout', fetchReturning(200, [{ ...row, layout_id: 99 }])],
    ['http-500', fetchReturning(500, 'boom')],
    ['http-401', fetchReturning(401, '{"message":"bad key"}')],
    ['network', fetchThrowing()],
    ['timeout', fetchThrowing('TimeoutError')],
    ['malformed', fetchReturning(200, '<html>')],
    ['malformed', fetchReturning(200, { not: 'an array' })],
    ['malformed', fetchReturning(200, [{ source_catalog_id: 'abc', layout_id: 7 }])],
    ['malformed', fetchReturning(200, [{ ...row, holds: [{ c: 'x', r: 1, t: 'start' }] }])],
  ])('resolves { row: null, reason: %s } without throwing', async (reason, fetch) => {
    expect(await fetchProblemRow('abc', { fetch, env })).toEqual({ row: null, reason })
  })

  it('resolves bad-id or unconfigured without fetching', async () => {
    const fetch = fetchReturning(200, [row])
    expect(await fetchProblemRow('', { fetch, env })).toEqual({ row: null, reason: 'bad-id' })
    expect(await fetchProblemRow('a b', { fetch, env })).toEqual({ row: null, reason: 'bad-id' })
    expect(await fetchProblemRow('x'.repeat(129), { fetch, env })).toEqual({ row: null, reason: 'bad-id' })
    expect(await fetchProblemRow('abc', { fetch, env: {} })).toEqual({ row: null, reason: 'unconfigured' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
