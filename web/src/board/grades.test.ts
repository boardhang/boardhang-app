import { describe, expect, it } from 'vitest'
import { FONT_GRADES, gradeIndex } from './grades'

describe('gradeIndex', () => {
  it('orders grades on the canonical Font scale, not lexicographically', () => {
    expect(gradeIndex('6A')).toBeLessThan(gradeIndex('6A+'))
    expect(gradeIndex('6A+')).toBeLessThan(gradeIndex('6B'))
    expect(gradeIndex('7C')).toBeLessThan(gradeIndex('8A'))
    // The case String compare gets wrong: "8A" < "8B" but "6C+" < "7A".
    expect(gradeIndex('6C+')).toBeLessThan(gradeIndex('7A'))
  })

  it('sorts unknown/unmapped grades to the end', () => {
    const unknown = gradeIndex('9A')
    expect(unknown).toBe(FONT_GRADES.length)
    for (const g of FONT_GRADES) {
      expect(gradeIndex(g)).toBeLessThan(unknown)
    }
  })

  it('treats empty, whitespace, and case-variant grades as unknown', () => {
    // The scale is case- and exact-match sensitive (matching iOS FontGrade.all);
    // anything not on it sorts to the end alongside other unknowns.
    expect(gradeIndex('')).toBe(FONT_GRADES.length)
    expect(gradeIndex(' ')).toBe(FONT_GRADES.length)
    expect(gradeIndex('6a')).toBe(FONT_GRADES.length)
  })

  it('sorting by gradeIndex yields the canonical order', () => {
    const shuffled = ['8A', '5+', '7B', '6A+', '6A']
    const sorted = [...shuffled].sort((a, b) => gradeIndex(a) - gradeIndex(b))
    expect(sorted).toEqual(['5+', '6A', '6A+', '7B', '8A'])
  })
})
