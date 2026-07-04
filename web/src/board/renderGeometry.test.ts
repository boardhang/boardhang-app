import { describe, expect, it } from 'vitest'
import { MINI_GEOMETRY, STANDARD_GEOMETRY, aspect, center } from './renderGeometry'

describe('center', () => {
  for (const [label, g] of [
    ['mini', MINI_GEOMETRY],
    ['standard', STANDARD_GEOMETRY],
  ] as const) {
    describe(label, () => {
      it('places A1 at the bottom-left and the top row above it', () => {
        const a1 = center(g, 0, 1)
        const aTop = center(g, 0, g.rowTop)
        // Column A is left of center.
        expect(a1.x).toBeLessThan(0.5)
        // Row 1 is at the bottom: larger y (fraction from the top) than the top row.
        expect(a1.y).toBeGreaterThan(aTop.y)
        // Both stay inside the art with their margins.
        expect(a1.y).toBeLessThan(1 - g.bottomMargin)
        expect(aTop.y).toBeGreaterThan(g.topMargin)
      })

      it('places column K to the right of column A', () => {
        expect(center(g, 10, 1).x).toBeGreaterThan(center(g, 0, 1).x)
      })
    })
  }

  it('uses each geometry’s own aspect (mini is wider than standard)', () => {
    expect(aspect(MINI_GEOMETRY)).toBeGreaterThan(aspect(STANDARD_GEOMETRY))
    expect(aspect(STANDARD_GEOMETRY)).toBeCloseTo(0.65, 2)
  })

  // Exact fractions from the iOS MoonBoardGeometry.center() formula — pins the
  // proportions so a margin/row-count regression can't slip through the relative
  // ordering checks above.
  it('matches the iOS reference fractions for standard geometry', () => {
    expect(center(STANDARD_GEOMETRY, 0, 1)).toEqual({
      x: expect.closeTo(0.138636, 5),
      y: expect.closeTo(0.935, 5),
    })
    expect(center(STANDARD_GEOMETRY, 0, 18)).toEqual({
      x: expect.closeTo(0.138636, 5),
      y: expect.closeTo(0.085, 5),
    })
  })

  it('matches the iOS reference fractions for mini geometry', () => {
    expect(center(MINI_GEOMETRY, 0, 1)).toEqual({
      x: expect.closeTo(0.143086, 5),
      y: expect.closeTo(0.906917, 5),
    })
  })
})
