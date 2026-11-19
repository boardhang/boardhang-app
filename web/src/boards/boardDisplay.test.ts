import { describe, expect, it } from 'vitest'
import { BOARDS, boardByLayoutId } from '../board/boards'
import { setupSummary, shortBoardName } from './boardDisplay'

describe('shortBoardName', () => {
  it('shortens MoonBoard to MB and leaves the rest of the name', () => {
    expect(shortBoardName(boardByLayoutId(3)!)).toBe('MB 2024')
    expect(shortBoardName(boardByLayoutId(7)!)).toBe('Mini MB 2025')
    expect(shortBoardName(boardByLayoutId(5)!)).toBe('MB Masters 2019')
  })

  it('gives every registry board a distinct short name', () => {
    const names = BOARDS.map(shortBoardName)
    expect(new Set(names).size).toBe(BOARDS.length)
  })
})

describe('setupSummary', () => {
  it('says "all hold sets" for a full selection', () => {
    expect(setupSummary(40, 6, 6)).toBe('40° · all hold sets')
  })

  it('counts the selected sets for a partial selection', () => {
    expect(setupSummary(25, 3, 7)).toBe('25° · 3 of 7 hold sets')
  })
})
