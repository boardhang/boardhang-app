import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { boardByLayoutId } from '../../src/board/boards.js'
import { MINI_GEOMETRY, STANDARD_GEOMETRY, center } from '../../src/board/renderGeometry.js'
import { holdColor } from '../../src/types.js'
import { CARD_HEIGHT, CARD_WIDTH, boardCardElement, cardLayout, cardText } from './boardCard.js'
import type { ProblemRow } from './catalogRow.js'

const mini = boardByLayoutId(7)!
const standard = boardByLayoutId(2)!

const row: ProblemRow = {
  source_catalog_id: 'abc',
  layout_id: 7,
  angle: 40,
  name: 'Chunky Monkey',
  grade: '7A',
  user_grade: null,
  setter: 'Alice',
  stars: 4,
  repeats: 120,
  is_benchmark: true,
  method: null,
  holds: [
    { c: 2, r: 1, t: 'start' },
    { c: 5, r: 6, t: 'right' },
    { c: 4, r: 9, t: 'left' },
    { c: 6, r: 12, t: 'end' },
  ],
  updated_at: '2026-09-01T10:00:00+00:00',
  deleted: false,
}

const art = mini.holdSets.map((s) => `data:image/png;base64,${s.imageName}`)

type Node = ReactElement<{ style?: Record<string, unknown>; children?: unknown; src?: string }>

function isElement(v: unknown): v is Node {
  return typeof v === 'object' && v !== null && 'props' in v && 'type' in v
}

function walk(node: unknown, visit: (n: Node) => void): void {
  if (!isElement(node)) return
  visit(node)
  const children = node.props.children
  for (const child of Array.isArray(children) ? children : [children]) walk(child, visit)
}

function texts(node: unknown): string[] {
  const out: string[] = []
  walk(node, (n) => {
    const children = n.props.children
    for (const c of Array.isArray(children) ? children : [children]) {
      if (typeof c === 'string' || typeof c === 'number') out.push(String(c))
    }
  })
  return out
}

describe('cardLayout', () => {
  it('sizes the board box to the layout aspect inside the fixed canvas', () => {
    const miniBox = cardLayout(mini, row.holds).box
    expect(miniBox.height).toBeLessThanOrEqual(CARD_HEIGHT)
    expect(miniBox.width / miniBox.height).toBeCloseTo(MINI_GEOMETRY.width / MINI_GEOMETRY.height, 3)
    const stdBox = cardLayout(standard, row.holds).box
    expect(stdBox.width / stdBox.height).toBeCloseTo(STANDARD_GEOMETRY.width / STANDARD_GEOMETRY.height, 3)
    expect(stdBox.left + stdBox.width).toBeLessThan(CARD_WIDTH)
  })

  it('places one marker per hold at center() scaled to the box, 0.9 of a column wide, in role colors', () => {
    const { box, markers } = cardLayout(mini, row.holds)
    expect(markers).toHaveLength(4)
    const g = MINI_GEOMETRY
    const colSpan = (box.width * (1 - g.leftMargin - g.rightMargin)) / g.numColumns
    const expectedSize = colSpan * 0.9
    row.holds.forEach((h, i) => {
      const { x, y } = center(g, h.c, h.r)
      const m = markers[i]
      expect(m.size).toBeCloseTo(expectedSize, 5)
      expect(m.left).toBeCloseTo(box.left + x * box.width - expectedSize / 2, 5)
      expect(m.top).toBeCloseTo(box.top + y * box.height - expectedSize / 2, 5)
    })
    expect(markers.map((m) => m.color)).toEqual([holdColor.start, holdColor.right, holdColor.left, holdColor.end])
  })
})

describe('boardCardElement', () => {
  const element = boardCardElement({ row, board: mini, art })

  it('is a 1200×630 root', () => {
    const style = (element as Node).props.style ?? {}
    expect(style.width).toBe(CARD_WIDTH)
    expect(style.height).toBe(CARD_HEIGHT)
  })

  it('stacks one overlay image per hold set, in registry order', () => {
    const srcs: string[] = []
    walk(element, (n) => {
      if (n.type === 'img' && typeof n.props.src === 'string') srcs.push(n.props.src)
    })
    expect(srcs).toEqual(art)
  })

  it('draws exactly one circle per hold', () => {
    let circles = 0
    walk(element, (n) => {
      const s = n.props.style ?? {}
      if (n.type === 'div' && s.borderRadius === 9999) circles += 1
    })
    expect(circles).toBe(4)
  })

  it('carries the name, grade, board and angle as text', () => {
    const all = texts(element).join(' | ')
    expect(all).toContain('Chunky Monkey')
    expect(all).toContain('7A')
    expect(all).toContain('Mini MoonBoard 2025 40°')
    expect(all).toContain('by Alice · 4 stars · 120 repeats')
    expect(all).not.toContain('★')
    expect(all).toContain('Benchmark')
  })

  it('picks the name font size by length tier', () => {
    const sizeOf = (name: string) => {
      let size: unknown
      walk(boardCardElement({ row: { ...row, name }, board: mini, art }), (n) => {
        const children = n.props.children
        if (children === name) size = n.props.style?.fontSize
      })
      return size
    }
    expect(sizeOf('Short name')).toBe(64)
    expect(sizeOf('A medium length name')).toBe(52)
    expect(sizeOf('A very long problem name that wraps')).toBe(40)
  })

  it('omits the setter when empty, uses singular "star", and omits Benchmark when not one', () => {
    const all = texts(boardCardElement({ row: { ...row, setter: '', stars: 1, is_benchmark: false }, board: mini, art })).join(' | ')
    expect(all).toContain('1 star · 120 repeats')
    expect(all).not.toContain('by ')
    expect(all).not.toContain('Benchmark')
  })

  it('strips glyphs the bundled face cannot render from card text, keeping Latin and Cyrillic', () => {
    expect(cardText('EASY DOES IT 🔆')).toBe('EASY DOES IT')
    expect(cardText('Café Ünïcödé — ok')).toBe('Café Ünïcödé — ok')
    expect(cardText('Проблема')).toBe('Проблема')
    expect(cardText('日本語の課題 ★')).toBe('')
    expect(cardText('  spaced   out  ')).toBe('spaced out')
    // An emoji ZWJ sequence leaves no stray joiner behind; zero-width format chars go too.
    expect(cardText('Dyno \u{1F9D7}\u200D\u2640\uFE0F time')).toBe('Dyno time')
    expect(cardText('zero\u200Bwidth\u200D')).toBe('zerowidth')
  })

  it('renders no name node when the name has no renderable glyphs, and strips the setter too', () => {
    const el = boardCardElement({ row: { ...row, name: '日本語 🧗', setter: 'Ωmega 👑' }, board: mini, art })
    const all = texts(el)
    expect(all).not.toContain('日本語 🧗')
    expect(all.join(' | ')).toContain('by mega · 4 stars')
    expect(all.join(' | ')).toContain('7A')
  })

  it('declares display flex on every element with more than one child (Satori rule)', () => {
    const offenders: string[] = []
    walk(element, (n) => {
      const children = n.props.children
      const count = Array.isArray(children) ? children.filter((c) => c !== null && c !== false && c !== undefined).length : 0
      if (count > 1 && n.props.style?.display !== 'flex') offenders.push(String(n.type))
    })
    expect(offenders).toEqual([])
  })
})
