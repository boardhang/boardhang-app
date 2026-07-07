// The logbook route's URL search-param schema. The logbook has one addressable bit of
// UI state: which problem's detail drawer is open, encoded as `?problem=<id>` so the
// drawer is history-integrated (Back closes it and stays on /logbook, rather than
// leaving the tab). Mirrors catalogSearch.ts at minimal scope — the strip middleware on
// the route removes `problem` at its default so a closed drawer keeps the URL clean.

/** The typed logbook search. `problem` is optional so navigating to `/logbook`
 *  (the bottom-nav tab) doesn't have to pass search — only the drawer sets it. */
export interface LogbookSearch {
  /** Open problem's `source_catalog_id`; `''`/absent = drawer closed. */
  problem?: string
}

/** The default (stripped) value of every param. */
export const LOGBOOK_SEARCH_DEFAULTS = {
  problem: '',
}

/** Coerce a raw parsed search object into the typed schema. This is the route's
 *  `validateSearch`. */
export function validateLogbookSearch(raw: Record<string, unknown>): LogbookSearch {
  return {
    problem: typeof raw.problem === 'string' ? raw.problem : '',
  }
}
