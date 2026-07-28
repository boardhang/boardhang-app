import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CANONICAL_ORDER } from './pinnableFacets'
import { usePinnedFacets } from './pinnedFiltersStore'

// Regression: the stored pin set is filtered against an allowlist on read. When that list was
// hand-maintained, a newly added facet parsed fine but failed the filter — so pinning it
// worked until the next reload, and then it silently vanished. No exhaustive switch covers
// this, so assert the whole registry survives a round-trip.
describe('pinnedFiltersStore', () => {
  it('accepts every facet in CANONICAL_ORDER back off storage', () => {
    const ids = CANONICAL_ORDER.map((f) => f.id)
    localStorage.setItem('catalogPinnedFilters_900', JSON.stringify(ids))
    const { result } = renderHook(() => usePinnedFacets(900))
    expect(result.current).toEqual(ids)
  })

  it('still drops an id that is not a facet at all', () => {
    localStorage.setItem('catalogPinnedFilters_901', JSON.stringify(['grade', 'nonsense']))
    const { result } = renderHook(() => usePinnedFacets(901))
    expect(result.current).toEqual(['grade'])
  })
})
