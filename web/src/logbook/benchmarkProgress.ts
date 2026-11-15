// Pure derivations for the Logbook's benchmark progress card: how many of a slab's
// benchmarks the user has sent, per grade, plus the remembered grade-range filter. No
// React here so it stays unit-testable (same split as sessions.ts).

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

/** Inclusive ordinal [min, max] over FONT_GRADES. */
export type GradeRange = [number, number]

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

/** The full span of grades that have benchmarks, or null when there are none. */
export function gradeSpan(rows: BenchmarkGradeRow[]): GradeRange | null {
  if (rows.length === 0) return null
  return [rows[0].ordinal, rows[rows.length - 1].ordinal]
}

/** Fit a remembered range inside the span. A range that misses the span entirely (or
 *  is inverted) falls back to the whole span. */
export function clampRange(range: GradeRange | null, span: GradeRange): GradeRange {
  if (!range) return span
  const lo = Math.max(range[0], span[0])
  const hi = Math.min(range[1], span[1])
  return lo <= hi ? [lo, hi] : span
}

export interface BenchmarkSummary {
  /** Rows inside the range, easiest first. */
  rows: BenchmarkGradeRow[]
  sent: number
  total: number
  /** Whole-number share sent, 0 when there is nothing to send. */
  percent: number
  /** Largest per-grade total among the rows — scales the track lengths. */
  maxTotal: number
}

/** Totals over the rows inside `range`. */
export function summarize(rows: BenchmarkGradeRow[], range: GradeRange): BenchmarkSummary {
  const inRange = rows.filter((r) => r.ordinal >= range[0] && r.ordinal <= range[1])
  let sent = 0
  let total = 0
  let maxTotal = 0
  for (const r of inRange) {
    sent += r.sent
    total += r.total
    if (r.total > maxTotal) maxTotal = r.total
  }
  return {
    rows: inRange,
    sent,
    total,
    percent: total === 0 ? 0 : Math.round((sent / total) * 100),
    maxTotal,
  }
}

// ── Remembered range (per board, this device) ─────────────────────────────────

const rangeKey = (layoutId: number) => `logbookBenchmarkGrades_${layoutId}`

/** The remembered range for a board, or null when none is stored / storage is unavailable. */
export function loadRange(layoutId: number): GradeRange | null {
  try {
    const m = /^(\d+)-(\d+)$/.exec(localStorage.getItem(rangeKey(layoutId)) ?? '')
    return m ? [Number(m[1]), Number(m[2])] : null
  } catch {
    return null
  }
}

/** Remember a range for a board; null clears it (the whole span is selected). */
export function saveRange(layoutId: number, range: GradeRange | null): void {
  try {
    if (range) localStorage.setItem(rangeKey(layoutId), `${range[0]}-${range[1]}`)
    else localStorage.removeItem(rangeKey(layoutId))
  } catch {
    /* best-effort — the filter still works for this visit */
  }
}

// ── Remembered "grades shown" toggle (this device) ────────────────────────────

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
