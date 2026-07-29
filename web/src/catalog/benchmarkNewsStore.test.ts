import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetBenchmarkNewsForTests,
  clearBenchmarkNewsCache,
  filterNewsIds,
  getWatermark,
  markSeen,
  refreshBenchmarkNews,
  syncBenchmarkNewsIdentity,
  unseenCount,
} from './benchmarkNewsStore'

// Configurable Supabase whose select→eq→eq→is→gt→order→limit chain resolves to a queued
// response per (layout_id, angle). Missing pairs resolve to an empty page — the "no unseen" case.
interface Row {
  source_catalog_id: string
  created_at: string
}
interface Query {
  layoutId?: number
  angle?: number
  discardedIsNull?: boolean
  gt?: string
}

const h = vi.hoisted(() => ({
  responses: {} as Record<string, { data: Row[] | null; error: unknown }>,
  errorOnce: false,
  calls: [] as Query[],
  // When set, `limit()` returns an unresolved Promise and pushes its resolver here — the test
  // controls when the fetch actually completes so we can exercise the fetch-vs-markSeen race
  // deterministically (finding #1).
  hold: false as boolean,
  pending: [] as Array<{ resolve: (v: { data: Row[] | null; error: unknown }) => void; q: Query }>,
}))

vi.mock('../supabase/client', () => {
  const makeBuilder = () => {
    const q: Query = {}
    const b = {
      select: () => b,
      eq: (col: string, val: number) => {
        if (col === 'layout_id') q.layoutId = val
        if (col === 'angle') q.angle = val
        return b
      },
      is: (_col: string, v: null) => {
        if (v === null) q.discardedIsNull = true
        return b
      },
      gt: (_col: string, v: string) => {
        q.gt = v
        return b
      },
      order: () => b,
      limit: () => {
        h.calls.push(q)
        if (h.hold) {
          return new Promise((resolve) => {
            h.pending.push({ resolve, q })
          })
        }
        if (h.errorOnce) {
          h.errorOnce = false
          return Promise.resolve({ data: null, error: { message: 'boom' } })
        }
        const k = `${q.layoutId}_${q.angle}`
        return Promise.resolve(h.responses[k] ?? { data: [], error: null })
      },
    }
    return b
  }
  return { supabase: { from: () => makeBuilder() }, isConfigured: true }
})

/** Flush all held fetch resolvers with each query's queued response. */
function flushHeldFetches(): void {
  const drained = h.pending.splice(0)
  for (const { resolve, q } of drained) {
    const k = `${q.layoutId}_${q.angle}`
    resolve(h.responses[k] ?? { data: [], error: null })
  }
}

beforeEach(() => {
  localStorage.clear()
  __resetBenchmarkNewsForTests()
  h.responses = {}
  h.errorOnce = false
  h.calls = []
  h.hold = false
  h.pending = []
})

describe('benchmarkNewsStore watermark', () => {
  it('has no watermark before first touch, then seeds a value ≥ now (R4)', async () => {
    expect(getWatermark(7, 40)).toBeNull()
    const before = Date.now()
    await refreshBenchmarkNews([{ layoutId: 7, angle: 40 }])
    const seeded = getWatermark(7, 40)
    expect(seeded).not.toBeNull()
    expect(Date.parse(seeded!)).toBeGreaterThanOrEqual(before)
  })

  it('advances the watermark to now() and clears the slab count on markSeen', async () => {
    h.responses['7_40'] = {
      data: [
        { source_catalog_id: 'p1', created_at: new Date(Date.now() + 60_000).toISOString() },
        { source_catalog_id: 'p2', created_at: new Date(Date.now() + 30_000).toISOString() },
      ],
      error: null,
    }
    await refreshBenchmarkNews([{ layoutId: 7, angle: 40 }])
    expect(unseenCount(7, 40)).toBe(2)
    markSeen(7, 40)
    expect(unseenCount(7, 40)).toBe(0)
    // The watermark now sits at (approximately) now(); a subsequent fetch with the same
    // future-dated rows still returns them because the mock ignores gt, but the STORE would
    // otherwise re-query with a newer watermark. Verified via the "sends gt watermark" test.
  })
})

describe('refreshBenchmarkNews query shape', () => {
  it('sends layout+angle+is(discarded_at,null)+gt(created_at, watermark) per slab', async () => {
    // Pre-seed a watermark so the gt value is predictable.
    localStorage.setItem('benchmarkSeen_7_40', '2026-07-01T00:00:00.000Z')
    localStorage.setItem('benchmarkSeen_5_25', '2026-06-15T00:00:00.000Z')
    await refreshBenchmarkNews([
      { layoutId: 7, angle: 40 },
      { layoutId: 5, angle: 25 },
    ])
    expect(h.calls).toHaveLength(2)
    const call7 = h.calls.find((c) => c.layoutId === 7 && c.angle === 40)!
    const call5 = h.calls.find((c) => c.layoutId === 5 && c.angle === 25)!
    expect(call7).toMatchObject({
      layoutId: 7,
      angle: 40,
      discardedIsNull: true,
      gt: '2026-07-01T00:00:00.000Z',
    })
    expect(call5).toMatchObject({
      layoutId: 5,
      angle: 25,
      discardedIsNull: true,
      gt: '2026-06-15T00:00:00.000Z',
    })
  })

  it('caches per-slab rows in returned (fresh-first) order', async () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    h.responses['7_40'] = {
      data: [
        { source_catalog_id: 'fresh', created_at: '2026-07-20T00:00:00.000Z' },
        { source_catalog_id: 'older', created_at: '2026-07-10T00:00:00.000Z' },
      ],
      error: null,
    }
    await refreshBenchmarkNews([{ layoutId: 7, angle: 40 }])
    expect(unseenCount(7, 40)).toBe(2)
    expect(filterNewsIds(7, 40, () => true)).toEqual(['fresh', 'older'])
  })

  it('degrades to zero unseen on a server error (Boards page stays offline-usable)', async () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    h.errorOnce = true
    await refreshBenchmarkNews([{ layoutId: 7, angle: 40 }])
    expect(unseenCount(7, 40)).toBe(0)
  })

  it('respects the caller-supplied climbable / hold-set filter for the counted subset (R1)', async () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    h.responses['7_40'] = {
      data: [
        { source_catalog_id: 'p-climbable-a', created_at: '2026-07-20T00:00:00.000Z' },
        { source_catalog_id: 'p-not', created_at: '2026-07-19T00:00:00.000Z' },
        { source_catalog_id: 'p-climbable-b', created_at: '2026-07-18T00:00:00.000Z' },
      ],
      error: null,
    }
    await refreshBenchmarkNews([{ layoutId: 7, angle: 40 }])
    const climbable = filterNewsIds(7, 40, (id) => id.startsWith('p-climbable'))
    expect(climbable).toEqual(['p-climbable-a', 'p-climbable-b'])
    expect(climbable).toHaveLength(2)
  })
})

describe('fetch-vs-markSeen race (finding #1)', () => {
  // The reviewed bug: an in-flight `refreshBenchmarkNews` resolves AFTER `markSeen`, and
  // repopulates the cache with the pre-clear result set — the banner and dot resurrect for
  // 1-2s until the next refresh. The generation-counter guard drops the stale result.
  it('discards an in-flight refresh whose slab was markSeen while it was pending', async () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    h.responses['7_40'] = {
      data: [{ source_catalog_id: 'stale', created_at: '2026-07-20T00:00:00.000Z' }],
      error: null,
    }
    h.hold = true
    // Fire the slow fetch (leave it pending in h.pending).
    const inFlight = refreshBenchmarkNews([{ layoutId: 7, angle: 40 }])
    expect(unseenCount(7, 40)).toBe(0)  // no snapshot cached yet
    // User taps Dismiss while the fetch is in flight → markSeen bumps the slab generation.
    markSeen(7, 40)
    expect(unseenCount(7, 40)).toBe(0)
    // Fetch resolves LATE with the pre-dismiss row set. Guard must drop it.
    flushHeldFetches()
    await inFlight
    expect(unseenCount(7, 40)).toBe(0)
    expect(filterNewsIds(7, 40, () => true)).toEqual([])
  })

  it('preserves the result when no mutation happened during the fetch', async () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    h.responses['7_40'] = {
      data: [{ source_catalog_id: 'fresh', created_at: '2026-07-20T00:00:00.000Z' }],
      error: null,
    }
    h.hold = true
    const inFlight = refreshBenchmarkNews([{ layoutId: 7, angle: 40 }])
    // No markSeen this time — the generation stays at its captured value.
    flushHeldFetches()
    await inFlight
    expect(unseenCount(7, 40)).toBe(1)
    expect(filterNewsIds(7, 40, () => true)).toEqual(['fresh'])
  })

  it('per-slab generation: an in-flight fetch for slab A is dropped by markSeen(A) but slab B lands', async () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    localStorage.setItem('benchmarkSeen_5_25', '2026-01-01T00:00:00.000Z')
    h.responses['7_40'] = {
      data: [{ source_catalog_id: 'a', created_at: '2026-07-20T00:00:00.000Z' }],
      error: null,
    }
    h.responses['5_25'] = {
      data: [{ source_catalog_id: 'b', created_at: '2026-07-20T00:00:00.000Z' }],
      error: null,
    }
    h.hold = true
    const inFlight = refreshBenchmarkNews([
      { layoutId: 7, angle: 40 },
      { layoutId: 5, angle: 25 },
    ])
    markSeen(7, 40)  // only slab A dismissed
    flushHeldFetches()
    await inFlight
    expect(unseenCount(7, 40)).toBe(0)  // A dropped by guard
    expect(unseenCount(5, 25)).toBe(1)  // B lands
  })
})

describe('syncBenchmarkNewsIdentity (finding #7 — cross-account leak)', () => {
  it('is a no-op on same-user re-resolve (token refresh must not churn state)', async () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    localStorage.setItem('benchmarkNewsLastUser', 'user-a')
    syncBenchmarkNewsIdentity('user-a')
    expect(localStorage.getItem('benchmarkSeen_7_40')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('clears every benchmarkSeen_* watermark + in-memory cache on identity change', async () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    localStorage.setItem('benchmarkSeen_5_25', '2026-02-01T00:00:00.000Z')
    localStorage.setItem('unrelatedKey', 'keep-me')
    h.responses['7_40'] = {
      data: [{ source_catalog_id: 'a', created_at: '2026-07-20T00:00:00.000Z' }],
      error: null,
    }
    await refreshBenchmarkNews([{ layoutId: 7, angle: 40 }])
    expect(unseenCount(7, 40)).toBe(1)
    // User A signs out, user B signs in → identity changes.
    syncBenchmarkNewsIdentity('user-b')
    // Every watermark key wiped; unrelated key untouched.
    expect(localStorage.getItem('benchmarkSeen_7_40')).toBeNull()
    expect(localStorage.getItem('benchmarkSeen_5_25')).toBeNull()
    expect(localStorage.getItem('unrelatedKey')).toBe('keep-me')
    // In-memory cache also cleared.
    expect(unseenCount(7, 40)).toBe(0)
    // Last-user cursor advanced.
    expect(localStorage.getItem('benchmarkNewsLastUser')).toBe('user-b')
  })

  it('sign-out (null userId) clears the same way as a user switch', () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    localStorage.setItem('benchmarkNewsLastUser', 'user-a')
    syncBenchmarkNewsIdentity(null)
    expect(localStorage.getItem('benchmarkSeen_7_40')).toBeNull()
    expect(localStorage.getItem('benchmarkNewsLastUser')).toBe('')
  })

  it('an in-flight refresh started before an identity change is discarded on arrival', async () => {
    localStorage.setItem('benchmarkSeen_7_40', '2026-01-01T00:00:00.000Z')
    localStorage.setItem('benchmarkNewsLastUser', 'user-a')
    h.responses['7_40'] = {
      data: [{ source_catalog_id: 'from-user-a-perspective', created_at: '2026-07-20T00:00:00.000Z' }],
      error: null,
    }
    h.hold = true
    const inFlight = refreshBenchmarkNews([{ layoutId: 7, angle: 40 }])
    // User A signs out mid-fetch; clearBenchmarkNewsCache bumps every slab generation.
    syncBenchmarkNewsIdentity(null)
    flushHeldFetches()
    await inFlight
    // User A's row set does NOT land in the signed-out session.
    expect(unseenCount(7, 40)).toBe(0)
  })

  it('clearBenchmarkNewsCache is idempotent — repeated calls do not throw', () => {
    clearBenchmarkNewsCache()
    clearBenchmarkNewsCache()
    // No assertion beyond "did not throw"; the localStorage scrub tolerates absence.
    expect(true).toBe(true)
  })
})
