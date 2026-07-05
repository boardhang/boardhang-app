import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOARDS } from './boards'

// Guards against drift between the board registry and the exported art: every
// background + overlay CatalogBoard would request must exist under public/boards/.
// If boards.ts adds a board/hold set, re-run scripts/export_board_art_web.py.
const publicBoards = join(process.cwd(), 'public', 'boards')

describe('exported board art covers the registry', () => {
  for (const board of BOARDS) {
    it(`has all art for ${board.name}`, () => {
      expect(existsSync(join(publicBoards, `${board.background}.png`))).toBe(true)
      for (const set of board.holdSets) {
        expect(existsSync(join(publicBoards, board.folder, `${set.imageName}.png`))).toBe(true)
      }
    })
  }
})
