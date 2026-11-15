import { afterEach, describe, expect, it } from 'vitest'
import { FONT_GRADES, GRADE_FILTER_FLOOR } from '../board/grades'
import type { CatalogProblem } from '../catalog/catalogSync'
import {
  benchmarkRows,
  clampRange,
  gradeSpan,
  loadRange,
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

describe('gradeSpan / clampRange', () => {
  const rows = benchmarkRows([problem('a', '6C'), problem('b', '7B')], new Set(), all)

  it('spans the easiest to the hardest grade with benchmarks', () => {
    expect(gradeSpan(rows)).toEqual([ord('6C'), ord('7B')])
    expect(gradeSpan([])).toBeNull()
  })

  it('uses the whole span when nothing is remembered', () => {
    expect(clampRange(null, [7, 11])).toEqual([7, 11])
  })

  it('trims a remembered range to the span', () => {
    expect(clampRange([3, 9], [7, 11])).toEqual([7, 9])
  })

  it('falls back to the whole span when the remembered range misses it', () => {
    expect(clampRange([14, 16], [7, 11])).toEqual([7, 11])
    expect(clampRange([9, 8], [7, 11])).toEqual([7, 11])
  })
})

describe('summarize', () => {
  const rows = benchmarkRows(
    [problem('a', '6C'), problem('b', '6C'), problem('c', '6C'), problem('d', '7A'), problem('e', '7B')],
    new Set(['a', 'd']),
    all,
  )

  it('totals the rows inside the range', () => {
    const s = summarize(rows, [ord('6C'), ord('7A')])
    expect(s.rows.map((r) => r.grade)).toEqual(['6C', '7A'])
    expect(s).toMatchObject({ sent: 2, total: 4, percent: 50, maxTotal: 3 })
  })

  it('reports 0% when the range holds no benchmarks', () => {
    expect(summarize(rows, [ord('6C+'), ord('6C+')])).toMatchObject({ sent: 0, total: 0, percent: 0 })
  })
})

describe('remembered range', () => {
  afterEach(() => localStorage.clear())

  it('round-trips per board and clears on null', () => {
    saveRange(7, [8, 12])
    expect(loadRange(7)).toEqual([8, 12])
    expect(loadRange(8)).toBeNull()
    saveRange(7, null)
    expect(loadRange(7)).toBeNull()
  })
})
