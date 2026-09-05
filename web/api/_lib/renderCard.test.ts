// @vitest-environment node
// Integration: really render two cards through @vercel/og (satori + resvg) with the
// bundled board art. Proves the WASM assets load under Node, the element tree is
// Satori-valid, and the output is a 1200×630 PNG. Logs the byte sizes as the first
// reading for the 300 KB WhatsApp budget (the preview deploy is the authoritative gate).

import { describe, expect, it } from 'vitest'
import { boardByLayoutId } from '../../src/board/boards.js'
import { loadBoardArt } from './boardArt.js'
import { boardCardElement } from './boardCard.js'
import type { ProblemRow } from './catalogRow.js'
import { renderCard } from './renderCard.js'

function row(layout_id: number, holds: ProblemRow['holds']): ProblemRow {
  return {
    source_catalog_id: 'abc',
    layout_id,
    angle: 40,
    name: 'A Fairly Long Problem Name Here',
    grade: '7B+',
    user_grade: null,
    setter: 'Alice Setterson',
    stars: 4,
    repeats: 1200,
    is_benchmark: true,
    method: null,
    holds,
    updated_at: '2026-09-01T10:00:00+00:00',
    deleted: false,
  }
}

function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('renderCard', () => {
  it.each([
    ['Mini 2025', 7, [{ c: 2, r: 1, t: 'start' }, { c: 5, r: 6, t: 'right' }, { c: 6, r: 12, t: 'end' }]],
    ['Masters 2019', 5, [{ c: 2, r: 1, t: 'start' }, { c: 5, r: 9, t: 'left' }, { c: 6, r: 18, t: 'end' }]],
  ] as const)('renders a 1200×630 PNG for %s', async (label, layoutId, holds) => {
    const board = boardByLayoutId(layoutId)!
    const art = await loadBoardArt(board)
    const element = boardCardElement({ row: row(layoutId, [...holds]), board, art })
    const res = await renderCard(element, { headers: { 'cache-control': 'no-store' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(pngSize(buf)).toEqual({ width: 1200, height: 630 })
    console.log(`[renderCard] ${label}: ${buf.byteLength} bytes`)
    // CARD_OUT=<dir> writes the PNGs out for eyeballing marker placement against the app.
    if (process.env.CARD_OUT) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(`${process.env.CARD_OUT}/card-${label.replace(/\s+/g, '-')}.png`, buf)
    }
  }, 60_000)
})
