import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// Mock supabase with a chainable query builder. Two terminals:
//   - the main approved-videos query ends in .order() → resolves `nextResult`.
//   - the owner-scoped ownership query ends in .eq() and is awaited directly (the builder is
//     thenable, like the real supabase-js builder) → resolves `nextOwnResult`.
// It also carries a terminal .insert() (submitBeta), and the client exposes auth.getSession().
// `ownSelectSpy` fires when the owner-scoped .select('id') is issued, so tests can assert it is
// NOT run when signed out. All driven by per-test-controlled values below.
let nextResult: { data: unknown; error: unknown } = { data: [], error: null }
let nextOwnResult: { data: unknown; error: unknown } = { data: [], error: null }
let nextInsertResult: { error: unknown } = { error: null }
let nextSession: { data: { session: { user: { id: string } } | null } } = {
  data: { session: { user: { id: 'user-1' } } },
}
let getSessionThrows = false
const insertSpy = vi.fn()
const ownSelectSpy = vi.fn()
vi.mock('../supabase/client', () => {
  const builder: Record<string, unknown> = {}
  builder.select = (cols: string) => {
    if (cols === 'id') ownSelectSpy()
    return builder
  }
  builder.eq = () => builder
  builder.order = () => Promise.resolve(nextResult)
  builder.insert = (row: unknown) => {
    insertSpy(row)
    return Promise.resolve(nextInsertResult)
  }
  // Thenable: awaiting the builder without .order() (the owner-scoped query) resolves nextOwnResult.
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(nextOwnResult).then(resolve, reject)
  return {
    supabase: {
      from: () => builder,
      auth: {
        getSession: () =>
          getSessionThrows ? Promise.reject(new Error('session boom')) : Promise.resolve(nextSession),
      },
    },
    isConfigured: true,
  }
})

import {
  useBetaVideos,
  refetchBeta,
  submitBeta,
  syncBetaIdentity,
  _resetBetaCache,
} from './betaStore'
import type { BetaVideo } from './betaTypes'

function vid(id: string, views: number): BetaVideo {
  return {
    id, source_catalog_id: 'p1', provider: 'youtube', video_id: id,
    title: id, channel: 'c', duration_s: 30, is_short: true, views, isMine: false,
  }
}

beforeEach(() => {
  _resetBetaCache()
  nextOwnResult = { data: [], error: null }
  nextInsertResult = { error: null }
  nextSession = { data: { session: { user: { id: 'user-1' } } } }
  getSessionThrows = false
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('betaStore', () => {
  it('goes loading → ready and preserves the server (views-desc) order', async () => {
    nextResult = { data: [vid('b', 9), vid('a', 5)], error: null }
    const { result } = renderHook(() => useBetaVideos('p1'))
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.videos.map((v) => v.id)).toEqual(['b', 'a'])
  })

  it('reports a clean empty state when a problem has no betas', async () => {
    nextResult = { data: [], error: null }
    const { result } = renderHook(() => useBetaVideos('p2'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.videos).toEqual([])
  })

  it('surfaces an error and recovers on refetch', async () => {
    nextResult = { data: null, error: { message: 'boom' } }
    const { result } = renderHook(() => useBetaVideos('p3'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    nextResult = { data: [vid('x', 1)], error: null }
    act(() => refetchBeta('p3'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.videos).toHaveLength(1)
  })

  it('serves a cached entry instantly on re-open (no loading flash)', async () => {
    nextResult = { data: [vid('a', 1)], error: null }
    const first = renderHook(() => useBetaVideos('p4'))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    const second = renderHook(() => useBetaVideos('p4'))
    expect(second.result.current.status).toBe('ready')
  })
})

describe('betaStore ownership (isMine + mine-first)', () => {
  it('signed out: no owner-scoped query, order unchanged, nothing marked mine', async () => {
    nextSession = { data: { session: null } }
    nextResult = { data: [vid('b', 9), vid('a', 5)], error: null }
    const { result } = renderHook(() => useBetaVideos('p1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(ownSelectSpy).not.toHaveBeenCalled()
    expect(result.current.videos.map((v) => v.id)).toEqual(['b', 'a'])
    expect(result.current.videos.every((v) => !v.isMine)).toBe(true)
  })

  it('signed in but owns none: order unchanged, nothing marked mine', async () => {
    nextResult = { data: [vid('b', 9), vid('a', 5)], error: null }
    nextOwnResult = { data: [], error: null }
    const { result } = renderHook(() => useBetaVideos('p1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.videos.map((v) => v.id)).toEqual(['b', 'a'])
    expect(result.current.videos.every((v) => !v.isMine)).toBe(true)
  })

  it('pins a single owned clip first even when it is not the most-viewed', async () => {
    nextResult = { data: [vid('b', 9), vid('mine', 3), vid('a', 5)], error: null }
    nextOwnResult = { data: [{ id: 'mine' }], error: null }
    const { result } = renderHook(() => useBetaVideos('p1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    // 'mine' floats to the front; the rest keep views-desc (b before a).
    expect(result.current.videos.map((v) => v.id)).toEqual(['mine', 'b', 'a'])
    expect(result.current.videos.find((v) => v.id === 'mine')?.isMine).toBe(true)
    expect(result.current.videos.filter((v) => v.isMine)).toHaveLength(1)
  })

  it('pins multiple owned clips first, views-desc among themselves', async () => {
    // Mock data mirrors the DB's views-desc contract (the store partitions, it does not re-sort).
    nextResult = {
      data: [vid('b', 9), vid('mine-hi', 8), vid('a', 5), vid('mine-lo', 2)],
      error: null,
    }
    nextOwnResult = { data: [{ id: 'mine-lo' }, { id: 'mine-hi' }], error: null }
    const { result } = renderHook(() => useBetaVideos('p1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    // Both owned first (mine-hi 8 before mine-lo 2), then others views-desc (b 9, a 5).
    expect(result.current.videos.map((v) => v.id)).toEqual(['mine-hi', 'mine-lo', 'b', 'a'])
  })

  it('degrades to the plain strip when the ownership query errors (never fails the section)', async () => {
    nextResult = { data: [vid('b', 9), vid('a', 5)], error: null }
    nextOwnResult = { data: null, error: { message: 'ownership boom' } }
    const { result } = renderHook(() => useBetaVideos('p1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.videos.map((v) => v.id)).toEqual(['b', 'a'])
    expect(result.current.videos.every((v) => !v.isMine)).toBe(true)
  })

  it('skips the ownership query entirely when the problem has no betas', async () => {
    nextResult = { data: [], error: null }
    const { result } = renderHook(() => useBetaVideos('p1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(ownSelectSpy).not.toHaveBeenCalled()
  })

  it('degrades to the plain strip when the ownership lookup THROWS (not just errors)', async () => {
    nextResult = { data: [vid('b', 9), vid('a', 5)], error: null }
    getSessionThrows = true // withOwnership's try/catch must swallow a thrown rejection
    const { result } = renderHook(() => useBetaVideos('p1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.videos.map((v) => v.id)).toEqual(['b', 'a'])
    expect(result.current.videos.every((v) => !v.isMine)).toBe(true)
  })
})

describe('syncBetaIdentity', () => {
  it('re-primes a STILL-MOUNTED strip on identity change (no stuck skeleton, F1)', async () => {
    // A mounted strip: user-1 owns 'mine'. Data is views-desc (b 9, mine 3).
    nextResult = { data: [vid('b', 9), vid('mine', 3)], error: null }
    nextOwnResult = { data: [{ id: 'mine' }], error: null }
    const { result } = renderHook(() => useBetaVideos('p1')) // stays mounted across the switch
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.videos.map((v) => v.id)).toEqual(['mine', 'b'])

    // Identity switches to user-2 (owns nothing) — mirror production: session + sync id change
    // together, and set them BEFORE the sync so the re-prime fetch sees the new values.
    nextSession = { data: { session: { user: { id: 'user-2' } } } }
    nextOwnResult = { data: [], error: null }
    act(() => syncBetaIdentity('user-2'))
    // The SAME mounted hook must re-resolve to ready (not hang on the loading skeleton).
    await waitFor(() => expect(result.current.videos.map((v) => v.id)).toEqual(['b', 'mine']))
    expect(result.current.status).toBe('ready')
    expect(result.current.videos.every((v) => !v.isMine)).toBe(true)
  })

  it('is a no-op for the same identity (keeps the warm cache)', async () => {
    act(() => syncBetaIdentity('user-1')) // establish the gate, as auth restore does before first open
    nextResult = { data: [vid('a', 1)], error: null }
    const first = renderHook(() => useBetaVideos('p1'))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    act(() => syncBetaIdentity('user-1')) // same identity → cache NOT cleared
    const second = renderHook(() => useBetaVideos('p1'))
    expect(second.result.current.status).toBe('ready') // served from cache, no loading flash
  })
})

describe('submitBeta', () => {
  it('inserts a pending user row with only the clamped fields + video_id', async () => {
    await submitBeta('prob-A', 'dQw4w9WgXcQ')
    expect(insertSpy).toHaveBeenCalledWith({
      source_catalog_id: 'prob-A',
      provider: 'youtube',
      video_id: 'dQw4w9WgXcQ',
      source: 'user',
      status: 'pending',
      added_by: 'user-1',
    })
  })

  it('throws (and never inserts) when not signed in', async () => {
    nextSession = { data: { session: null } }
    await expect(submitBeta('prob-A', 'dQw4w9WgXcQ')).rejects.toThrow(/signed in/i)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('maps a 23505 duplicate to a non-leaking message', async () => {
    nextInsertResult = { error: { code: '23505', message: 'duplicate key' } }
    await expect(submitBeta('prob-A', 'dQw4w9WgXcQ')).rejects.toThrow(
      /can't be added again/i,
    )
  })

  it('surfaces a generic insert error verbatim', async () => {
    nextInsertResult = { error: { code: 'XXXXX', message: 'network down' } }
    await expect(submitBeta('prob-A', 'dQw4w9WgXcQ')).rejects.toThrow('network down')
  })

  it('does not mutate the approved-videos cache on success', async () => {
    nextResult = { data: [], error: null }
    const { result } = renderHook(() => useBetaVideos('prob-A'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await submitBeta('prob-A', 'dQw4w9WgXcQ')
    expect(result.current.videos).toEqual([]) // pending row must not appear as a card
  })
})
