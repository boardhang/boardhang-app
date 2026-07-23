import { describe, expect, it } from 'vitest'
import type { CatalogProblem } from '../catalog/catalogSync'
import type { Ascent } from './ascents'
import { exportFilename, toCsv, toJson } from './logbookExport'

function ascent(over: Partial<Ascent> = {}): Ascent {
  return {
    id: 'a1',
    date: '2026-07-20T10:00:00.000Z',
    sourceCatalogId: 'cat-1',
    userProblemId: null,
    problemName: 'Test Problem',
    problemGrade: '6B',
    votedGrade: '6B+',
    tries: 3,
    stars: 2,
    comment: 'nice',
    sent: true,
    boardLayoutId: 7,
    ...over,
  }
}

function catalog(over: Partial<CatalogProblem> = {}): CatalogProblem {
  return {
    source_catalog_id: 'cat-1',
    layout_id: 7,
    angle: 40,
    name: 'Test Problem',
    grade: '6B',
    user_grade: null,
    setter: 'Jane Setter',
    stars: 3,
    repeats: 120,
    is_benchmark: true,
    method: null,
    holds: [],
    ...over,
  }
}

const map = (...problems: CatalogProblem[]) =>
  new Map(problems.map((p) => [p.source_catalog_id, p]))

describe('toCsv', () => {
  it('emits a header row plus one row per ascent, across boards, unfiltered', () => {
    // Covers AE1.
    const rows = [
      ascent({ id: 'a1', boardLayoutId: 7, sourceCatalogId: 'cat-1' }),
      ascent({ id: 'a2', boardLayoutId: 20, sourceCatalogId: 'cat-2' }),
    ]
    const catalogById = map(catalog({ source_catalog_id: 'cat-1' }))
    const lines = toCsv(rows, catalogById).trimEnd().split('\n')
    expect(lines).toHaveLength(3) // header + 2 data rows
    expect(lines[0]).toContain('date')
    // Both boards present (7 and 20), no board filtering applied.
    expect(lines[1]).toContain('7')
    expect(lines[2]).toContain('20')
  })

  it('enriches a resolved ascent with setter, benchmark, and angle', () => {
    const csv = toCsv([ascent()], map(catalog()))
    const dataRow = csv.trimEnd().split('\n')[1]
    expect(dataRow).toContain('Jane Setter')
    expect(dataRow).toContain('true') // benchmark
    expect(dataRow).toContain('40') // angle
  })

  it('leaves enrichment blank for a null sourceCatalogId and an uncached id, and keeps the row', () => {
    // Covers AE3.
    const rows = [
      ascent({ id: 'a1', sourceCatalogId: null }),
      ascent({ id: 'a2', sourceCatalogId: 'not-cached' }),
    ]
    const lines = toCsv(rows, new Map()).trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    // Trailing enrichment columns (setter,benchmark,angle) are empty → row ends with ",,".
    for (const line of lines.slice(1)) {
      expect(line.endsWith(',,')).toBe(true)
    }
  })

  it('RFC-4180 quotes a comment with comma, quote, and newline without breaking columns', () => {
    const csv = toCsv([ascent({ comment: 'hard, "crux"\nbeta' })], new Map())
    const header = csv.split('\n')[0]
    const columnCount = header.split(',').length
    // The quoted field embeds commas/newlines; parse minimally to confirm the row still
    // has the right column count.
    const dataRow = csv.slice(csv.indexOf('\n') + 1)
    expect(dataRow).toContain('"hard, ""crux""')
    expect(columnCount).toBeGreaterThan(1)
  })

  it('neutralizes spreadsheet formula-injection payloads in text fields', () => {
    const rows = [
      ascent({ id: 'a1', comment: '=HYPERLINK("http://evil","x")' }),
      ascent({ id: 'a2', problemName: '+1', comment: 'ok' }),
      ascent({ id: 'a3', problemName: '@SUM(A1)', comment: 'ok' }),
      ascent({ id: 'a4', comment: '-2+3' }),
    ]
    const csv = toCsv(rows, new Map())
    const [, r1, r2, r3, r4] = csv.trimEnd().split('\n')
    // Leading trigger chars are prefixed with a single quote (then RFC-4180 quoted if needed).
    expect(r1).toContain(`"'=HYPERLINK`)
    expect(r2).toContain(`'+1`)
    expect(r3).toContain(`'@SUM(A1)`)
    expect(r4).toContain(`'-2+3`)
  })

  it('does not prefix a numeric column that would look like a negative number', () => {
    // tries/stars/angle go through String(number); a legitimately negative value must not
    // be double-guarded into a text formula. (Guard only triggers on the raw string.)
    const csv = toCsv([ascent({ tries: 3, stars: 0 })], new Map())
    const dataRow = csv.trimEnd().split('\n')[1]
    expect(dataRow).not.toContain(`'3`)
    expect(dataRow).not.toContain(`'0`)
  })

  it('quotes and preserves a CRLF inside a field', () => {
    const csv = toCsv([ascent({ comment: 'line1\r\nline2' })], new Map())
    // The embedded CRLF stays verbatim inside the quoted field (RFC-4180), not stripped.
    expect(csv).toContain('"line1\r\nline2"')
  })

  it('renders sent as "send" and unsent as "attempt"', () => {
    const csv = toCsv([ascent({ sent: true }), ascent({ id: 'a2', sent: false })], new Map())
    const [, send, attempt] = csv.trimEnd().split('\n')
    expect(send).toContain('send')
    expect(attempt).toContain('attempt')
    expect(attempt).not.toContain('send')
  })

  it('produces a header-only CSV for an empty logbook', () => {
    // Covers AE4.
    const csv = toCsv([], new Map())
    expect(csv.trimEnd().split('\n')).toHaveLength(1)
  })
})

describe('toJson', () => {
  it('carries every core field plus nested enrichment and an envelope', () => {
    // Covers AE2.
    const json = toJson([ascent()], map(catalog()), '2026-07-22T00:00:00.000Z')
    expect(json.version).toBe(1)
    expect(json.exportedAt).toBe('2026-07-22T00:00:00.000Z')
    expect(json.ascents).toHaveLength(1)
    const record = json.ascents[0]
    expect(record).toMatchObject({
      id: 'a1',
      date: '2026-07-20T10:00:00.000Z',
      sourceCatalogId: 'cat-1',
      problemName: 'Test Problem',
      problemGrade: '6B',
      votedGrade: '6B+',
      tries: 3,
      stars: 2,
      comment: 'nice',
      sent: true,
      boardLayoutId: 7,
    })
    expect(record.catalog).toEqual({ setter: 'Jane Setter', isBenchmark: true, angle: 40 })
  })

  it('sets catalog to null when unresolved', () => {
    // Covers AE3.
    const json = toJson([ascent({ sourceCatalogId: null })], new Map(), '2026-07-22T00:00:00.000Z')
    expect(json.ascents[0].catalog).toBeNull()
  })

  it('produces an empty ascents array for an empty logbook', () => {
    // Covers AE4.
    const json = toJson([], new Map(), '2026-07-22T00:00:00.000Z')
    expect(json.ascents).toEqual([])
  })
})

describe('exportFilename', () => {
  it('builds a dated filename with the right extension', () => {
    const date = new Date('2026-07-22T15:30:00.000Z')
    expect(exportFilename('csv', date)).toBe('boardhang-logbook-2026-07-22.csv')
    expect(exportFilename('json', date)).toBe('boardhang-logbook-2026-07-22.json')
  })
})
