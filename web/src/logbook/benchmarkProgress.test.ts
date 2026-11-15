import { afterEach, describe, expect, it } from 'vitest'
import { FONT_GRADES, GRADE_FILTER_FLOOR } from '../board/grades'
import type { CatalogProblem } from '../catalog/catalogSync'
import {
  benchmarkRows,
  clampRange,
  defaultRange,
  gradeSpan,
  loadExpanded,
  loadMode,
  loadRange,
  rowsInRange,
  saveExpanded,
  saveMode,
  saveRange,
  summarize,
} from './benchmarkProgress'

function problem(id: string, grade: string, partial: Partial<CatalogProblem> = {}): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: 7,
    angle: 40,
    name: id,
    grade,
    user_grade: null,
    setter: 'Setter',
    stars: 0,
    repeats: 0,
    is_benchmark: true,
    method: null,
    holds: [],
    ...partial,
  }
}

const all = () => true
const ord = (grade: string) => FONT_GRADES.indexOf(grade)

describe('benchmarkRows', () => {
  it('counts sent and total benchmarks per grade, easiest first', () => {
    const rows = benchmarkRows(
      [problem('a', '7A'), problem('b', '6C'), problem('c', '6C'), problem('d', '7A')],
      new Set(['b', 'd']),
      all,
    )
    expect(rows).toEqual([
      { ordinal: ord('6C'), grade: '6C', sent: 1, total: 2 },
      { ordinal: ord('7A'), grade: '7A', sent: 1, total: 2 },
    ])
  })

  it('ignores problems that are not benchmarks', () => {
    const rows = benchmarkRows(
      [problem('a', '6C'), problem('b', '6C', { is_benchmark: false })],
      new Set(['b']),
      all,
    )
    expect(rows).toEqual([{ ordinal: ord('6C'), grade: '6C', sent: 0, total: 1 }])
  })

  it('leaves out benchmarks that need a hold set that is not installed', () => {
    const rows = benchmarkRows(
      [problem('a', '6C'), problem('b', '6C', { holds: [{ c: 1, r: 1, t: 'start' }] })],
      new Set(),
      (holds) => holds.length === 0,
    )
    expect(rows).toEqual([{ ordinal: ord('6C'), grade: '6C', sent: 0, total: 1 }])
  })

  it('buckets grades below the filter floor into the floor grade', () => {
    const rows = benchmarkRows([problem('a', '5+'), problem('b', '6A+')], new Set(['a']), all)
    expect(rows).toEqual([
      { ordinal: GRADE_FILTER_FLOOR, grade: FONT_GRADES[GRADE_FILTER_FLOOR], sent: 1, total: 2 },
    ])
  })

  it('skips grades that are not on the scale', () => {
    expect(benchmarkRows([problem('a', 'V5')], new Set(), all)).toEqual([])
  })
})

describe('grade ranges', () => {
  const slab = [problem('a', '6C'), problem('b', '6C+'), problem('c', '7A'), problem('d', '7B')]

  it('spans the easiest to the hardest grade with benchmarks', () => {
    expect(gradeSpan(benchmarkRows(slab, new Set(), all))).toEqual([ord('6C'), ord('7B')])
    expect(gradeSpan([])).toBeNull()
  })

  it('runs up to the hardest send, keeping gaps below it', () => {
    const rows = benchmarkRows(slab, new Set(['a', 'c']), all)
    const range = defaultRange(rows)!
    expect(range).toEqual([ord('6C'), ord('7A')])
    // 6C+ has no sends but sits below 7A, so it stays; 7B is above it and goes.
    expect(rowsInRange(rows, range).map((r) => r.grade)).toEqual(['6C', '6C+', '7A'])
  })

  it('runs to the top when nothing has been sent', () => {
    expect(defaultRange(benchmarkRows(slab, new Set(), all))).toEqual([ord('6C'), ord('7B')])
    expect(defaultRange([])).toBeNull()
  })

  it('trims a picked range to the span and drops one that misses it', () => {
    expect(clampRange(null, [7, 11])).toBeNull()
    expect(clampRange([3, 9], [7, 11])).toEqual([7, 9])
    expect(clampRange([14, 16], [7, 11])).toBeNull()
    expect(clampRange([9, 8], [7, 11])).toBeNull()
  })
})

describe('summarize', () => {
  it('totals the given rows', () => {
    const rows = benchmarkRows(
      [problem('a', '6C'), problem('b', '6C'), problem('c', '6C'), problem('d', '7A')],
      new Set(['a', 'd']),
      all,
    )
    expect(summarize(rows)).toEqual({ sent: 2, total: 4, percent: 50, maxTotal: 3 })
  })

  it('reports 0% for no rows', () => {
    expect(summarize([])).toEqual({ sent: 0, total: 0, percent: 0, maxTotal: 0 })
  })
})

describe('remembered on this device', () => {
  afterEach(() => localStorage.clear())

  it('keeps a custom range per board and clears it on null', () => {
    saveRange(7, [8, 12])
    expect(loadRange(7)).toEqual([8, 12])
    expect(loadRange(8)).toBeNull()
    saveRange(7, null)
    expect(loadRange(7)).toBeNull()
  })

  it('keeps the chosen mode, "All grades" by default', () => {
    expect(loadMode()).toBe('all')
    saveMode('custom')
    expect(loadMode()).toBe('custom')
    saveMode('all')
    expect(loadMode()).toBe('all')
  })

  it('keeps whether the grades were left open, closed by default', () => {
    expect(loadExpanded()).toBe(false)
    saveExpanded(true)
    expect(loadExpanded()).toBe(true)
    saveExpanded(false)
    expect(loadExpanded()).toBe(false)
  })
})
