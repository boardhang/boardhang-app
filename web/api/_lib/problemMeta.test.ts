import { describe, expect, it } from 'vitest'
import { boardByLayoutId } from '../../src/board/boards.js'
import type { ProblemRow } from './catalogRow.js'
import {
  canonicalProblemUrl,
  problemDescription,
  problemImageUrl,
  renderGenericMeta,
  renderProblemMeta,
} from './problemMeta.js'

const board = boardByLayoutId(2)!

const row: ProblemRow = {
  source_catalog_id: 'abc',
  layout_id: 2,
  angle: 40,
  name: 'Chunky Monkey',
  grade: '7A',
  user_grade: null,
  setter: 'Alice',
  stars: 4,
  repeats: 120,
  is_benchmark: true,
  method: null,
  holds: [{ c: 0, r: 1, t: 'start' }],
  updated_at: '2026-09-01T10:00:00+00:00',
  deleted: false,
}

const origin = 'https://preview.example'

/** Pull `content` of the first meta tag with the given property/name attribute. */
function meta(html: string, key: string): string | null {
  const m = html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))
  return m ? m[1] : null
}

describe('URLs', () => {
  it('canonical link is the catalog deep link on the given origin', () => {
    expect(canonicalProblemUrl(origin, row)).toBe('https://preview.example/board/2/catalog?angle=40&problem=abc')
  })

  it('image URL carries the id and the updated_at version', () => {
    expect(problemImageUrl(origin, row)).toBe(
      'https://preview.example/api/og-image?problem=abc&v=2026-09-01T10%3A00%3A00%2B00%3A00',
    )
  })
})

describe('problemDescription', () => {
  it('lists board, angle, setter, stars, repeats and Benchmark', () => {
    expect(problemDescription(row, board)).toBe('MoonBoard 2016 40° · by Alice · ★4 · 120 repeats · Benchmark')
  })

  it('omits the setter segment when empty and Benchmark when not a benchmark', () => {
    expect(problemDescription({ ...row, setter: '', is_benchmark: false }, board)).toBe(
      'MoonBoard 2016 40° · ★4 · 120 repeats',
    )
  })
})

describe('renderProblemMeta', () => {
  const html = renderProblemMeta({ row, board, origin })

  it('carries the per-problem Open Graph and Twitter tags', () => {
    expect(meta(html, 'og:title')).toBe('Chunky Monkey 7A')
    expect(meta(html, 'og:description')).toBe('MoonBoard 2016 40° · by Alice · ★4 · 120 repeats · Benchmark')
    expect(meta(html, 'og:type')).toBe('website')
    expect(meta(html, 'og:url')).toBe('https://preview.example/board/2/catalog?angle=40&amp;problem=abc')
    expect(meta(html, 'og:image')).toBe(
      'https://preview.example/api/og-image?problem=abc&amp;v=2026-09-01T10%3A00%3A00%2B00%3A00',
    )
    expect(meta(html, 'og:image:width')).toBe('1200')
    expect(meta(html, 'og:image:height')).toBe('630')
    expect(meta(html, 'og:image:type')).toBe('image/png')
    expect(meta(html, 'twitter:card')).toBe('summary_large_image')
    expect(html.match(/property="og:title"/g)).toHaveLength(1)
    expect(html).toContain('<title>Chunky Monkey 7A</title>')
  })

  it('escapes user-submitted strings in the title and attributes', () => {
    const nasty = renderProblemMeta({
      row: { ...row, name: '<script>alert("x")</script> & "quote"', setter: "O'Brien <b>" },
      board,
      origin,
    })
    expect(nasty).not.toContain('<script>')
    expect(nasty).toContain('&lt;script&gt;')
    expect(meta(nasty, 'og:title')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quote&quot; 7A')
    expect(meta(nasty, 'og:description')).toContain('by O&#39;Brien &lt;b&gt;')
  })
})

describe('renderGenericMeta', () => {
  it('carries the generic Boardhang tags and the static og.png', () => {
    const html = renderGenericMeta({ origin })
    expect(meta(html, 'og:title')).toBe('Boardhang')
    expect(meta(html, 'og:image')).toBe('https://preview.example/og.png')
    expect(meta(html, 'og:url')).toBe('https://preview.example/')
    expect(meta(html, 'twitter:card')).toBe('summary_large_image')
  })
})
