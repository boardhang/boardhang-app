// Try-buckets — how many attempts an ascent took, grouped for the grade pyramid and
// the logbook badges. Mirrors iOS `TryBucket` (ios/MoonBoardLED/Views/TryBadge.swift)
// so labels/colors stay consistent across platforms.

export const TRY_BUCKETS = ['Flash', '2nd', '3rd', '4+ tries'] as const
export type TryBucket = (typeof TRY_BUCKETS)[number]

/** Bucket an attempt count: ≤1 → Flash, 2 → 2nd, 3 → 3rd, else 4+ tries. */
export function tryBucket(tries: number): TryBucket {
  if (tries <= 1) return 'Flash'
  if (tries === 2) return '2nd'
  if (tries === 3) return '3rd'
  return '4+ tries'
}

/** Pyramid segment colors, mirroring iOS (flash yellow · 2nd blue · 3rd green · 4+ red).
 *  Hex is intentional here — like `holdColor` in board/grades, these are data-encoding
 *  hues, not theme surface colors. */
export const TRY_BUCKET_COLOR: Record<TryBucket, string> = {
  Flash: '#f59e0b', // amber
  '2nd': '#3b82f6', // blue
  '3rd': '#22c55e', // green
  '4+ tries': '#ef4444', // red
}

/** Compact tries label for a logbook row or the log sheet: a one-try *send* reads
 *  "Flash" — but only on a problem with no logged history; with earlier tries or sends
 *  on record it reads "Session flash" (flash is reserved for never-tried problems).
 *  Anything else reads "N try/tries" — a single unsent attempt is "1 try", never a flash. */
export function triesLabel(tries: number, sent: boolean, hasPriorHistory = false): string {
  if (sent && tries <= 1) return hasPriorHistory ? 'Session flash' : 'Flash'
  return `${tries} ${tries === 1 ? 'try' : 'tries'}`
}
