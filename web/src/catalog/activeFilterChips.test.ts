import { describe, expect, it, vi } from 'vitest'
import { FONT_GRADES } from '../board/grades'
import { describeActiveFilters, type ChipContext } from './activeFilterChips'
import { DEFAULT_FILTERS, type FilterState } from './filters'

const READY: ChipContext = { inSession: false, statusReady: true }

/** Session context. `applied` defaults true (healthy projection); pass false for paused. */
function sessionCtx(
  over: { members: number; applied?: boolean },
  onClearAll: () => void = vi.fn(),
): ChipContext {
  return {
    inSession: true,
    statusReady: true,
    sessionStatus: { applied: true, ...over, onClearAll },
  }
}

function state(over: Partial<FilterState>): FilterState {
  return { ...DEFAULT_FILTERS, ...over }
}

describe('describeActiveFilters', () => {
  it('returns no chips for the default state', () => {
    expect(describeActiveFilters(DEFAULT_FILTERS, READY)).toEqual([])
  })

  it('emits chips in fixed category order with expected labels', () => {
    const s = state({
      gradeRange: [3, 8],
      minStars: 2,
      methods: ['Footless', 'No kickboard'],
      statusFilters: ['unlogged', 'sent'],
      holdsFilter: ['3-5', '4-6', '5-7'],
    })
    const chips = describeActiveFilters(s, READY)
    // Grade → Min-stars → Methods (option order) → Status (key order) → Holds.
    // (Benchmark and Favorites are pinned toggles, not chips — see below.)
    expect(chips.map((c) => c.id)).toEqual([
      'grade',
      'stars',
      'method:No kickboard',
      'method:Footless',
      'status:sent',
      'status:unlogged',
      'holds',
    ])
    const byId = Object.fromEntries(chips.map((c) => [c.id, c.label]))
    expect(byId['stars']).toBe('≥2★')
    expect(byId['status:sent']).toBe('Sent')
    expect(byId['status:unlogged']).toBe('Not logged')
    expect(byId['holds']).toBe('Holds (3)')
    // Grade label uses the font-grade names, not raw ordinals.
    expect(byId['grade']).toMatch(/–/)
  })

  it('emits Benchmarks/Favorites chips when active (removable when unpinned)', () => {
    // Now user-pinnable, so an active one must still be removable in the bar; FilterPillBar
    // suppresses the chip when the facet is pinned.
    const chips = describeActiveFilters(state({ benchmarkOnly: true, favoritesOnly: true }), READY)
    const byId = Object.fromEntries(chips.map((c) => [c.id, c]))
    expect(byId['benchmarks']?.patch).toEqual({ benchmarkOnly: false })
    expect(byId['favorites']?.patch).toEqual({ favoritesOnly: false })
    expect(byId['favorites']?.label).toBe('Favorites')
  })

  it('omits the grade chip for a full-span (null) range', () => {
    expect(describeActiveFilters(state({ gradeRange: null }), READY)).toEqual([])
  })

  it('collapses the grade chip to a single grade when lo === hi', () => {
    const chips = describeActiveFilters(state({ gradeRange: [4, 4] }), READY)
    const grade = chips.find((c) => c.id === 'grade')!
    expect(grade.label).toBe(FONT_GRADES[4])
    expect(grade.label).not.toMatch(/–/)
  })

  it('drops the single-user status chips in a session (statusFilters is inert there)', () => {
    const s = state({ minStars: 2, statusFilters: ['sent'] })
    const chips = describeActiveFilters(s, sessionCtx({ members: 0 }))
    expect(chips.map((c) => c.id)).toEqual(['stars'])
  })

  it('emits one collapsed "Status (n)" chip for the members filtered in a session', () => {
    const onClearAll = vi.fn()
    const s = state({ minStars: 2, statusFilters: ['sent'] })
    const chips = describeActiveFilters(s, sessionCtx({ members: 2 }, onClearAll))
    // Same slot as the solo status chips (between Methods and Holds), one chip, member count.
    expect(chips.map((c) => c.id)).toEqual(['stars', 'status'])
    const status = chips.find((c) => c.id === 'status')!
    expect(status.label).toBe('Status (2)')
    expect(status.paused).toBeFalsy()
    // Per-member status is store state — removal is a callback, never a FilterState patch.
    expect(status.patch).toBeUndefined()
    status.onRemove!()
    expect(onClearAll).toHaveBeenCalled()
  })

  it('emits no status chip in a session when no member row is selected', () => {
    const chips = describeActiveFilters(state({ statusFilters: ['sent'] }), sessionCtx({ members: 0 }))
    expect(chips).toEqual([])
  })

  it('still emits the chip when the projection is paused, flagged so the UI can dim it', () => {
    // Paused means applyFilters is not running the filter — but the selection exists and is
    // removable, so dropping the chip would repeat the "filter on, header silent" bug.
    const chips = describeActiveFilters(state({}), sessionCtx({ members: 2, applied: false }))
    const status = chips.find((c) => c.id === 'status')!
    expect(status.label).toBe('Status (2)')
    expect(status.paused).toBe(true)
  })

  it('suppresses status chips when not statusReady (e.g. signed-out deep link)', () => {
    const s = state({ minStars: 2, statusFilters: ['sent'] })
    const chips = describeActiveFilters(s, { inSession: false, statusReady: false })
    expect(chips.map((c) => c.id)).toEqual(['stars'])
  })

  it('emits a collapsed saved-list chip when a list filter is active', () => {
    const chips = describeActiveFilters(state({ listFilter: ['a', 'b'] }), READY)
    expect(chips).toEqual([{ id: 'lists', label: 'Lists (2)', patch: { listFilter: [] } }])
  })

  it("each chip's patch clears exactly its own filter", () => {
    const s = state({
      gradeRange: [3, 8],
      minStars: 2,
      methods: ['Footless', 'No kickboard'],
      statusFilters: ['sent', 'unlogged'],
      holdsFilter: ['3-5'],
    })
    const byId = Object.fromEntries(describeActiveFilters(s, READY).map((c) => [c.id, c.patch]))
    expect(byId['grade']).toEqual({ gradeRange: null })
    expect(byId['stars']).toEqual({ minStars: 0 })
    expect(byId['holds']).toEqual({ holdsFilter: [] })
    // Removing one method leaves the other selected.
    expect(byId['method:Footless']).toEqual({ methods: ['No kickboard'] })
    // Removing one status leaves the other selected.
    expect(byId['status:sent']).toEqual({ statusFilters: ['unlogged'] })
  })
})
