import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { loadSeed, saveSeed } from './filterSeed'

beforeEach(() => localStorage.clear())

describe('filterSeed', () => {
  it('returns the defaults for an unseeded slab', () => {
    expect(loadSeed(7, 40)).toEqual(DEFAULT_FILTERS)
  })

  it('round-trips filters per (board, angle)', () => {
    const state: FilterState = { ...DEFAULT_FILTERS, benchmarkOnly: true, minStars: 3 }
    saveSeed(7, 40, state)

    expect(loadSeed(7, 40)).toMatchObject({ benchmarkOnly: true, minStars: 3 })
    // A different slab is independent.
    expect(loadSeed(5, 25)).toEqual(DEFAULT_FILTERS)
  })

  it('never seeds the transient search query', () => {
    saveSeed(7, 40, { ...DEFAULT_FILTERS, search: 'crimp', benchmarkOnly: true })
    const seeded = loadSeed(7, 40)
    expect(seeded.search).toBe('')
    expect(seeded.benchmarkOnly).toBe(true)
  })

  it('merges a stored blob missing a newer field over the defaults', () => {
    // Simulate an older seed that predates a field (e.g. holdsFilter).
    localStorage.setItem('catalogFilters_7_40', JSON.stringify({ benchmarkOnly: true }))
    const seeded = loadSeed(7, 40)
    expect(seeded.benchmarkOnly).toBe(true)
    expect(seeded.holdsFilter).toEqual([])
    expect(seeded.sortPrimary).toBe(DEFAULT_FILTERS.sortPrimary)
  })

  it('falls back to defaults on a malformed blob', () => {
    localStorage.setItem('catalogFilters_7_40', 'not json')
    expect(loadSeed(7, 40)).toEqual(DEFAULT_FILTERS)
  })
})
