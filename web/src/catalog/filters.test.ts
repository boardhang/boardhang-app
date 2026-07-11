import { describe, expect, it } from 'vitest'
import type { CatalogHold, CatalogProblem } from './catalogSync'
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  hasActiveFilters,
  resetFilters,
  type FilterContext,
  type FilterState,
  type SessionStatusContext,
} from './filters'

function p(over: Partial<CatalogProblem> & { source_catalog_id: string }): CatalogProblem {
  return {
    layout_id: 7,
    angle: 40,
    name: 'Problem',
    grade: '6A',
    user_grade: null,
    setter: 'setter',
    stars: 0,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds: [],
    ...over,
  }
}

const mkCtx = (over: Partial<FilterContext> = {}): FilterContext => ({
  favoriteIds: new Set(),
  listMemberIds: new Set(),
  listMembersReady: true,
  isClimbable: () => true,
  sentIds: new Set(),
  loggedIds: new Set(),
  statusReady: false,
  ...over,
})
const ctx: FilterContext = mkCtx()
const state = (over: Partial<FilterState> = {}): FilterState => ({ ...DEFAULT_FILTERS, ...over })
const ids = (list: CatalogProblem[]) => list.map((x) => x.source_catalog_id)

describe('applyFilters — search', () => {
  const list = [
    p({ source_catalog_id: 'a', name: 'Crimpfest', setter: 'Alice' }),
    p({ source_catalog_id: 'b', name: 'Slopers', setter: 'Bob' }),
  ]
  it('matches name or setter, case-insensitive', () => {
    expect(ids(applyFilters(list, state({ search: 'crimp' }), ctx))).toEqual(['a'])
    expect(ids(applyFilters(list, state({ search: 'BOB' }), ctx))).toEqual(['b'])
    expect(ids(applyFilters(list, state({ search: '' }), ctx))).toHaveLength(2)
  })
})

describe('applyFilters — sort', () => {
  it('easiest-first by grade with a differing secondary tiebreak', () => {
    const list = [
      p({ source_catalog_id: 'hard', grade: '7A', repeats: 5 }),
      p({ source_catalog_id: 'easyA', grade: '6A', repeats: 2 }),
      p({ source_catalog_id: 'easyB', grade: '6A', repeats: 9 }),
    ]
    // primary easiest (6A before 7A), secondary repeats (desc) within the tie.
    const s = state({ sortPrimary: 'easiest', sortSecondary: 'repeats' })
    expect(ids(applyFilters(list, s, ctx))).toEqual(['easyB', 'easyA', 'hard'])
  })

  it('defaults to Most repeats, then Easiest first', () => {
    const list = [
      p({ source_catalog_id: 'popularHard', grade: '7A', repeats: 9 }),
      p({ source_catalog_id: 'nicheEasy', grade: '6A', repeats: 1 }),
      p({ source_catalog_id: 'popularEasy', grade: '6A', repeats: 9 }),
    ]
    // Default: repeats desc first (9s before the 1), then easiest grade within the tie.
    expect(ids(applyFilters(list, state(), ctx))).toEqual(['popularEasy', 'popularHard', 'nicheEasy'])
  })

  it('hardest-first reverses the grade order', () => {
    const list = [p({ source_catalog_id: 'e', grade: '6A' }), p({ source_catalog_id: 'h', grade: '8A' })]
    expect(ids(applyFilters(list, state({ sortPrimary: 'hardest' }), ctx))).toEqual(['h', 'e'])
  })

  it('ignores a secondary sort that shares the primary dimension', () => {
    // easiest + hardest are both the grade dimension: the secondary is dropped,
    // so ties fall through to the name tiebreak (not a grade re-sort).
    const list = [
      p({ source_catalog_id: 'z', grade: '6A', name: 'Zebra' }),
      p({ source_catalog_id: 'a', grade: '6A', name: 'Apple' }),
    ]
    expect(
      ids(applyFilters(list, state({ sortPrimary: 'easiest', sortSecondary: 'hardest' }), ctx)),
    ).toEqual(['a', 'z']) // name tiebreak, not hardest
  })
})

describe('applyFilters — filters', () => {
  it('grade range excludes out-of-range but keeps unknown grades (AE4)', () => {
    const list = [
      p({ source_catalog_id: 'low', grade: '5+' }),
      p({ source_catalog_id: 'mid', grade: '6B' }),
      p({ source_catalog_id: 'unknown', grade: 'PROJECT' }),
    ]
    // Range covering 6A..7C (indices 3..13); 5+ (index 0) excluded, unknown kept.
    const out = ids(applyFilters(list, state({ gradeRange: [3, 13] }), ctx))
    expect(out).toContain('mid')
    expect(out).toContain('unknown')
    expect(out).not.toContain('low')
  })

  it('benchmark, min rating, and method each narrow', () => {
    const list = [
      p({ source_catalog_id: 'a', is_benchmark: true, stars: 3, method: 'Footless' }),
      p({ source_catalog_id: 'b', is_benchmark: false, stars: 1, method: null }),
    ]
    expect(ids(applyFilters(list, state({ benchmarkOnly: true }), ctx))).toEqual(['a'])
    expect(ids(applyFilters(list, state({ minStars: 2 }), ctx))).toEqual(['a'])
    expect(ids(applyFilters(list, state({ methods: ['Footless'] }), ctx))).toEqual(['a'])
  })

  it('favorites-only uses the context favorite set', () => {
    const list = [p({ source_catalog_id: 'a' }), p({ source_catalog_id: 'b' })]
    const favCtx = mkCtx({ favoriteIds: new Set(['b']) })
    expect(ids(applyFilters(list, state({ favoritesOnly: true }), favCtx))).toEqual(['b'])
  })

  it('list filter keeps only problems in the union membership set (when ready)', () => {
    const list = [p({ source_catalog_id: 'a' }), p({ source_catalog_id: 'b' }), p({ source_catalog_id: 'c' })]
    const listCtx = mkCtx({ listMemberIds: new Set(['a', 'c']), listMembersReady: true })
    expect(ids(applyFilters(list, state({ listFilter: ['x'] }), listCtx))).toEqual(['a', 'c'])
  })

  it('empty listFilter is a no-op regardless of listMemberIds', () => {
    const list = [p({ source_catalog_id: 'a' }), p({ source_catalog_id: 'b' })]
    const listCtx = mkCtx({ listMemberIds: new Set(['a']) })
    expect(ids(applyFilters(list, state({ listFilter: [] }), listCtx))).toHaveLength(2)
  })

  it('list filter fails OPEN while membership is not ready (never blanks the grid)', () => {
    const list = [p({ source_catalog_id: 'a' }), p({ source_catalog_id: 'b' })]
    // Selected a list, but its members have not loaded yet: empty set + not ready.
    const loadingCtx = mkCtx({ listMemberIds: new Set(), listMembersReady: false })
    expect(ids(applyFilters(list, state({ listFilter: ['x'] }), loadingCtx))).toHaveLength(2)
  })

  it('list filter ANDs with favorites (composition)', () => {
    const list = [p({ source_catalog_id: 'a' }), p({ source_catalog_id: 'b' })]
    // 'a' is in the list but not favorited; 'b' is favorited but not in the list → none pass.
    const bothCtx = mkCtx({
      listMemberIds: new Set(['a']),
      listMembersReady: true,
      favoriteIds: new Set(['b']),
    })
    expect(ids(applyFilters(list, state({ listFilter: ['x'], favoritesOnly: true }), bothCtx))).toEqual([])
  })

  it('holds filter requires the problem to be a superset of the drawn holds', () => {
    const hold = (c: number, r: number): CatalogHold => ({ c, r, t: 'right' })
    const list = [
      p({ source_catalog_id: 'has', holds: [hold(0, 1), hold(2, 3), hold(4, 5)] }),
      p({ source_catalog_id: 'missing', holds: [hold(0, 1)] }),
    ]
    const out = ids(applyFilters(list, state({ holdsFilter: ['0-1', '2-3'] }), ctx))
    expect(out).toEqual(['has'])
  })

  it('applies the installed-hold-set climbable filter (AE1)', () => {
    const list = [p({ source_catalog_id: 'a' }), p({ source_catalog_id: 'b' })]
    const climbCtx = mkCtx({ isClimbable: (holds) => holds === list[0].holds }) // only 'a' climbable
    expect(ids(applyFilters(list, state(), climbCtx))).toEqual(['a'])
  })
})

describe('applyFilters — status (ascent state)', () => {
  // a = sent, b = attempted (logged, not sent), c = never logged.
  const list = [p({ source_catalog_id: 'a' }), p({ source_catalog_id: 'b' }), p({ source_catalog_id: 'c' })]
  const readyCtx = mkCtx({
    statusReady: true,
    sentIds: new Set(['a']),
    loggedIds: new Set(['a', 'b']), // any ascent (sent OR attempt)
  })

  it('sent keeps only ids in sentIds', () => {
    expect(ids(applyFilters(list, state({ statusFilters: ['sent'] }), readyCtx))).toEqual(['a'])
  })

  it('attempted keeps logged-but-not-sent', () => {
    expect(ids(applyFilters(list, state({ statusFilters: ['attempted'] }), readyCtx))).toEqual(['b'])
  })

  it('unlogged keeps ids absent from loggedIds', () => {
    expect(ids(applyFilters(list, state({ statusFilters: ['unlogged'] }), readyCtx))).toEqual(['c'])
  })

  it('ORs the selected states together', () => {
    expect(ids(applyFilters(list, state({ statusFilters: ['sent', 'unlogged'] }), readyCtx))).toEqual([
      'a',
      'c',
    ])
  })

  it('classifies a problem with both a send and an attempt as sent (sent wins)', () => {
    const bothCtx = mkCtx({ statusReady: true, sentIds: new Set(['a']), loggedIds: new Set(['a']) })
    expect(ids(applyFilters(list, state({ statusFilters: ['sent'] }), bothCtx))).toEqual(['a'])
    // 'a' has an attempt row too, but 'attempted' must exclude it.
    expect(ids(applyFilters(list, state({ statusFilters: ['attempted'] }), bothCtx))).toEqual([])
  })

  it('ANDs status with other filters (sent AND benchmark)', () => {
    const benchList = [
      p({ source_catalog_id: 'a', is_benchmark: true }),
      p({ source_catalog_id: 'b', is_benchmark: false }),
    ]
    const ctx2 = mkCtx({ statusReady: true, sentIds: new Set(['a', 'b']), loggedIds: new Set(['a', 'b']) })
    expect(
      ids(applyFilters(benchList, state({ statusFilters: ['sent'], benchmarkOnly: true }), ctx2)),
    ).toEqual(['a'])
  })

  it('is a no-op when statusFilters is empty', () => {
    expect(ids(applyFilters(list, state({ statusFilters: [] }), readyCtx))).toHaveLength(3)
  })

  it('skips the status predicate when not ready (signed-out OR ascents not loaded)', () => {
    // Not ready + non-empty sets: still returns everything, never blanks a ?status link.
    const notReady = mkCtx({ statusReady: false, sentIds: new Set(['a']), loggedIds: new Set(['a', 'b']) })
    expect(ids(applyFilters(list, state({ statusFilters: ['sent'] }), notReady))).toHaveLength(3)
  })
})

describe('activeFilterCount — status', () => {
  it('counts status only when ready', () => {
    expect(activeFilterCount(state({ statusFilters: ['sent'] }), true)).toBe(1)
    expect(activeFilterCount(state({ statusFilters: ['sent'] }), false)).toBe(0)
    expect(activeFilterCount(state({ statusFilters: [] }), true)).toBe(0)
    // default param (omitted) counts as ready
    expect(activeFilterCount(state({ statusFilters: ['sent', 'unlogged'] }))).toBe(1)
  })

  it('resetFilters clears statusFilters', () => {
    expect(resetFilters(state({ statusFilters: ['sent'] })).statusFilters).toEqual([])
  })
})

describe('reset + active', () => {
  it('hasActiveFilters ignores search and sort', () => {
    expect(hasActiveFilters(state({ search: 'x', sortPrimary: 'hardest' }))).toBe(false)
    expect(hasActiveFilters(state({ benchmarkOnly: true }))).toBe(true)
  })

  it('resetFilters clears filters but keeps sort', () => {
    const s = state({ benchmarkOnly: true, minStars: 3, sortPrimary: 'rated', sortSecondary: 'easiest' })
    const r = resetFilters(s)
    expect(hasActiveFilters(r)).toBe(false)
    expect(r.sortPrimary).toBe('rated')
    expect(r.sortSecondary).toBe('easiest')
  })
})

// ── U4: per-member session status (OR-within-row, AND-across-rows, empty-row = ignore) ──
describe('applyFilters — per-member session status (R4/R5)', () => {
  // World: four problems; three members with distinct logbooks on this board.
  //   me   : sent {S}, attempted {A}     (logged {S, A})
  //   alice: sent {X}                     (logged {X})
  //   bob  : zero ascents                 (logged {})  ← roster-seeded, empty Sets
  const list = [p({ source_catalog_id: 'S' }), p({ source_catalog_id: 'A' }), p({ source_catalog_id: 'X' }), p({ source_catalog_id: 'N' })]
  const pair = (sent: string[], logged: string[]) => ({ sentIds: new Set(sent), loggedIds: new Set(logged) })
  const sets = {
    me: pair(['S'], ['S', 'A']),
    alice: pair(['X'], ['X']),
    bob: pair([], []),
  }
  const sess = (over: Partial<SessionStatusContext> = {}): SessionStatusContext => ({
    ready: true,
    members: ['me', 'alice', 'bob'],
    memberStatus: {},
    sets,
    ...over,
  })
  const withSession = (session: SessionStatusContext): FilterContext => mkCtx({ statusReady: true, session })

  it('AND across rows: two members both "Not logged" → only problems both are unlogged on', () => {
    const s = withSession(sess({ members: ['me', 'bob'], memberStatus: { me: ['unlogged'], bob: ['unlogged'] } }))
    // me-unlogged = {X, N}; bob-unlogged = all → AND → {X, N}.
    expect(ids(applyFilters(list, state(), s)).sort()).toEqual(['N', 'X'])
  })

  it('OR within a row: {Sent, Attempted} matches sent-or-attempted for that member', () => {
    const s = withSession(sess({ members: ['me'], memberStatus: { me: ['sent', 'attempted'] } }))
    expect(ids(applyFilters(list, state(), s)).sort()).toEqual(['A', 'S'])
  })

  it('an empty row is ignored — a third member does not change the result', () => {
    const base = withSession(sess({ members: ['me', 'alice'], memberStatus: { me: ['unlogged'], alice: ['unlogged'] } }))
    const withEmpty = withSession(
      sess({ members: ['me', 'alice', 'bob'], memberStatus: { me: ['unlogged'], alice: ['unlogged'] } }), // bob empty
    )
    expect(ids(applyFilters(list, state(), withEmpty)).sort()).toEqual(ids(applyFilters(list, state(), base)).sort())
  })

  it('all rows empty → session clause is a no-op (full list)', () => {
    const s = withSession(sess({ memberStatus: {} }))
    expect(ids(applyFilters(list, state(), s))).toHaveLength(4)
  })

  it('asymmetric coach case: Alice Sent AND me Not logged', () => {
    const s = withSession(sess({ members: ['me', 'alice'], memberStatus: { alice: ['sent'], me: ['unlogged'] } }))
    // alice-sent = {X}; me-unlogged = {X, N} → AND → {X}.
    expect(ids(applyFilters(list, state(), s))).toEqual(['X'])
  })

  it('self row (R5) participates identically to any other member row', () => {
    const s = withSession(sess({ members: ['me'], memberStatus: { me: ['sent'] } }))
    expect(ids(applyFilters(list, state(), s))).toEqual(['S'])
  })

  it('a roster-seeded zero-ascent member CONSTRAINS (not skipped): bob "Sent" → nothing matches', () => {
    const s = withSession(sess({ members: ['me', 'bob'], memberStatus: { bob: ['sent'] } }))
    expect(ids(applyFilters(list, state(), s))).toEqual([]) // bob has empty Sets → matches no sends
  })

  it('not-ready session skips the clause (list not blanked mid-load)', () => {
    const s = withSession(sess({ ready: false, members: ['me', 'bob'], memberStatus: { me: ['sent'], bob: ['sent'] } }))
    expect(ids(applyFilters(list, state(), s))).toHaveLength(4)
  })

  it('no active session → single-user statusFilters path is unchanged', () => {
    const single = mkCtx({ statusReady: true, sentIds: new Set(['S']), loggedIds: new Set(['S', 'A']) })
    expect(ids(applyFilters(list, state({ statusFilters: ['sent'] }), single))).toEqual(['S'])
  })
})
