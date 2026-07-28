import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readSlab } from './catalogSync'
import { userProblemCatalogId, type UserProblemRow } from './userProblemsTypes'
import {
  cacheUserProblems,
  clearOwnUserProblems,
  currentCacheGeneration,
  eachUserProblemDeltaPage,
  getUserProblemsByIds,
  hasUserProblemsCursor,
  ownUserProblemIds,
  readCachedUserId,
  readUserProblemsForSlab,
  setCachedUserId,
  syncUserProblems,
  USER_PROBLEMS_PAGE_SIZE,
} from './userProblemsSync'

// One fake supabase client for the module-level `supabase` that syncUserProblems uses.
// `pages` is served window-by-window keyed on the `range()` offset (matching the caller's
// `from += page.length`), and `deferred` lets a test hold a page in flight so the identity
// clear can race it. (`eachUserProblemDeltaPage` takes its client explicitly, so the
// pagination tests below drive their own.)
const h = vi.hoisted(() => ({
  pages: [] as UserProblemRow[][],
  failFrom: [] as number[],
  gteArgs: [] as string[],
  eqArgs: [] as Array<[string, unknown]>,
  rangeCalls: [] as Array<[number, number]>,
  deferred: null as null | { release: (rows: UserProblemRow[]) => void },
}))

vi.mock('../supabase/client', () => {
  const builder: Record<string, unknown> = {
    from: () => builder,
    select: () => builder,
    eq: (col: string, val: unknown) => {
      h.eqArgs.push([col, val])
      return builder
    },
    gte: (_col: string, val: string) => {
      h.gteArgs.push(val)
      return builder
    },
    order: () => builder,
    range: (from: number, to: number) => {
      h.rangeCalls.push([from, to])
      if (h.failFrom.includes(from)) {
        return Promise.resolve({ data: null, error: { message: `page ${from} boom` } })
      }
      if (h.deferred) {
        return new Promise((resolve) => {
          h.deferred = {
            release: (rows) => resolve({ data: rows, error: null }),
          }
        })
      }
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

const CURSOR_KEY = 'userProblemsCursor'
const OWNER = 'user-A'

function row(id: string, updatedAt: string, overrides: Partial<UserProblemRow> = {}): UserProblemRow {
  return {
    id,
    user_id: OWNER,
    name: `Problem ${id}`,
    grade: '6B',
    holds: [{ c: 1, r: 2, t: 'start' }],
    layout_id: 7,
    angle: 40,
    visibility: 'private',
    source_catalog_id: userProblemCatalogId(id),
    updated_at: updatedAt,
    deleted: false,
    ...overrides,
  }
}

beforeEach(() => {
  // Fresh IndexedDB + cursor per test.
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  h.pages = []
  h.failFrom = []
  h.gteArgs = []
  h.eqArgs = []
  h.rangeCalls = []
  h.deferred = null
})

describe('syncUserProblems — own-rows delta pull', () => {
  it('upserts changed rows, deletes tombstoned ones, and advances the cursor', async () => {
    h.pages = [[row('a', '2026-01-01T00:00:00+00:00'), row('b', '2026-01-02T00:00:00+00:00')]]
    const first = await syncUserProblems(OWNER)
    expect(first.synced).toBe(true)
    expect((await readUserProblemsForSlab(7, 40)).map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(localStorage.getItem(CURSOR_KEY)).toBe('2026-01-02T00:00:00+00:00')

    // A later delta tombstones `a` and edits `b`.
    h.rangeCalls = []
    h.pages = [
      [
        row('a', '2026-01-03T00:00:00+00:00', { deleted: true }),
        row('b', '2026-01-04T00:00:00+00:00', { name: 'Renamed' }),
      ],
    ]
    await syncUserProblems(OWNER)
    const after = await readUserProblemsForSlab(7, 40)
    expect(after.map((p) => p.id)).toEqual(['b'])
    expect(after[0].name).toBe('Renamed')
    expect(localStorage.getItem(CURSOR_KEY)).toBe('2026-01-04T00:00:00+00:00')
  })

  it('scopes the pull to the caller and re-reads the cursor boundary with >=', async () => {
    localStorage.setItem(CURSOR_KEY, '2026-01-02T00:00:00+00:00')
    h.pages = [[row('a', '2026-01-02T00:00:00+00:00')]]
    await syncUserProblems(OWNER)
    // `>=`, not `>`: a strict `>` would permanently skip a row stamped exactly at the
    // cursor — realistic when one batch stamps several rows with the same updated_at.
    expect(h.gteArgs).toContain('2026-01-02T00:00:00+00:00')
    // Own rows only: RLS scopes it today, but 0019's public read policy would otherwise
    // start feeding other users' rows into this cursor-based own-rows pull.
    expect(h.eqArgs).toContainEqual(['user_id', OWNER])
  })

  it('syncs a pull spanning more than one page completely', async () => {
    const total = USER_PROBLEMS_PAGE_SIZE + 3
    const all = Array.from({ length: total }, (_, i) =>
      row(`p${String(i).padStart(5, '0')}`, `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}+00:00`),
    )
    h.pages = [all.slice(0, USER_PROBLEMS_PAGE_SIZE), all.slice(USER_PROBLEMS_PAGE_SIZE)]
    const result = await syncUserProblems(OWNER)
    expect(result.synced).toBe(true)
    expect(await readUserProblemsForSlab(7, 40)).toHaveLength(total)
    // Terminated on the EMPTY page, advancing by rows returned — not after one short page.
    expect(h.rangeCalls.map(([from]) => from)).toEqual([0, USER_PROBLEMS_PAGE_SIZE, total])
  })

  it('reports a failed pull without advancing the cursor', async () => {
    h.failFrom = [0]
    const result = await syncUserProblems(OWNER)
    expect(result.synced).toBe(false)
    expect(result.error).toContain('boom')
    expect(hasUserProblemsCursor()).toBe(false)
  })

  it('notifies once per applied page', async () => {
    h.pages = [[row('a', '2026-01-01T00:00:00+00:00')], [row('b', '2026-01-02T00:00:00+00:00')]]
    const onApplied = vi.fn()
    await syncUserProblems(OWNER, onApplied)
    expect(onApplied).toHaveBeenCalledTimes(2)
  })
})

describe('eachUserProblemDeltaPage — pagination shape', () => {
  function makeClient(pages: unknown[][]) {
    const rangeCalls: Array<[number, number]> = []
    let i = 0
    const builder: Record<string, unknown> = {
      from: () => builder,
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      order: () => builder,
      range: (from: number, to: number) => {
        rangeCalls.push([from, to])
        return Promise.resolve({ data: pages[i++] ?? [], error: null })
      },
    }
    return { client: builder as never, rangeCalls }
  }

  it('advances by the rows actually returned, so a short page is not the last page', async () => {
    // A server whose max-rows cap sits BELOW our page size returns short pages. Advancing
    // by a fixed stride would leave gaps; advancing by page.length cannot.
    const { client, rangeCalls } = makeClient([[{ id: '1' }, { id: '2' }], [{ id: '3' }], []])
    const seen: unknown[] = []
    await eachUserProblemDeltaPage(client, OWNER, '1970-01-01T00:00:00+00:00', (page) => {
      seen.push(...page)
    })
    expect(seen).toHaveLength(3)
    expect(rangeCalls.map(([from]) => from)).toEqual([0, 2, 3])
  })
})

describe('cache reads', () => {
  it('keeps rows out of the catalog database and off other slabs', async () => {
    await cacheUserProblems([row('a', '2026-01-01T00:00:00+00:00')])
    expect((await readUserProblemsForSlab(7, 40)).map((p) => p.sourceCatalogId)).toEqual(['user:a'])
    expect(await readUserProblemsForSlab(7, 25)).toEqual([])
    // Separate IndexedDB database (KTD3) — the catalog cache is untouched.
    expect(await readSlab(7, 40)).toEqual([])
  })

  it('never surfaces a legacy row with no board in a slab read, but still resolves it by id', async () => {
    const legacy = row('legacy', '2020-01-01T00:00:00+00:00', {
      layout_id: null,
      angle: null,
      name: '',
      holds: [],
    })
    await cacheUserProblems([legacy, row('a', '2026-01-01T00:00:00+00:00')])
    expect((await readUserProblemsForSlab(7, 40)).map((p) => p.id)).toEqual(['a'])
    const byId = await getUserProblemsByIds(['user:legacy', 'user:missing'])
    expect(byId.get('user:legacy')?.layoutId).toBeNull()
    expect(byId.has('user:missing')).toBe(false)
  })

  it('lists the cached identity’s own ids only', async () => {
    await setCachedUserId(OWNER)
    await cacheUserProblems([
      row('mine', '2026-01-01T00:00:00+00:00'),
      row('theirs', '2026-01-01T00:00:00+00:00', { user_id: 'user-B', visibility: 'public' }),
    ])
    expect([...(await ownUserProblemIds())]).toEqual(['user:mine'])
  })
})

describe('identity clearing', () => {
  it('removes the outgoing user’s own rows and cursor, keeping another user’s public row', async () => {
    await setCachedUserId(OWNER)
    localStorage.setItem(CURSOR_KEY, '2026-01-02T00:00:00+00:00')
    await cacheUserProblems([
      row('mine', '2026-01-01T00:00:00+00:00'),
      row('theirs', '2026-01-01T00:00:00+00:00', { user_id: 'user-B', visibility: 'public' }),
    ])

    await clearOwnUserProblems(OWNER)

    // Own rows are private and must not paint for the next user; a cached public row from
    // someone else carries no private data, so it survives the sign-out.
    expect((await readUserProblemsForSlab(7, 40)).map((p) => p.id)).toEqual(['theirs'])
    expect(hasUserProblemsCursor()).toBe(false)
  })

  it('drops an in-flight pull that started under the previous generation', async () => {
    await setCachedUserId(OWNER)
    h.deferred = { release: () => {} }
    const pull = syncUserProblems(OWNER)
    // Let the mocked range() install its resolver before racing the clear.
    await Promise.resolve()
    await Promise.resolve()

    await clearOwnUserProblems(OWNER)
    const genAfterClear = currentCacheGeneration()

    h.deferred?.release([row('late', '2026-06-01T00:00:00+00:00')])
    await pull

    // The previous user's rows must not re-poison the just-cleared cache, and the cursor
    // must stay un-armed so the next user does a full cold pull.
    expect(await readUserProblemsForSlab(7, 40)).toEqual([])
    expect(hasUserProblemsCursor()).toBe(false)
    expect(currentCacheGeneration()).toBe(genAfterClear)
  })

  it('drops a write-through whose captured generation is stale', async () => {
    const gen = currentCacheGeneration()
    await clearOwnUserProblems(OWNER)
    await cacheUserProblems([row('a', '2026-01-01T00:00:00+00:00')], gen)
    expect(await readUserProblemsForSlab(7, 40)).toEqual([])
  })

  it('tracks the cached identity across a switch', async () => {
    expect(await readCachedUserId()).toBe('')
    await setCachedUserId(OWNER)
    expect(await readCachedUserId()).toBe(OWNER)
    await setCachedUserId('')
    expect(await readCachedUserId()).toBe('')
  })
})
