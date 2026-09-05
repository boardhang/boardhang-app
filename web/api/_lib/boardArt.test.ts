// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { boardByLayoutId } from '../../src/board/boards.js'
import { loadBoardArt } from './boardArt.js'

describe('loadBoardArt', () => {
  it('returns one PNG data URI per hold set, in registry order, from public/boards', async () => {
    const board = boardByLayoutId(7)!
    const art = await loadBoardArt(board)
    expect(art).toHaveLength(board.holdSets.length)
    for (const uri of art) {
      expect(uri.startsWith('data:image/png;base64,')).toBe(true)
      // PNG signature survives the round trip.
      expect(Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64').subarray(0, 4).toString('hex')).toBe(
        '89504e47',
      )
    }
  })

  it('rejects for a board whose art folder does not exist', async () => {
    const board = { ...boardByLayoutId(7)!, folder: 'no-such-board' }
    await expect(loadBoardArt(board)).rejects.toThrow()
  })
})
