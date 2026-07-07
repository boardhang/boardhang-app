import { describe, expect, it } from 'vitest'
import { FONT_GRADES } from '../board/grades'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import {
  CATALOG_SEARCH_DEFAULTS,
  decodeGrade,
  encodeGrade,
  filtersToSearch,
  searchToFilters,
  validateCatalogSearch,
} from './catalogSearch'

// The route strips params equal to their default before serialization; simulate
// that here so the test exercises the real URL shape (sparse), not the padded
// validateSearch output.
function stripDefaults(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (v !== (CATALOG_SEARCH_DEFAULTS as unknown as Record<string, unknown>)[k]) out[k] = v
  }
  return out
}

// FilterState → search → (strip) → URL params → validate → FilterState.
// sortSecondary is intentionally not URL-addressable, so it always returns to the
// default; equality is asserted against a normalized copy.
function roundTrip(f: FilterState): FilterState {
  const params = stripDefaults({ ...filtersToSearch(f), problem: '', angle: 0 })
  return searchToFilters(validateCatalogSearch(params))
}

const GRADE_MAX = FONT_GRADES.length - 1

describe('catalogSearch round-trip', () => {
  it('preserves the empty (all-default) state as an empty URL', () => {
    const params = stripDefaults({ ...filtersToSearch(DEFAULT_FILTERS), problem: '', angle: 0 })
    expect(params).toEqual({})
    expect(roundTrip(DEFAULT_FILTERS)).toEqual(DEFAULT_FILTERS)
  })

  it('round-trips a fully-populated filter state', () => {
    const f: FilterState = {
      search: 'crimp',
      sortPrimary: 'hardest',
      sortSecondary: 'repeats', // fixed default; not in URL
      gradeRange: [3, 12],
      benchmarkOnly: true,
      minStars: 4,
      methods: ['Feet follow hands', 'Footless'],
      favoritesOnly: true,
      holdsFilter: ['3-4', '5-6'],
      statusFilters: ['sent', 'unlogged'],
    }
    expect(roundTrip(f)).toEqual(f)
  })

  it('forces sortSecondary back to the default (not URL-addressable)', () => {
    const f: FilterState = { ...DEFAULT_FILTERS, sortSecondary: null }
    expect(roundTrip(f).sortSecondary).toBe(DEFAULT_FILTERS.sortSecondary)
  })

  it('encodes booleans as 1 and omits them when off', () => {
    const on = filtersToSearch({ ...DEFAULT_FILTERS, benchmarkOnly: true, favoritesOnly: true })
    expect(on.bench).toBe(1)
    expect(on.fav).toBe(1)
    const off = stripDefaults(filtersToSearch(DEFAULT_FILTERS))
    expect(off.bench).toBeUndefined()
    expect(off.fav).toBeUndefined()
  })
})

describe('grade ordinal encoding', () => {
  it('omits the full canonical span', () => {
    expect(encodeGrade([0, GRADE_MAX])).toBe('')
    expect(encodeGrade(null)).toBe('')
  })

  it('encodes a partial range as min-max ordinals (+-free)', () => {
    expect(encodeGrade([3, 9])).toBe('3-9')
    expect(encodeGrade([3, 9])).not.toContain('+')
  })

  it('decodes a partial range and clamps out-of-bounds ordinals', () => {
    expect(decodeGrade('3-9')).toEqual([3, 9])
    expect(decodeGrade(`0-${GRADE_MAX + 50}`)).toBeNull() // clamps to full span → no filter
    expect(decodeGrade('9-3')).toEqual([3, 9]) // normalizes reversed order
  })

  it('treats malformed grade strings as no filter', () => {
    expect(decodeGrade('')).toBeNull()
    expect(decodeGrade('6A-7C')).toBeNull()
    expect(decodeGrade('garbage')).toBeNull()
  })
})

describe('status param', () => {
  it('round-trips a subset of status keys', () => {
    const f: FilterState = { ...DEFAULT_FILTERS, statusFilters: ['unlogged', 'sent'] }
    expect(roundTrip(f).statusFilters).toEqual(['unlogged', 'sent'])
  })

  it('encodes empty status as an omitted param', () => {
    const off = stripDefaults(filtersToSearch(DEFAULT_FILTERS))
    expect(off.status).toBeUndefined()
    expect(filtersToSearch({ ...DEFAULT_FILTERS, statusFilters: ['sent'] }).status).toBe('sent')
  })

  it('drops unknown and empty tokens on decode', () => {
    const decoded = searchToFilters(validateCatalogSearch({ status: 'sent,bogus,,attempted' }))
    expect(decoded.statusFilters).toEqual(['sent', 'attempted'])
  })

  it('defaults status to an empty string', () => {
    expect(CATALOG_SEARCH_DEFAULTS.status).toBe('')
    expect(validateCatalogSearch({}).status).toBe('')
  })
})

describe('validateCatalogSearch', () => {
  it('defaults every param on an empty input', () => {
    expect(validateCatalogSearch({})).toEqual(CATALOG_SEARCH_DEFAULTS)
  })

  it('coerces malformed values to safe defaults', () => {
    const s = validateCatalogSearch({ sort: 'bogus', stars: '99', bench: 'x', angle: -5 })
    expect(s.sort).toBe('easiest')
    expect(s.stars).toBe(5) // clamped
    expect(s.bench).toBe(0)
    expect(s.angle).toBe(0)
  })
})
