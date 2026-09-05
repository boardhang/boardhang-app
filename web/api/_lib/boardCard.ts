// The 1200×630 link-preview card: the board art with the problem's holds marked,
// beside the name, grade, board and angle. Built with createElement (no JSX in api/ —
// the Vercel builder's tsconfig lookup lands on the root solution file, which has no
// jsx setting) for Satori, which lays out a flexbox subset: every element with more
// than one child is display:flex, no z-index, no filters, absolute positioning in
// pixels. Marker geometry mirrors web/src/board/CatalogBoard.tsx (0.9 of a column,
// translucent role fill, 2px role border) over renderGeometry's center().
//
// The label background layer the app draws (black axis labels, CSS-inverted) is
// omitted: Satori has no filter support and the labels would vanish on the dark card.

import { createElement as h, type ReactElement } from 'react'
import type { CatalogBoardDef } from '../../src/board/boards.js'
import { center } from '../../src/board/renderGeometry.js'
import { displayed, holdColor, type HoldType } from '../../src/types.js'
import type { ProblemHold, ProblemRow } from './catalogRow.js'

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

const PAD = 40
const GAP = 48
const CARD_BG = '#0E1116' // matches the PWA manifest theme
const BOARD_BG = '#1b1f27'
const TEXT = '#ffffff'
const MUTED = '#a1a1aa'
const FAINT = '#71717a'
const BADGE_BG = '#2a2f3a'
const MARKER_COLUMN_RATIO = 0.9
const MARKER_FILL_ALPHA = '59'
const MARKER_BORDER_PX = 2

export interface CardBox {
  left: number
  top: number
  width: number
  height: number
}

export interface CardMarker {
  /** Canvas-absolute top-left of the circle's bounding square. */
  left: number
  top: number
  size: number
  color: string
  role: HoldType
}

/** Pure geometry: the board box inside the canvas and one marker per hold. */
export function cardLayout(board: Pick<CatalogBoardDef, 'geometry'>, holds: ProblemHold[]): { box: CardBox; markers: CardMarker[] } {
  const g = board.geometry
  const height = CARD_HEIGHT - 2 * PAD
  const width = (height * g.width) / g.height
  const box: CardBox = { left: PAD, top: PAD, width, height }
  const colSpan = (width * (1 - g.leftMargin - g.rightMargin)) / g.numColumns
  const size = colSpan * MARKER_COLUMN_RATIO
  const markers = holds.map((hold) => {
    const { x, y } = center(g, hold.c, hold.r)
    const role = displayed(hold.t, true)
    return {
      left: box.left + x * width - size / 2,
      top: box.top + y * height - size / 2,
      size,
      color: holdColor[role] ?? holdColor.right,
      role,
    }
  })
  return { box, markers }
}

function nameFontSize(name: string): number {
  if (name.length <= 14) return 64
  if (name.length <= 26) return 52
  return 40
}

// "★" is not in the bundled Geist face (it renders as a box), so the card spells it out;
// the og:description keeps the glyph, which chat apps render from system fonts.
function metaLine(row: ProblemRow): string {
  const parts: string[] = []
  if (row.setter) parts.push(`by ${row.setter}`)
  parts.push(`${row.stars} ${row.stars === 1 ? 'star' : 'stars'}`, `${row.repeats} repeats`)
  return parts.join(' · ')
}

export function boardCardElement(args: { row: ProblemRow; board: CatalogBoardDef; art: string[] }): ReactElement {
  const { row, board, art } = args
  const { box, markers } = cardLayout(board, row.holds)
  const textLeft = box.left + box.width + GAP
  const textWidth = CARD_WIDTH - textLeft - PAD

  const overlays = art.map((src, i) =>
    h('img', {
      key: `art-${i}`,
      src,
      width: box.width,
      height: box.height,
      style: { position: 'absolute', left: 0, top: 0, width: box.width, height: box.height },
    }),
  )
  const circles = markers.map((m, i) =>
    h('div', {
      key: `hold-${i}`,
      style: {
        position: 'absolute',
        left: m.left - box.left,
        top: m.top - box.top,
        width: m.size,
        height: m.size,
        borderRadius: 9999,
        backgroundColor: `${m.color}${MARKER_FILL_ALPHA}`,
        border: `${MARKER_BORDER_PX}px solid ${m.color}`,
      },
    }),
  )

  return h(
    'div',
    {
      style: {
        display: 'flex',
        position: 'relative',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: CARD_BG,
        color: TEXT,
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          position: 'absolute',
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          backgroundColor: BOARD_BG,
          borderRadius: 16,
          overflow: 'hidden',
        },
      },
      ...overlays,
      ...circles,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          position: 'absolute',
          left: textLeft,
          top: PAD,
          width: textWidth,
          height: box.height,
        },
      },
      h('div', { style: { fontSize: nameFontSize(row.name), lineHeight: 1.1, fontWeight: 700 } }, row.name),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', marginTop: 20 } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              padding: '6px 18px',
              backgroundColor: BADGE_BG,
              borderRadius: 12,
              fontSize: 40,
              fontWeight: 700,
            },
          },
          row.grade,
        ),
        row.is_benchmark ? h('div', { style: { marginLeft: 16, fontSize: 24, color: MUTED } }, 'Benchmark') : null,
      ),
      h('div', { style: { marginTop: 28, fontSize: 30, color: MUTED } }, `${board.name} ${row.angle}°`),
      h('div', { style: { marginTop: 10, fontSize: 24, color: MUTED } }, metaLine(row)),
    ),
    h(
      'div',
      { style: { position: 'absolute', left: textLeft, top: CARD_HEIGHT - PAD - 28, fontSize: 24, color: FAINT } },
      'boardhang.app',
    ),
  )
}
