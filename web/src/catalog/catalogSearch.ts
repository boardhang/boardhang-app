// The catalog route's URL search-param schema — the single source of truth for
// *what the catalog is showing*. Every filter, sort key, the search query, the
// resolved angle, and the open problem are encoded here so the catalog is
// deep-linkable and browser back/forward works.
//
// Params are omitted at their default (via `stripSearchParams` middleware on the
// route, see router.tsx) to keep URLs clean. `validateCatalogSearch` fills every
// default on read so consumers never see a hole; the strip middleware removes
// those defaults again before serialization so filling-on-read can't re-bloat the
// URL (the failure mode `validateSearch`-alone has).
//
// Encodings (plan §4): booleans as `1` (present) / omitted; grade as ordinal
// `min-max` into FONT_GRADES; methods/holds comma-joined; angle `0` = "use the
// board's default". The secondary sort rides `sortThenBy` (a SortKey or `none` for
// no tiebreak), stripped at its default; a secondary that shares the primary's
// dimension is dropped on read so URL state matches the "Then by" control.

import { FONT_GRADES } from '../board/grades'
import {
  DEFAULT_FILTERS,
  STATUS_KEYS,
  sortDimension,
  type FilterState,
  type SortKey,
  type StatusKey,
} from './filters'

const SORT_KEYS: readonly SortKey[] = ['easiest', 'hardest', 'rated', 'repeats']

/** The typed catalog search, as returned by `useSearch` (all keys always present). */
export interface CatalogSearch {
  /** Free-text name/setter query. */
  q: string
  /** Grade filter as ordinal `"min-max"` into FONT_GRADES; `''` = no filter. */
  grade: string
  /** Benchmarks only. */
  bench: 0 | 1
  /** Minimum star rating 0–5; `0` = any. */
  stars: number
  /** Comma-joined method labels; `''` = any. */
  method: string
  /** Favorites only. */
  fav: 0 | 1
  /** Primary sort key. */
  sort: SortKey
  /** Secondary ("Then by") sort key, or `'none'` for no tiebreak. */
  sortThenBy: SortKey | 'none'
  /** Wall angle; `0` = "use the board's default" (resolved in the route). */
  angle: number
  /** Comma-joined `"col-row"` positions a problem must include; `''` = none. */
  holds: string
  /** Comma-joined ascent-status keys (`sent`/`attempted`/`unlogged`); `''` = any. */
  status: string
  /** Open problem's `source_catalog_id`; `''` = drawer closed. */
  problem: string
}

/** The default (stripped) value of every param. */
export const CATALOG_SEARCH_DEFAULTS: CatalogSearch = {
  q: '',
  grade: '',
  bench: 0,
  stars: 0,
  method: '',
  fav: 0,
  sort: DEFAULT_FILTERS.sortPrimary,
  sortThenBy: DEFAULT_FILTERS.sortSecondary ?? 'none',
  angle: 0,
  holds: '',
  status: '',
  problem: '',
}

const GRADE_MAX = FONT_GRADES.length - 1

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Coerce a raw parsed search object into the typed schema, defaulting anything
 *  missing or malformed. This is the route's `validateSearch`. */
export function validateCatalogSearch(raw: Record<string, unknown>): CatalogSearch {
  const sort = SORT_KEYS.includes(raw.sort as SortKey) ? (raw.sort as SortKey) : DEFAULT_FILTERS.sortPrimary
  const sortThenBy =
    raw.sortThenBy === 'none' || SORT_KEYS.includes(raw.sortThenBy as SortKey)
      ? (raw.sortThenBy as SortKey | 'none')
      : DEFAULT_FILTERS.sortSecondary ?? 'none'
  return {
    q: str(raw.q),
    grade: str(raw.grade),
    bench: num(raw.bench) === 1 ? 1 : 0,
    stars: Math.min(5, Math.max(0, Math.round(num(raw.stars)))),
    method: str(raw.method),
    fav: num(raw.fav) === 1 ? 1 : 0,
    sort,
    sortThenBy,
    angle: Math.max(0, Math.round(num(raw.angle))),
    holds: str(raw.holds),
    status: str(raw.status),
    problem: str(raw.problem),
  }
}

// ─── Status keys <-> comma-joined string ────────────────────────────────────

/** Encode selected status keys to a comma-joined string, `''` when none. */
export function encodeStatus(keys: StatusKey[]): string {
  return keys.join(',')
}

/** Decode a comma-joined status string into valid keys in canonical order,
 *  deduplicated — so a hand-edited `?status=unlogged,sent,sent` normalizes to the
 *  same `['sent','unlogged']` the UI produces (stable URLs + seed keys; unknown and
 *  empty tokens dropped). */
export function decodeStatus(s: string): StatusKey[] {
  if (!s) return []
  const tokens = new Set(s.split(','))
  return STATUS_KEYS.filter((k) => tokens.has(k))
}

// ─── Grade ordinal <-> "min-max" ────────────────────────────────────────────

/** Encode a grade range to `"min-max"`, or `''` when it spans the whole canonical
 *  scale (the sole "no grade filter" state, absent from the URL). */
export function encodeGrade(range: [number, number] | null): string {
  if (!range) return ''
  const [lo, hi] = range
  if (lo <= 0 && hi >= GRADE_MAX) return '' // canonical full span = no filter
  return `${lo}-${hi}`
}

/** Decode `"min-max"` into a clamped `[min, max]`, or `null` for no filter
 *  (malformed input or the full canonical span). */
export function decodeGrade(s: string): [number, number] | null {
  const m = /^(\d+)-(\d+)$/.exec(s)
  if (!m) return null
  let lo = Math.min(Math.max(Number(m[1]), 0), GRADE_MAX)
  let hi = Math.min(Math.max(Number(m[2]), 0), GRADE_MAX)
  if (lo > hi) [lo, hi] = [hi, lo]
  if (lo <= 0 && hi >= GRADE_MAX) return null
  return [lo, hi]
}

// ─── FilterState <-> search ─────────────────────────────────────────────────

/** Build the filter/sort/search portion of the URL from a FilterState. Omits
 *  `angle` and `problem`, which the route and drawer own respectively. Defaults
 *  are still emitted (e.g. `bench: 0`) — the route's strip middleware removes
 *  them, so every write site can pass natural values without remembering to omit. */
export function filtersToSearch(f: FilterState): Omit<CatalogSearch, 'angle' | 'problem'> {
  return {
    q: f.search,
    grade: encodeGrade(f.gradeRange),
    bench: f.benchmarkOnly ? 1 : 0,
    stars: f.minStars,
    method: f.methods.join(','),
    fav: f.favoritesOnly ? 1 : 0,
    sort: f.sortPrimary,
    sortThenBy: f.sortSecondary ?? 'none',
    holds: f.holdsFilter.join(','),
    status: encodeStatus(f.statusFilters),
  }
}

/** Decode the URL search into the FilterState the filter pipeline consumes. The
 *  transient search query rides `q` here (it is no longer a separate store);
 *  `sortSecondary` is forced to its default (it is not URL-addressable). */
export function searchToFilters(s: CatalogSearch): FilterState {
  const secondary = s.sortThenBy === 'none' ? null : s.sortThenBy
  // Drop a secondary that shares the primary's dimension (a same-dimension tiebreak is
  // meaningless and the "Then by" control never offers it), keeping URL state coherent.
  const sortSecondary =
    secondary && sortDimension(secondary) === sortDimension(s.sort) ? null : secondary
  return {
    search: s.q,
    sortPrimary: s.sort,
    sortSecondary,
    gradeRange: decodeGrade(s.grade),
    benchmarkOnly: s.bench === 1,
    minStars: s.stars,
    methods: s.method ? s.method.split(',').filter(Boolean) : [],
    favoritesOnly: s.fav === 1,
    holdsFilter: s.holds ? s.holds.split(',').filter(Boolean) : [],
    statusFilters: decodeStatus(s.status),
  }
}
