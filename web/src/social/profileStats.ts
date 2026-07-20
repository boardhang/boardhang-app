// Pure derivation over a user's sends for the profile page (R19): the most-recent climbing
// "session" (a local calendar day's cluster). No storage / no React here so it stays
// unit-testable. The grade breakdown itself reuses the logbook's `pyramid()` (try-bucket split),
// so it lives there, not here.

import type { SendItem } from './socialTypes'

export interface SessionCluster {
  /** A representative Date in that day (for formatting). */
  date: Date
  /** The sends climbed that day, newest first. */
  sends: SendItem[]
}

/** Local calendar-day key for a Date (mirrors logbook `sessions.ts` / iOS startOfDay). */
function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * The most recent climbing session = the sends from the latest local calendar day, grouped by
 * `climbedAt` (when the climb happened), newest first. Null when there are no sends. Derived
 * from loaded sends; since sends arrive newest-first the latest day is fully present unless a
 * single day exceeds one page (not a real case here).
 */
export function latestSession(sends: SendItem[]): SessionCluster | null {
  if (sends.length === 0) return null
  const byRecent = [...sends].sort((a, b) => b.climbedAt.localeCompare(a.climbedAt))
  const dayKey = localDayKey(new Date(byRecent[0].climbedAt))
  const group = byRecent.filter((s) => localDayKey(new Date(s.climbedAt)) === dayKey)
  return { date: new Date(group[0].climbedAt), sends: group }
}
