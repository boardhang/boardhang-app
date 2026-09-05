// Board overlay art for the card, read from the bundled public/boards PNGs (vercel.json
// `includeFiles` ships them with the image function) and returned as data URIs for
// Satori. Resolved relative to this module rather than process.cwd(), so it does not
// depend on where the function's working directory lands under the `web` Root
// Directory. All of a board's hold sets are returned: the sharer's installed sets are
// device-local and unknown here.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CatalogBoardDef } from '../../src/board/boards.js'

const ART_DIR = fileURLToPath(new URL('../../public/boards/', import.meta.url))

/** One `data:image/png;base64,…` per hold set, in registry order. Rejects if a file is missing. */
export async function loadBoardArt(board: Pick<CatalogBoardDef, 'folder' | 'holdSets'>): Promise<string[]> {
  return Promise.all(
    board.holdSets.map(async (set) => {
      const file = path.join(ART_DIR, board.folder, `${set.imageName}.png`)
      const bytes = await readFile(file)
      return `data:image/png;base64,${bytes.toString('base64')}`
    }),
  )
}
