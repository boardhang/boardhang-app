import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// Mock supabase with a chainable query builder whose terminal .order() resolves a
// per-test-controlled { data, error } — the shape betaStore awaits. The builder also carries a
// terminal .insert() (for submitBeta) and the client exposes auth.getSession(), both driven by
// per-test-controlled values below.
let nextResult: { data: unknown; error: unknown } = { data: [], error: null }
let nextInsertResult: { error: unknown } = { error: null }
let nextSession: { data: { session: { user: { id: string } } | null } } = {
  data: { session: { user: { id: 'user-1' } } },
}
const insertSpy = vi.fn()
vi.mock('../supabase/client', () => {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.order = () => Promise.resolve(nextResult)
  builder.insert = (row: unknown) => {
    insertSpy(row)
    return Promise.resolve(nextInsertResult)
  }
  return {
    supabase: {
      from: () => builder,
      auth: { getSession: () => Promise.resolve(nextSession) },
    },
    isConfigured: true,
  }
})

import { useBetaVideos, refetchBeta, submitBeta, _resetBetaCache } from './betaStore'
import type { BetaVideo } from './betaTypes'

function vid(id: string, views: number): BetaVideo {
  return {
    id, source_catalog_id: 'p1', provider: 'youtube', video_id: id,
    title: id, channel: 'c', duration_s: 30, is_short: true, views,
  }
}

beforeEach(() => {
  _resetBetaCache()
  nextInsertResult = { error: null }
  nextSession = { data: { session: { user: { id: 'user-1' } } } }
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
