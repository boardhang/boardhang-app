import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSlab,
  countSlab,
  fetchCatalogDeltas,
  getCatalogProblemsByIds,
  readSlab,
  rebuildSlab,
  syncSlab,
} from './catalogSync'
import { cacheUserProblems } from './userProblemsSync'
import type { UserProblemRow } from './userProblemsTypes'

// The module-level supabase client `syncSlab` uses. One fake, reconfigured per test via
// `h`: `pages` is served window-by-window keyed on the `range()` offset, and any offset in
// `failFrom` errors instead. (`fetchCatalogDeltas` takes its client explicitly, so the
// pagination tests below ignore this.)
const h = vi.hoisted(() => ({
  pages: [] as Record<string, unknown>[][],
  failFrom: [] as number[],
  rangeCalls: [] as number[],
}))

vi.mock('../supabase/client', () => {
  const builder: Record<string, unknown> = {
    from: () => builder,
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    order: () => builder,
    range: (from: number) => {
      h.rangeCalls.push(from)
      if (h.failFrom.includes(from)) {
        return Promise.resolve({ data: null, error: { message: `page ${from} boom` } })
      }
      // Pages are indexed by cumulative offset, matching the caller's `from += page.length`.
      let offset = 0
      for (const page of h.pages) {
        if (offset === from) return Promise.resolve({ data: page, error: null })
        offset += page.length
      }
      return Promise.resolve({ data: [], error: null })
    },
  }
  return { supabase: builder, isConfigured: true }
})

// A minimal chainable stand-in for the supabase query builder: every filter/order
// method returns the builder; range() resolves the next queued page. We only assert on
// pagination behaviour, so page rows can be opaque.
function makeClient(pages: unknown[][], opts: { error?: unknown } = {}) {
  const rangeCalls: Array<[number, number]> = []
  const gteArgs: string[] = []
  let i = 0
  const builder: Record<string, unknown> = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn((_col: string, val: string) => {
      gteArgs.push(val)
      return builder
    }),
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      rangeCalls.push([from, to])
      if (opts.error) return Promise.resolve({ data: null, error: opts.error })
      return Promise.resolve({ data: pages[i++] ?? [], error: null })
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: builder as any, rangeCalls, gteArgs }
}

const row = (id: string) => ({ source_catalog_id: id })

describe('fetchCatalogDeltas', () => {
  it('accumulates every page and stops on the first empty page', async () => {
    const { client, rangeCalls } = makeClient([
      [row('a'), row('b')],
      [row('c')],
      [], // empty -> terminate
    ])
    const rows = await fetchCatalogDeltas(client, 7, 40, '1970-01-01T00:00:00+00:00')
    expect(rows.map((r) => (r as { source_catalog_id: string }).source_catalog_id)).toEqual(['a', 'b', 'c'])
    // Advances by the rows actually returned, not a fixed stride: 0 -> 2 -> 3.
    expect(rangeCalls.map(([from]) => from)).toEqual([0, 2, 3])
  })

  it('keeps paging when the server caps pages BELOW the requested size (the truncation bug)', async () => {
    // Every page is shorter than PAGE_SIZE (1000) yet non-empty: the old `length < PAGE_SIZE`
    // break would have stopped after page 1 and silently truncated the slab.
    const { client } = makeClient([[row('a'), row('b')], [row('c'), row('d')], []])
    const rows = await fetchCatalogDeltas(client, 7, 40, '1970-01-01T00:00:00+00:00')
    expect(rows).toHaveLength(4)
  })

  it('filters with >= cursor so a row sharing the cursor timestamp is not skipped', async () => {
    const { client, gteArgs } = makeClient([[]])
    await fetchCatalogDeltas(client, 7, 40, '2026-01-01T00:00:00+00:00')
    expect(gteArgs).toEqual(['2026-01-01T00:00:00+00:00'])
  })

  it('propagates a query error instead of returning a partial slab', async () => {
    const { client, rangeCalls } = makeClient([], { error: { message: 'boom' } })
    await expect(fetchCatalogDeltas(client, 7, 40, '1970-01-01T00:00:00+00:00')).rejects.toBeDefined()
    // Retried before giving up: one flaky page must not discard the pages already fetched.
    expect(rangeCalls).toHaveLength(3)
  })

  it('retries a transient page failure and completes the pull', async () => {
    const pages = [[row('a')], [row('b')], []]
    let i = 0
    let failedOnce = false
    const builder: Record<string, unknown> = {
      from: () => builder,
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      order: () => builder,
      range: () => {
        if (i === 1 && !failedOnce) {
          failedOnce = true
          return Promise.resolve({ data: null, error: { message: 'flaky' } })
        }
        return Promise.resolve({ data: pages[i++] ?? [], error: null })
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchCatalogDeltas(builder as any, 7, 40, '1970-01-01T00:00:00+00:00')
    expect(rows).toHaveLength(2)
  })
})

// ─── syncSlab / cache maintenance (IndexedDB-backed) ──────────────────────────

const catalogRow = (id: string, updatedAt: string, over: Record<string, unknown> = {}) => ({
  source_catalog_id: id,
  layout_id: 7,
  angle: 40,
  name: `Problem ${id}`,
  grade: '6B',
  user_grade: null,
  setter: 'setter',
  stars: 3,
  repeats: 10,
  is_benchmark: false,
  method: null,
  holds: [],
  updated_at: updatedAt,
  deleted: false,
  ...over,
})

const CURSOR_KEY = 'catalogCursor.7_40'

describe('syncSlab cache maintenance', () => {
  beforeEach(() => {
    // Fresh IndexedDB + localStorage per test so slabs and cursors can't leak between them.
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    h.pages = []
    h.failFrom = []
    h.rangeCalls = []
  })

  it('keeps the pages that landed when a later page fails, and resumes from there', async () => {
    h.pages = [
      [catalogRow('a', '2026-01-01T00:00:00+00:00'), catalogRow('b', '2026-01-02T00:00:00+00:00')],
      [catalogRow('c', '2026-01-03T00:00:00+00:00')],
    ]
    h.failFrom = [2] // second window dies, after page one committed

    const first = await syncSlab(7, 40)
    expect(first.synced).toBe(false)
    expect(first.error).toContain('boom')
    // The all-or-nothing version discarded these; they must be cached and the cursor
    // parked on the last committed page.
    expect(first.problems.map((p) => p.source_catalog_id)).toEqual(['a', 'b'])
    expect(localStorage.getItem(CURSOR_KEY)).toBe('2026-01-02T00:00:00+00:00')

    // Retry: the network recovers and the pull picks up where it stopped.
    h.failFrom = []
    h.pages = [[catalogRow('c', '2026-01-03T00:00:00+00:00')]]
    const second = await syncSlab(7, 40)
    expect(second.synced).toBe(true)
    expect(second.problems.map((p) => p.source_catalog_id)).toEqual(['a', 'b', 'c'])
    expect(localStorage.getItem(CURSOR_KEY)).toBe('2026-01-03T00:00:00+00:00')
  })

  it('applies deletions and counts only the requested slab', async () => {
    h.pages = [
      [
        catalogRow('a', '2026-01-01T00:00:00+00:00'),
        catalogRow('b', '2026-01-01T00:00:00+00:00'),
        catalogRow('other', '2026-01-01T00:00:00+00:00', { layout_id: 5, angle: 25 }),
        catalogRow('a', '2026-01-02T00:00:00+00:00', { deleted: true }),
      ],
    ]
    await syncSlab(7, 40)
    expect(await countSlab(7, 40)).toBe(1)
    expect(await countSlab(5, 25)).toBe(1)
  })

  it('clearSlab drops that slab and its cursor, leaving other boards cached', async () => {
    h.pages = [
      [
        catalogRow('a', '2026-01-01T00:00:00+00:00'),
        catalogRow('other', '2026-01-01T00:00:00+00:00', { layout_id: 5, angle: 25 }),
      ],
    ]
    await syncSlab(7, 40)
    expect(localStorage.getItem(CURSOR_KEY)).not.toBeNull()

    await clearSlab(7, 40)
    expect(await countSlab(7, 40)).toBe(0)
    expect(await countSlab(5, 25)).toBe(1)
    expect(localStorage.getItem(CURSOR_KEY)).toBeNull()
  })

  it('rebuildSlab re-downloads from scratch and prunes rows the server no longer has', async () => {
    h.pages = [[catalogRow('stale', '2026-01-01T00:00:00+00:00'), catalogRow('a', '2026-01-01T00:00:00+00:00')]]
    await syncSlab(7, 40)
    expect(await countSlab(7, 40)).toBe(2)

    // The server dropped `stale` without a tombstone (a re-import) — only a rebuild,
    // which wipes first, can notice.
    h.pages = [[catalogRow('a', '2026-01-01T00:00:00+00:00')]]
    h.rangeCalls = []
    const result = await rebuildSlab(7, 40)
    expect(result.synced).toBe(true)
    expect(result.problems.map((p) => p.source_catalog_id)).toEqual(['a'])
    // Re-pulled from the epoch, not from the cursor the earlier sync parked.
    expect(h.rangeCalls[0]).toBe(0)
    expect(await readSlab(7, 40)).toHaveLength(1)
  })

  it('leaves the slab empty but recoverable when a rebuild cannot reach the server', async () => {
    h.pages = [[catalogRow('a', '2026-01-01T00:00:00+00:00')]]
    await syncSlab(7, 40)

    h.failFrom = [0]
    const failed = await rebuildSlab(7, 40)
    expect(failed.synced).toBe(false)
    expect(failed.problems).toEqual([])

    h.failFrom = []
    const recovered = await syncSlab(7, 40)
    expect(recovered.synced).toBe(true)
    expect(recovered.problems).toHaveLength(1)
  })
})

// ─── Merging user-authored problems (the second database) ─────────────────────

const userRow = (id: string, over: Partial<UserProblemRow> = {}): UserProblemRow => ({
  id,
  user_id: 'author-1',
  name: `Custom ${id}`,
  grade: '6C',
  holds: [{ c: 3, r: 4, t: 'start' }],
  layout_id: 7,
  angle: 40,
  visibility: 'private',
  source_catalog_id: `user:${id}`,
  updated_at: '2026-01-01T00:00:00+00:00',
  deleted: false,
  ...over,
})

describe('merging user-authored problems into the catalog', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    h.pages = []
    h.failFrom = []
    h.rangeCalls = []
  })

  it('lists imported and custom rows together, sorted, and only for the slab asked for', async () => {
    h.pages = [
      [
        catalogRow('imported-b', '2026-01-01T00:00:00+00:00', { name: 'Beta', grade: '6B' }),
        catalogRow('imported-z', '2026-01-01T00:00:00+00:00', { name: 'Zeta', grade: '7A' }),
      ],
    ]
    await syncSlab(7, 40)
    await cacheUserProblems([
      userRow('one', { name: 'Alpha', grade: '6A' }),
      userRow('two', { name: 'Aardvark', grade: '6B' }),
      userRow('elsewhere', { name: 'Other board', layout_id: 5, angle: 25 }),
    ])

    // One list ordered by (grade, name) across both databases — a custom problem is not
    // appended after the imported ones, it sorts among them.
    expect((await readSlab(7, 40)).map((p) => p.name)).toEqual([
      'Alpha',
      'Aardvark',
      'Beta',
      'Zeta',
    ])
    // The custom row authored on another board+angle stays out of this slab.
    expect((await readSlab(5, 25)).map((p) => p.name)).toEqual(['Other board'])
  })

  it('resolves catalog ids and user ids in one call, leaving unknown ids absent', async () => {
    h.pages = [[catalogRow('imported', '2026-01-01T00:00:00+00:00')]]
    await syncSlab(7, 40)
    await cacheUserProblems([userRow('one')])

    const found = await getCatalogProblemsByIds(['imported', 'user:one', 'user:gone', 'nope'])

    expect([...found.keys()].sort()).toEqual(['imported', 'user:one'])
    expect(found.get('user:one')?.name).toBe('Custom one')
  })

  it('gives a custom problem the zero-values of the imported catalog stats it has none of', async () => {
    await cacheUserProblems([userRow('one')])
    const resolved = (await getCatalogProblemsByIds(['user:one'])).get('user:one')

    expect(resolved).toMatchObject({
      source_catalog_id: 'user:one',
      layout_id: 7,
      angle: 40,
      name: 'Custom one',
      grade: '6C',
      user_grade: null,
      setter: '',
      stars: 0,
      repeats: 0,
      is_benchmark: false,
      method: null,
      holds: [{ c: 3, r: 4, t: 'start' }],
    })
  })

  it('keeps custom problems through a rebuild, which only wipes the imported cache (AE4)', async () => {
    h.pages = [[catalogRow('imported', '2026-01-01T00:00:00+00:00', { name: 'Imported' })]]
    await syncSlab(7, 40)
    await cacheUserProblems([userRow('one', { name: 'Mine' })])
    expect(await readSlab(7, 40)).toHaveLength(2)

    // Settings → "Rebuild catalog": the destructive path. It must not be able to destroy
    // something the user authored — that data exists nowhere else on this device.
    const rebuilt = await rebuildSlab(7, 40)
    expect(rebuilt.synced).toBe(true)
    expect(rebuilt.problems.map((p) => p.name)).toEqual(['Imported', 'Mine'])
    // countSlab reports the imported cache only, which is what the rebuild acts on.
    expect(await countSlab(7, 40)).toBe(1)
  })

  it('never lists a legacy row with no board, but still resolves it by id (R14)', async () => {
    await cacheUserProblems([
      userRow('legacy', { name: 'From iOS', layout_id: null, angle: null }),
    ])

    expect(await readSlab(7, 40)).toEqual([])
    const resolved = (await getCatalogProblemsByIds(['user:legacy'])).get('user:legacy')
    expect(resolved?.name).toBe('From iOS')
  })
})
