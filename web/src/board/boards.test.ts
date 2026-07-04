import { describe, expect, it } from 'vitest'
import { BOARDS, boardByLayoutId, defaultAngle, hasAngleChoice } from './boards'
import { MINI_GEOMETRY } from './renderGeometry'

describe('board registry', () => {
  it('exposes exactly the five supported boards', () => {
    expect(BOARDS.map((b) => b.layoutId).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 7])
  })

  it('gives Mini 2025 a single 40° angle and mini geometry', () => {
    const mini = boardByLayoutId(7)!
    expect(mini.angles).toEqual([40])
    expect(hasAngleChoice(mini)).toBe(false)
    expect(defaultAngle(mini)).toBe(40)
    expect(mini.geometry).toBe(MINI_GEOMETRY)
    expect(mini.geometry.numRows).toBe(12)
  })

  it('gives full boards both 40° and 25° and 18-row geometry', () => {
    for (const id of [2, 3, 4, 5]) {
      const b = boardByLayoutId(id)!
      expect(b.angles).toEqual([40, 25])
      expect(hasAngleChoice(b)).toBe(true)
      expect(b.geometry.numRows).toBe(18)
    }
  })

  it('returns undefined for an unsupported layout id', () => {
    expect(boardByLayoutId(1)).toBeUndefined()
    expect(boardByLayoutId(99)).toBeUndefined()
  })

  it('carries hold sets with unique ids per board', () => {
    for (const b of BOARDS) {
      const ids = b.holdSets.map((h) => h.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.length).toBeGreaterThan(0)
    }
  })
})
