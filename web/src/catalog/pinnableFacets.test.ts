import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import {
  facetActiveLabel,
  facetPaused,
  isFacetActive,
  type FacetContext,
  type SessionStatusFacet,
} from './pinnableFacets'

const state = (over: Partial<FilterState> = {}): FilterState => ({ ...DEFAULT_FILTERS, ...over })

/** Solo context — no session, so `sessionStatus` is not part of the shape at all. */
const solo = (statusReady = true): FacetContext => ({ inSession: false, statusReady })

/** Session context. `applied` defaults true (a healthy projection); pass false for paused. */
const inSession = (over: Partial<SessionStatusFacet> = {}): FacetContext => ({
  inSession: true,
  statusReady: true,
  sessionStatus: { members: 0, applied: true, ...over },
})

// Status is the one facet with two backing stores: FilterState.statusFilters when solo, and
// per-member session state (surfaced as ctx.sessionStatus) inside a collab session.
describe('pinnableFacets — status facet, solo', () => {
  it('is active only when statusReady and a status is selected', () => {
    expect(isFacetActive('status', state({ statusFilters: ['sent'] }), solo())).toBe(true)
    expect(isFacetActive('status', state({ statusFilters: [] }), solo())).toBe(false)
    expect(isFacetActive('status', state({ statusFilters: ['sent'] }), solo(false))).toBe(false)
  })

  it('labels one selection by name and several by count', () => {
    expect(facetActiveLabel('status', state({ statusFilters: ['sent'] }), solo())).toBe('Sent')
    expect(facetActiveLabel('status', state({ statusFilters: ['sent', 'unlogged'] }), solo())).toBe(
      'Status (2)',
    )
    expect(facetActiveLabel('status', state(), solo())).toBe('Ascent status')
  })

  it('is never paused — only session status has a projection that can go stale', () => {
    expect(facetPaused('status', solo())).toBe(false)
  })
})

describe('pinnableFacets — status facet, in a session', () => {
  it('reads active off the member count, ignoring the inert statusFilters', () => {
    // statusFilters set but no member row selected → nothing is being filtered.
    expect(
      isFacetActive('status', state({ statusFilters: ['sent'] }), inSession({ members: 0 })),
    ).toBe(false)
    // No statusFilters but a member row selected → the list IS narrowed.
    expect(isFacetActive('status', state(), inSession({ members: 1 }))).toBe(true)
  })

  it('counts MEMBERS in the label, not selected statuses', () => {
    // One status key selected, but across two members → "Status (2)".
    expect(
      facetActiveLabel('status', state({ statusFilters: ['sent'] }), inSession({ members: 2 })),
    ).toBe('Status (2)')
    expect(facetActiveLabel('status', state(), inSession({ members: 0 }))).toBe('Ascent status')
  })
})

// The third state. applyFilters skips the per-member clause while the projection is unready, so
// selections exist but nothing is filtering — the header has to say BOTH, not pick one.
describe('pinnableFacets — status facet, paused projection', () => {
  it('is not active when selections exist but the list is not applying them', () => {
    expect(isFacetActive('status', state(), inSession({ members: 2, applied: false }))).toBe(false)
  })

  it('still names the selection, so a set filter never vanishes from the header', () => {
    expect(facetActiveLabel('status', state(), inSession({ members: 2, applied: false }))).toBe(
      'Status (2)',
    )
  })

  it('reports paused only when there is actually a selection to be paused', () => {
    expect(facetPaused('status', inSession({ members: 2, applied: false }))).toBe(true)
    // Nothing selected → nothing to say; the control is plainly off, not "paused".
    expect(facetPaused('status', inSession({ members: 0, applied: false }))).toBe(false)
    // Applied → active, not paused.
    expect(facetPaused('status', inSession({ members: 2, applied: true }))).toBe(false)
  })

  it('never reports another facet as paused', () => {
    for (const id of ['grade', 'holds', 'sort', 'stars', 'methods', 'lists'] as const) {
      expect(facetPaused(id, inSession({ members: 2, applied: false }))).toBe(false)
    }
  })
})
