// The canonical share link for a problem, and the share-or-copy action behind the
// drawer's Share button. Built from the problem ROW (layout_id, angle, id) — never
// from the route, props, or the address bar: the logbook host renders the drawer
// against the active board, and the catalog address bar strips the default angle
// and carries the sharer's personal filters. Origin follows joinUrl.ts
// (window.location.origin) so prod, preview and localhost all produce working links.
//
// `problemShareUrl` is the single seam for the link's shape: the later switch to
// apex content URLs (docs/content-site.md) changes this one function.

import type { CatalogProblem } from './catalogSync'

type ShareableProblem = Pick<CatalogProblem, 'layout_id' | 'angle' | 'source_catalog_id' | 'name' | 'grade'>

/** `{origin}/board/{layout}/catalog?angle={angle}&problem={id}` — angle always explicit. */
export function problemShareUrl(problem: Pick<ShareableProblem, 'layout_id' | 'angle' | 'source_catalog_id'>): string {
  const params = new URLSearchParams({
    angle: String(problem.angle),
    problem: problem.source_catalog_id,
  })
  return `${window.location.origin}/board/${problem.layout_id}/catalog?${params.toString()}`
}

/** The text that rides along in the share sheet: "Name Grade". Never contains the URL
 *  (Android apps concatenate text and url, which would duplicate the link). */
export function problemShareText(problem: Pick<ShareableProblem, 'name' | 'grade'>): string {
  return `${problem.name} ${problem.grade}`
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed'

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

async function copyLink(url: string): Promise<'copied' | 'failed'> {
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/**
 * Share the problem: native share sheet when the browser has one, else copy the link.
 *
 * `navigator.share` is invoked synchronously — before any `await` — because Safari
 * revokes the tap's transient activation across a microtask and rejects with
 * NotAllowedError. Cancelling the sheet (AbortError) is a silent no-op; any other
 * rejection, or no share API at all, falls back to the clipboard once. The caller
 * decides what to toast from the outcome.
 */
export function shareProblem(problem: ShareableProblem): Promise<ShareOutcome> {
  const url = problemShareUrl(problem)
  const text = problemShareText(problem)
  const nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined
  if (nav && typeof nav.share === 'function') {
    let pending: Promise<void>
    try {
      pending = nav.share({ title: text, text, url })
    } catch {
      // A synchronous throw (e.g. a TypeError on an unsupported payload) — treat as absent.
      return copyLink(url)
    }
    return pending.then(
      () => 'shared' as const,
      (err: unknown) => (isAbort(err) ? ('cancelled' as const) : copyLink(url)),
    )
  }
  return copyLink(url)
}
