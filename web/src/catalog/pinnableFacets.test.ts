import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { facetActiveLabel, isFacetActive, type FacetContext } from './pinnableFacets'

const state = (over: Partial<FilterState> = {}): FilterState => ({ ...DEFAULT_FILTERS, ...over })
const ctx = (over: Partial<FacetContext> = {}): FacetContext => ({
  inSession: false,
  statusReady: true,
  ...over,
})

// Status is the one facet with two backing stores: FilterState.statusFilters when solo, and
// per-member session state (surfaced as ctx.sessionStatusMembers) inside a collab session.
describe('pinnableFacets — status facet, solo', () => {
  it('is active only when statusReady and a status is selected', () => {
    expect(isFacetActive('status', state({ statusFilters: ['sent'] }), ctx())).toBe(true)
    expect(isFacetActive('status', state({ statusFilters: [] }), ctx())).toBe(false)
    expect(
      isFacetActive('status', state({ statusFilters: ['sent'] }), ctx({ statusReady: false })),
    ).toBe(false)
  })

  it('labels one selection by name and several by count', () => {
    expect(facetActiveLabel('status', state({ statusFilters: ['sent'] }), ctx())).toBe('Sent')
    expect(facetActiveLabel('status', state({ statusFilters: ['sent', 'unlogged'] }), ctx())).toBe(
      'Status (2)',
    )
    expect(facetActiveLabel('status', state(), ctx())).toBe('Ascent status')
  })
})

describe('pinnableFacets — status facet, in a session', () => {
  it('reads active off the member count, ignoring the inert statusFilters', () => {
    const inSession = { inSession: true }
    // statusFilters set but no member row selected → nothing is being filtered.
    expect(
      isFacetActive('status', state({ statusFilters: ['sent'] }), ctx({ ...inSession, sessionStatusMembers: 0 })),
    ).toBe(false)
    // No statusFilters but a member row selected → the list IS narrowed.
    expect(isFacetActive('status', state(), ctx({ ...inSession, sessionStatusMembers: 1 }))).toBe(true)
  })

  it('counts MEMBERS in the label, not selected statuses', () => {
    const c = ctx({ inSession: true, sessionStatusMembers: 2 })
    // One status key selected, but across two members → "Status (2)".
    expect(facetActiveLabel('status', state({ statusFilters: ['sent'] }), c)).toBe('Status (2)')
    expect(
      facetActiveLabel('status', state(), ctx({ inSession: true, sessionStatusMembers: 0 })),
    ).toBe('Ascent status')
  })

  it('treats a missing sessionStatusMembers as "no members filtered"', () => {
    expect(isFacetActive('status', state({ statusFilters: ['sent'] }), ctx({ inSession: true }))).toBe(
      false,
    )
    expect(facetActiveLabel('status', state(), ctx({ inSession: true }))).toBe('Ascent status')
  })
})
