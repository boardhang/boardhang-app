// Pure derivations over a flat ascent list: day-"sessions" and the grade-pyramid
// aggregation. No storage / no React here so it stays unit-testable. Mirrors iOS
// `LogSession` (Ascent.swift) and `GradePyramidView.Model`.

import { FONT_GRADES } from '../board/grades'
import type { Ascent } from './ascents'
import { TRY_BUCKETS, tryBucket, type TryBucket } from './tryBucket'

export interface DaySession {
  /** Local start-of-day key (yyyy-MM-dd) — the group identity. */
  dayKey: string
  /** A representative Date in that day (for formatting). */
  date: Date
  /** Ascents that day, newest first. */
  ascents: Ascent[]
  /** e.g. "Tue 24 Jun — 5 problems". */
  title: string
}

const titleFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

/** Local calendar-day key for a Date (matches iOS `Calendar.current.startOfDay`). */
export function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Group ascents into day-sessions, newest day first and newest ascent first within
 *  each day. */
export function sessions(ascents: Ascent[]): DaySession[] {
  const groups = new Map<string, Ascent[]>()
  for (const a of ascents) {
    const key = localDayKey(new Date(a.date))
    const list = groups.get(key)
    if (list) list.push(a)
    else groups.set(key, [a])
  }

  return [...groups.entries()]
    .map(([dayKey, items]) => {
      const sorted = [...items].sort((x, y) => y.date.localeCompare(x.date))
      const date = new Date(sorted[0].date)
      const count = sorted.length
      return {
        dayKey,
        date,
        ascents: sorted,
        title: `${titleFormatter.format(date)} — ${count} problem${count === 1 ? '' : 's'}`,
      }
    })
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey))
}

/** One row of pyramid chart data: a grade plus the per-bucket send counts. Bucket keys
 *  match `TRY_BUCKETS` so `<Bar dataKey="Flash" …>` etc. read straight off it. */
export type PyramidRow = { grade: string; total: number } & Record<TryBucket, number>

export interface Pyramid {
  rows: PyramidRow[]
  /** Grades present, in canonical scale order (the x-domain). */
  domain: string[]
  /** Tallest bar's total — for the y-scale. */
  maxTotal: number
}

/**
 * Grade pyramid = unique *sends* bucketed by grade and try-count. Mirrors iOS exactly:
 * one ascent per distinct problem (earliest send kept), attempts-only excluded, counts
 * split by try-bucket, x-domain = grades present in canonical order.
 */
export function pyramid(ascents: Ascent[]): Pyramid {
  // One send per distinct problem — keep the earliest. Repeats and attempts don't count.
  const earliest = new Map<string, Ascent>()
  for (const a of ascents) {
    if (!a.sent) continue
    // Deliberately narrower than ascentIdentity (no userProblemId fallback): the iOS
    // pyramid keys by sourceCatalogID-or-problemName, and this must match it exactly.
    const key = a.sourceCatalogId ?? `name:${a.problemName}`
    const existing = earliest.get(key)
    if (!existing || a.date < existing.date) earliest.set(key, a)
  }

  // counts[grade][bucket]
  const counts = new Map<string, Record<TryBucket, number>>()
  for (const a of earliest.values()) {
    const bucket = tryBucket(a.tries)
    let perBucket = counts.get(a.problemGrade)
    if (!perBucket) {
      perBucket = { Flash: 0, '2nd': 0, '3rd': 0, '4+ tries': 0 }
      counts.set(a.problemGrade, perBucket)
    }
    perBucket[bucket] += 1
  }

  const domain = FONT_GRADES.filter((g) => counts.has(g))
  let maxTotal = 0
  const rows: PyramidRow[] = domain.map((grade) => {
    const perBucket = counts.get(grade)!
    const total = TRY_BUCKETS.reduce((sum, b) => sum + perBucket[b], 0)
    if (total > maxTotal) maxTotal = total
    return { grade, total, ...perBucket }
  })

  return { rows, domain, maxTotal }
}
