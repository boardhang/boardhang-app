// Pure serialization of a user's logbook (ascents) into downloadable files. No DOM,
// no React — the browser-download side effect lives in ./downloadFile. Two formats:
// a flat CSV for spreadsheet analysis, and a complete JSON envelope for backup /
// future round-trip (the raw ascent record is the canonical shape an importer would
// consume; catalog enrichment is nested and informational). Enrichment is best-effort:
// setter/benchmark/angle come from whatever the local catalog cache resolved, and rows
// with no match still export in full (blank enrichment).

import type { CatalogProblem } from '../catalog/catalogSync'
import type { Ascent } from './ascents'

export type ExportFormat = 'csv' | 'json'

/** Informational, denormalized catalog fields for an ascent. Null when the ascent's
 *  problem couldn't be resolved from the local catalog cache (user problem, or a board
 *  whose slab was never synced). A future importer ignores this block. */
interface CatalogEnrichment {
  setter: string
  isBenchmark: boolean
  angle: number
}

/** One exported record: the canonical ascent fields (round-trip shape) plus optional
 *  enrichment. */
interface AscentExportRecord {
  id: string
  date: string
  sourceCatalogId: string | null
  userProblemId: string | null
  problemName: string
  problemGrade: string
  votedGrade: string
  tries: number
  stars: number
  comment: string
  sent: boolean
  boardLayoutId: number
  catalog: CatalogEnrichment | null
}

export interface LogbookExport {
  version: 1
  exportedAt: string
  ascents: AscentExportRecord[]
}

function enrichmentFor(
  ascent: Ascent,
  catalogById: Map<string, CatalogProblem>,
): CatalogEnrichment | null {
  if (!ascent.sourceCatalogId) return null
  const problem = catalogById.get(ascent.sourceCatalogId)
  if (!problem) return null
  return { setter: problem.setter, isBenchmark: problem.is_benchmark, angle: problem.angle }
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const CSV_HEADER = [
  'date',
  'problemName',
  'problemGrade',
  'votedGrade',
  'tries',
  'stars',
  'result',
  'comment',
  'boardLayoutId',
  'setter',
  'benchmark',
  'angle',
] as const

/** RFC-4180 escaping plus formula-injection neutralization. A cell beginning with `=`,
 *  `+`, `-`, `@`, or a leading tab/CR is interpreted as a formula by Excel / Sheets /
 *  LibreOffice; `setter` and `problemName` come from the shared catalog (other users'
 *  content), so a crafted value could execute in a victim's spreadsheet. Prefix such a
 *  value with a `'` to force it to text, then apply the RFC-4180 quote rule. Numeric
 *  columns are `String(number)` and never match the trigger. */
function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

function csvRow(ascent: Ascent, catalogById: Map<string, CatalogProblem>): string {
  const c = enrichmentFor(ascent, catalogById)
  const cells = [
    ascent.date,
    ascent.problemName,
    ascent.problemGrade,
    ascent.votedGrade,
    String(ascent.tries),
    String(ascent.stars),
    ascent.sent ? 'send' : 'attempt',
    ascent.comment,
    String(ascent.boardLayoutId),
    c ? c.setter : '',
    c ? String(c.isBenchmark) : '',
    c ? String(c.angle) : '',
  ]
  return cells.map(csvField).join(',')
}

/** Serialize ascents to CSV (one header row + one row per ascent). All boards, both
 *  sends and attempts — the caller passes the full logbook; this applies no filtering. */
export function toCsv(ascents: Ascent[], catalogById: Map<string, CatalogProblem>): string {
  const lines = [CSV_HEADER.join(','), ...ascents.map((a) => csvRow(a, catalogById))]
  return lines.join('\n') + '\n'
}

// ── JSON ────────────────────────────────────────────────────────────────────

/** Serialize ascents to the JSON export envelope. `exportedAt` is injected (not read from
 *  the clock) so callers control it and tests stay deterministic. */
export function toJson(
  ascents: Ascent[],
  catalogById: Map<string, CatalogProblem>,
  exportedAt: string,
): LogbookExport {
  return {
    version: 1,
    exportedAt,
    ascents: ascents.map((a) => ({
      id: a.id,
      date: a.date,
      sourceCatalogId: a.sourceCatalogId,
      userProblemId: a.userProblemId,
      problemName: a.problemName,
      problemGrade: a.problemGrade,
      votedGrade: a.votedGrade,
      tries: a.tries,
      stars: a.stars,
      comment: a.comment,
      sent: a.sent,
      boardLayoutId: a.boardLayoutId,
      catalog: enrichmentFor(a, catalogById),
    })),
  }
}

// ── Filename ──────────────────────────────────────────────────────────────────

/** A dated filename so periodic backups are distinguishable, e.g.
 *  `boardhang-logbook-2026-07-22.csv`. Uses the UTC calendar date. */
export function exportFilename(format: ExportFormat, date: Date): string {
  const day = date.toISOString().slice(0, 10)
  return `boardhang-logbook-${day}.${format}`
}
