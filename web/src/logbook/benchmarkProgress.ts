// Pure derivations for the Logbook's benchmark progress card: how many of a slab's
// benchmarks the user has sent, per grade, and which grades the card shows. No React
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

/**
 * The rows up to and including the hardest grade with a send. Grades above it are the
 * ones the user hasn't reached; a grade with no sends *below* it is a gap worth seeing
 * and stays. With no sends at all there is nothing to trim by, so every row is kept.
 */
export function rowsUpToHardestSend(rows: BenchmarkGradeRow[]): BenchmarkGradeRow[] {
  let last = -1
  rows.forEach((row, i) => {
    if (row.sent > 0) last = i
  })
  return last === -1 ? rows : rows.slice(0, last + 1)
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

// ── Remembered toggles (this device) ──────────────────────────────────────────

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function saveFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    /* best-effort — the toggle still works for this visit */
  }
}

const EXPANDED_KEY = 'logbookBenchmarkExpanded'
const ALL_GRADES_KEY = 'logbookBenchmarkAllGrades'

/** Whether the per-grade bars were left open. Collapsed by default. */
export const loadExpanded = () => loadFlag(EXPANDED_KEY)
export const saveExpanded = (expanded: boolean) => saveFlag(EXPANDED_KEY, expanded)

/** Whether grades above the hardest send are shown too. Hidden by default. */
export const loadAllGrades = () => loadFlag(ALL_GRADES_KEY)
export const saveAllGrades = (all: boolean) => saveFlag(ALL_GRADES_KEY, all)
