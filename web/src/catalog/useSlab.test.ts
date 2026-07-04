import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogProblem } from './catalogSync'
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSlab', () => {
  it('returns the cached slab and resolves without error', async () => {
    const cached = [problem('a')]
    readSlabMock.mockResolvedValue(cached)
    syncSlabMock.mockResolvedValue(cached)

    const { result } = renderHook(() => useSlab(7, 40))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems).toEqual(cached)
    expect(result.current.degraded).toBe(false)
    expect(readSlabMock).toHaveBeenCalledWith(7, 40)
  })

  it('flags degraded and serves the cached slab when sync throws', async () => {
    const cached = [problem('b')]
    readSlabMock.mockResolvedValue(cached)
    syncSlabMock.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useSlab(7, 40))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems).toEqual(cached)
    expect(result.current.degraded).toBe(true)
  })

  it('yields an empty list with no error when unconfigured', async () => {
    readSlabMock.mockResolvedValue([])
    syncSlabMock.mockResolvedValue([])

    const { result } = renderHook(() => useSlab(7, 40))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems).toEqual([])
    expect(result.current.degraded).toBe(false)
  })

  it('reloads when the slab changes', async () => {
    readSlabMock.mockResolvedValue([])
    syncSlabMock.mockResolvedValue([problem('c')])

    const { result, rerender } = renderHook(({ l, a }) => useSlab(l, a), {
      initialProps: { l: 7, a: 40 },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    syncSlabMock.mockResolvedValue([problem('d')])
    rerender({ l: 5, a: 25 })

    await waitFor(() => expect(syncSlabMock).toHaveBeenCalledWith(5, 25))
    await waitFor(() => expect(result.current.problems).toEqual([problem('d')]))
  })
})
