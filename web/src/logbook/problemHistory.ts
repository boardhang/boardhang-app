// Pure derivations over the ascent list answering "has this problem been tried
// before?" — the data behind absorb-on-send (folding today's attempt row into a send)
// and the Flash / Session flash distinction. No storage / no React, like sessions.ts.

import type { Ascent } from './ascents'
import { localDayKey } from './sessions'

/** The stable problem key ascent rows merge/match on — `source_catalog_id` for catalog
 *  problems, the user-problem id for user problems, the name as a last resort. The one
 *  definition shared by the attempt merge, the log sheet, and history lookups. */
export function ascentIdentity(a: {
  sourceCatalogId: string | null
  userProblemId?: string | null
  problemName: string
}): string {
  return a.sourceCatalogId ?? a.userProblemId ?? `name:${a.problemName}`
}

/** What the log-send sheet needs to know about a problem's logged past. */
export interface ProblemLogContext {
  /** Today's unsent attempt row — LOCAL calendar day, the user's "today", matching the
   *  logbook's grouping, the confirm gate, and iOS's same-calendar-day merge. (The
   *  deterministic attempt id buckets by UTC day, but the absorb deletes by row id, so
   *  the merge bucket doesn't constrain this lookup — matching by UTC day instead
   *  would let a post-midnight send absorb a row the logbook shows under yesterday.) */
  todayAttempt: Ascent | null
  /** The most recent send already logged today (LOCAL day), or null. A second
   *  same-day send asks first. */
  todaySend: Ascent | null
  /** Distinct earlier local days with any logged rows (attempts or sends). */
  priorDays: number
  /** Any logged history at all for this problem. */
  hasHistory: boolean
}

/** Derive the logged-history context for `identity` as of `now`. */
export function problemLogContext(
  ascents: Ascent[],
  identity: string,
  now: Date,
): ProblemLogContext {
  const rows = ascents.filter((a) => ascentIdentity(a) === identity)
  const todayLocal = localDayKey(now)
  const todayAttempt =
    rows.find((a) => !a.sent && localDayKey(new Date(a.date)) === todayLocal) ?? null
  let todaySend: Ascent | null = null
  const priorDayKeys = new Set<string>()
  for (const a of rows) {
    const key = localDayKey(new Date(a.date))
    if (key < todayLocal) priorDayKeys.add(key)
    if (a.sent && key === todayLocal && (!todaySend || a.date > todaySend.date)) todaySend = a
  }
  return { todayAttempt, todaySend, priorDays: priorDayKeys.size, hasHistory: rows.length > 0 }
}

/** Ids of ascents whose problem has an earlier-dated logged row (attempt or send) —
 *  those rows' one-try sends read "Session flash" instead of "Flash". */
export function priorHistoryIds(ascents: Ascent[]): Set<string> {
  const byIdentity = new Map<string, Ascent[]>()
  for (const a of ascents) {
    const key = ascentIdentity(a)
    const list = byIdentity.get(key)
    if (list) list.push(a)
    else byIdentity.set(key, [a])
  }
  const out = new Set<string>()
  for (const rows of byIdentity.values()) {
    if (rows.length < 2) continue
    const earliestDate = rows.reduce((min, a) => (a.date < min ? a.date : min), rows[0].date)
    for (const a of rows) {
      if (a.date > earliestDate) out.add(a.id)
    }
  }
  return out
}
