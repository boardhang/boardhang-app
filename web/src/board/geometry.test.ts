import { describe, expect, it } from 'vitest'
import { ledIndex, positionForLED, totalLEDs } from './geometry'

// Mini board (12 rows) unless noted; the serpentine is column-major, LED 0 at A1.
describe('ledIndex', () => {
  it('maps up an even column and down an odd column (serpentine)', () => {
    expect(ledIndex(0, 1, 12)).toBe(0) // A1: bottom of column A
    expect(ledIndex(0, 12, 12)).toBe(11) // A12: top of column A
    expect(ledIndex(1, 12, 12)).toBe(12) // B12: column B snakes down from the top
    expect(ledIndex(1, 1, 12)).toBe(23) // B1: bottom of column B
  })

  it('reverses the whole strip when flipped', () => {
    expect(ledIndex(0, 1, 12, true)).toBe(totalLEDs(12) - 1)
    expect(ledIndex(0, 1, 12, false)).toBe(0)
  })

  it('round-trips with positionForLED', () => {
    for (let col = 0; col < 11; col++) {
      for (let row = 1; row <= 12; row++) {
        expect(positionForLED(ledIndex(col, row, 12), 12)).toEqual({ col, row })
      }
    }
  })

  // Previously these produced a wrong / out-of-range index silently and the board
  // just never lit that hold. They must now fail loudly so the caller can surface it.
  it('throws a descriptive RangeError for a row past the top (finish hold on a Mini board)', () => {
    expect(() => ledIndex(9, 18, 12)).toThrow(RangeError)
    expect(() => ledIndex(9, 18, 12)).toThrow(/row 18.*1.12/i)
  })

  it('throws for a row below the bottom', () => {
    expect(() => ledIndex(0, 0, 12)).toThrow(RangeError)
  })

  it('throws for a column off the board', () => {
    expect(() => ledIndex(11, 1, 12)).toThrow(/column/i)
    expect(() => ledIndex(-1, 1, 12)).toThrow(RangeError)
  })

  it('throws for non-integer coordinates', () => {
    expect(() => ledIndex(1.5, 1, 12)).toThrow(RangeError)
    expect(() => ledIndex(1, 2.5, 12)).toThrow(RangeError)
  })

  it('accepts the exact boundaries', () => {
    expect(() => ledIndex(0, 1, 12)).not.toThrow()
    expect(() => ledIndex(10, 12, 12)).not.toThrow()
    expect(() => ledIndex(10, 18, 18)).not.toThrow() // full board, top row
  })
})
