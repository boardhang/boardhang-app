import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogProblem, SyncResult } from './catalogSync'
import { readSlab, syncSlab } from './catalogSync'
import { useSlab } from './useSlab'

vi.mock('./catalogSync', () => ({
  readSlab: vi.fn(),
  syncSlab: vi.fn(),
}))

const readSlabMock = vi.mocked(readSlab)
const syncSlabMock = vi.mocked(syncSlab)

function problem(id: string): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: 7,
    angle: 40,
    name: `Problem ${id}`,
    grade: '6A',
    user_grade: null,
    setter: 'setter',
    stars: 3,
    repeats: 10,
    is_benchmark: false,
    method: null,
    holds: [],
  }
}

const synced = (problems: CatalogProblem[]): SyncResult => ({ problems, synced: true })

/** A promise whose resolution is controlled by the test, for ordering races. */
function defer<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSlab', () => {
  it('returns the cached slab and resolves without error', async () => {
    const cached = [problem('a')]
    readSlabMock.mockResolvedValue(cached)
    syncSlabMock.mockResolvedValue(synced(cached))

    const { result } = renderHook(() => useSlab(7, 40))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems).toEqual(cached)
    expect(result.current.degraded).toBe(false)
    expect(readSlabMock).toHaveBeenCalledWith(7, 40)
  })

  it('flags degraded when the sync could not reach the server but cache is served', async () => {
    // The real degraded path: syncSlab resolves (never throws) with synced:false
    // because the network pull failed while the browser still reports online.
    const cached = [problem('b')]
    readSlabMock.mockResolvedValue(cached)
    syncSlabMock.mockResolvedValue({ problems: cached, synced: false })

    const { result } = renderHook(() => useSlab(7, 40))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems).toEqual(cached)
    expect(result.current.degraded).toBe(true)
  })

  it('falls back to cache and flags degraded if syncSlab itself throws', async () => {
    const cached = [problem('c')]
    readSlabMock.mockResolvedValue(cached)
    syncSlabMock.mockRejectedValue(new Error('indexeddb read failed'))

    const { result } = renderHook(() => useSlab(7, 40))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems).toEqual(cached)
    expect(result.current.degraded).toBe(true)
  })

  it('yields an empty list with no error and not degraded when unconfigured', async () => {
    readSlabMock.mockResolvedValue([])
    syncSlabMock.mockResolvedValue(synced([]))

    const { result } = renderHook(() => useSlab(7, 40))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems).toEqual([])
    expect(result.current.degraded).toBe(false)
  })

  it('reloads when the slab changes', async () => {
    readSlabMock.mockResolvedValue([])
    syncSlabMock.mockResolvedValue(synced([problem('d1')]))

    const { result, rerender } = renderHook(({ l, a }) => useSlab(l, a), {
      initialProps: { l: 7, a: 40 },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    syncSlabMock.mockResolvedValue(synced([problem('d2')]))
    rerender({ l: 5, a: 25 })

    await waitFor(() => expect(syncSlabMock).toHaveBeenCalledWith(5, 25))
    await waitFor(() => expect(result.current.problems).toEqual([problem('d2')]))
  })

  it('discards a stale slab response that resolves after a newer one', async () => {
    const first = defer<SyncResult>()
    const second = defer<SyncResult>()
    readSlabMock.mockResolvedValue([])
    syncSlabMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const { result, rerender } = renderHook(({ l, a }) => useSlab(l, a), {
      initialProps: { l: 7, a: 40 },
    })
    rerender({ l: 5, a: 25 })

    // The newer slab (second) resolves first.
    second.resolve(synced([problem('new')]))
    await waitFor(() => expect(result.current.problems).toEqual([problem('new')]))

    // The stale first-slab response arrives late and must be ignored.
    first.resolve(synced([problem('stale')]))
    await Promise.resolve()
    expect(result.current.problems).toEqual([problem('new')])
  })
})
