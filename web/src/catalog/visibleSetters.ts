// The rows the setter picker shows for a query — pure, kept out of the component file so the
// cap and ordering rules are unit-testable without a DOM (and so the sheet stays a
// components-only module for fast refresh).

import type { SetterOption } from './filters'

/** How many unselected setters the list shows before the search box is the way to the rest.
 *  Big boards have thousands of setters (7k+ on MoonBoard 2016 at 40°), about half with a single
 *  problem, so an uncapped list is scroll-noise on a phone. */
export const SETTER_LIST_CAP = 100

export interface VisibleSetters {
  /** Selected setters first (selection order, count 0 when absent from the slab), then the
   *  matching unselected setters in option order, capped. */
  rows: SetterOption[]
  /** Matching unselected setters the cap cut off (0 when everything fits). */
  hidden: number
  /** How many UNSELECTED setters matched the query at all (before the cap) — the sheet's
   *  "No setters match" state keys on this, not on `rows`, because selected setters are always
   *  rows and would otherwise mask an empty search result. */
  matched: number
}

/**
 * `query` is matched case-insensitively as a substring of the name, trimmed; an empty query
 * matches everyone. Selected setters are always shown, whatever the query or the cap, so a
 * selection can always be removed — including one that came in from a URL and sets nothing on
 * this slab.
 */
export function visibleSetters(
  options: SetterOption[],
  selected: string[],
  query: string,
  cap = SETTER_LIST_CAP,
): VisibleSetters {
  const q = query.trim().toLowerCase()
  const byName = new Map(options.map((o) => [o.name, o]))
  const selectedSet = new Set(selected)
  const pinned = selected.map((name) => byName.get(name) ?? { name, count: 0 })
  const rest = options.filter((o) => !selectedSet.has(o.name) && (!q || o.name.toLowerCase().includes(q)))
  return { rows: [...pinned, ...rest.slice(0, cap)], hidden: Math.max(0, rest.length - cap), matched: rest.length }
}

/** The row caption under a setter's name — the app's own word is "problems" (the catalog header
 *  counts "62 problems"); zero says so in words rather than showing a bare 0. */
export function problemCountLabel(count: number): string {
  if (count === 0) return 'No problems match'
  return `${count} ${count === 1 ? 'problem' : 'problems'}`
}
