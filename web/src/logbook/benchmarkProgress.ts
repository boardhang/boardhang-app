// Pure derivations for the Logbook's benchmark progress card: how many of a slab's
// benchmarks the user has sent, per grade, and which grade range the card covers. No React
// here so it stays unit-testable (same split as sessions.ts).

import { FONT_GRADES, GRADE_FILTER_FLOOR } from '../board/grades'
import type { CatalogHold, CatalogProblem } from '../catalog/catalogSync'

/** One grade's benchmark progress. */
export interface BenchmarkGradeRow {
  /** Position on FONT_GRADES (floored at GRADE_FILTER_FLOOR, like the catalog's grade filter). */
  ordinal: number
  grade: string
  sent: number
  total: number
}

/**
 * Per-grade benchmark counts for a slab, easiest grade first. Only benchmarks climbable
 * with the installed hold sets count, so 100% is reachable on the wall as built. Grades
 * below the filter floor are bucketed into the floor grade — the catalog's grade filter
 * treats them the same way, so a row's count matches what its catalog link shows.
 * Problems with a grade off the canonical scale are skipped.
 */
export function benchmarkRows(
  problems: CatalogProblem[],
  sentIds: ReadonlySet<string>,
  isClimbable: (holds: CatalogHold[]) => boolean,
): BenchmarkGradeRow[] {
  const byOrdinal = new Map<number, { sent: number; total: number }>()
  for (const p of problems) {
    if (!p.is_benchmark) continue
    const index = FONT_GRADES.indexOf(p.grade)
    if (index === -1) continue
    if (!isClimbable(p.holds)) continue
    const ordinal = Math.max(index, GRADE_FILTER_FLOOR)
    let entry = byOrdinal.get(ordinal)
    if (!entry) {
      entry = { sent: 0, total: 0 }
      byOrdinal.set(ordinal, entry)
    }
    entry.total += 1
    if (sentIds.has(p.source_catalog_id)) entry.sent += 1
  }
  return [...byOrdinal.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ordinal, counts]) => ({ ordinal, grade: FONT_GRADES[ordinal], ...counts }))
}

/** Inclusive ordinal [min, max] over FONT_GRADES. */
export type GradeRange = [number, number]

/** The full span of grades that have benchmarks, or null when there are none. */
export function gradeSpan(rows: BenchmarkGradeRow[]): GradeRange | null {
  if (rows.length === 0) return null
  return [rows[0].ordinal, rows[rows.length - 1].ordinal]
}

/**
 * The "up to my hardest send" range: from the easiest grade up to the hardest grade
 * with a send. Grades above it are the ones the user hasn't reached; a grade with
 * no sends *below* it is a gap worth seeing and stays in. With no sends at all there is
 * nothing to trim by, so it is the whole span.
 */
export function defaultRange(rows: BenchmarkGradeRow[]): GradeRange | null {
  const span = gradeSpan(rows)
  if (!span) return null
  let hardest = -1
  for (const row of rows) if (row.sent > 0) hardest = row.ordinal
  return [span[0], hardest === -1 ? span[1] : hardest]
}

/** Fit a remembered range inside the span; one that misses the span entirely (or is
 *  inverted) is dropped so the caller falls back to the default. */
export function clampRange(range: GradeRange | null, span: GradeRange): GradeRange | null {
  if (!range) return null
  const lo = Math.max(range[0], span[0])
  const hi = Math.min(range[1], span[1])
  return lo <= hi ? [lo, hi] : null
}

/** The rows whose grade falls inside the range, easiest first. */
export function rowsInRange(rows: BenchmarkGradeRow[], range: GradeRange): BenchmarkGradeRow[] {
  return rows.filter((r) => r.ordinal >= range[0] && r.ordinal <= range[1])
}

export interface BenchmarkSummary {
  sent: number
  total: number
  /** Whole-number share sent, 0 when there is nothing to send. */
  percent: number
  /** Largest per-grade total among the rows — scales the track lengths. */
  maxTotal: number
}

/** Totals over the given rows. */
export function summarize(rows: BenchmarkGradeRow[]): BenchmarkSummary {
  let sent = 0
  let total = 0
  let maxTotal = 0
  for (const r of rows) {
    sent += r.sent
    total += r.total
    if (r.total > maxTotal) maxTotal = r.total
  }
  return { sent, total, percent: total === 0 ? 0 : Math.round((sent / total) * 100), maxTotal }
}

// ── Remembered on this device ─────────────────────────────────────────────────

const rangeKey = (layoutId: number) => `logbookBenchmarkGrades_${layoutId}`

/** The custom grade range the user set for a board, or null when they haven't set one. */
export function loadRange(layoutId: number): GradeRange | null {
  try {
    const m = /^(\d+)-(\d+)$/.exec(localStorage.getItem(rangeKey(layoutId)) ?? '')
    return m ? [Number(m[1]), Number(m[2])] : null
  } catch {
    return null
  }
}

/** Remember a custom range for a board; null forgets it. */
export function saveRange(layoutId: number, range: GradeRange | null): void {
  try {
    if (range) localStorage.setItem(rangeKey(layoutId), `${range[0]}-${range[1]}`)
    else localStorage.removeItem(rangeKey(layoutId))
  } catch {
    /* best-effort — the range still applies for this visit */
  }
}

/** Which grades the card covers: up to the hardest send, every grade, or a custom range. */
export type RangeMode = 'hardest' | 'all' | 'custom'

const MODE_KEY = 'logbookBenchmarkRange'

/** The chosen mode. "Up to my hardest send" until the user picks another. */
export function loadMode(): RangeMode {
  try {
    const raw = localStorage.getItem(MODE_KEY)
    return raw === 'all' || raw === 'custom' ? raw : 'hardest'
  } catch {
    return 'hardest'
  }
}

export function saveMode(mode: RangeMode): void {
  try {
    if (mode === 'hardest') localStorage.removeItem(MODE_KEY)
    else localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* best-effort */
  }
}

const EXPANDED_KEY = 'logbookBenchmarkExpanded'

/** Whether the per-grade bars were left open. Collapsed by default. */
export function loadExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

export function saveExpanded(expanded: boolean): void {
  try {
    if (expanded) localStorage.setItem(EXPANDED_KEY, '1')
    else localStorage.removeItem(EXPANDED_KEY)
  } catch {
    /* best-effort */
  }
}
