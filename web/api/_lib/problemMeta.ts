// The meta document a link-preview crawler receives for a problem URL: a minimal HTML
// head carrying the Open Graph / Twitter tags, plus a one-line body linking to the
// canonical app URL. Pure string builders so the tags can be unit-tested without a
// request. Every row string goes through escapeHtml (names and setters are
// user-submitted upstream).

import type { CatalogBoardDef } from '../../src/board/boards.js'
import { problemCatalogPath } from '../../src/catalog/problemPath.js'
import type { ProblemRow } from './catalogRow.js'
import { escapeHtml } from './html.js'

export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630
export const OG_IMAGE_TYPE = 'image/png'

const SITE_NAME = 'Boardhang'
// Mirrors web/index.html's static tags — the generic card is what humans' shell shows.
const GENERIC_DESCRIPTION =
  'The MoonBoard app we wished we had. Fast filters that stick, shareable problems, and sessions with friends.'

/** The catalog deep link — the same builder the app's Share button uses (row-derived). */
export function canonicalProblemUrl(origin: string, row: Pick<ProblemRow, 'layout_id' | 'angle' | 'source_catalog_id'>): string {
  return `${origin}${problemCatalogPath(row)}`
}

/** The card's version token: `updated_at` as epoch milliseconds. Digits only, so the
 *  canonical image URL carries no percent-encoding for a fetcher to re-normalize (the
 *  raw timestamp's `+00:00` would encode to `%2B`, and a fetcher decoding it back to `+`
 *  would read a space). A re-import re-stamps `updated_at`, so the token still changes. */
export function problemImageVersion(row: Pick<ProblemRow, 'updated_at'>): string {
  return String(Date.parse(row.updated_at))
}

/** The canonical query string of the card URL — the ONLY form og-image renders; any
 *  other byte sequence for the same problem 302s to this one (see ogImage.ts). */
export function problemImageSearch(row: Pick<ProblemRow, 'source_catalog_id' | 'updated_at'>): string {
  const params = new URLSearchParams({ problem: row.source_catalog_id, v: problemImageVersion(row) })
  return `?${params.toString()}`
}

/** The card URL, versioned so a catalog re-import yields a new URL. */
export function problemImageUrl(origin: string, row: Pick<ProblemRow, 'source_catalog_id' | 'updated_at'>): string {
  return `${origin}/api/og-image${problemImageSearch(row)}`
}

export function problemTitle(row: Pick<ProblemRow, 'name' | 'grade'>): string {
  return `${row.name} ${row.grade}`
}

/** "{board} {angle}° · by {setter} · ★{stars} · {repeats} repeats · Benchmark" */
export function problemDescription(row: ProblemRow, board: Pick<CatalogBoardDef, 'name'>): string {
  const parts = [`${board.name} ${row.angle}°`]
  if (row.setter) parts.push(`by ${row.setter}`)
  parts.push(`★${row.stars}`, `${row.repeats} repeats`)
  if (row.is_benchmark) parts.push('Benchmark')
  return parts.join(' · ')
}

interface MetaDoc {
  title: string
  description: string
  url: string
  image: string
  imageType: string
}

function tag(kind: 'property' | 'name', key: string, content: string): string {
  return `<meta ${kind}="${key}" content="${escapeHtml(content)}">`
}

function renderDoc(doc: MetaDoc): string {
  const title = escapeHtml(doc.title)
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    tag('name', 'description', doc.description),
    tag('name', 'robots', 'noindex'),
    tag('property', 'og:site_name', SITE_NAME),
    tag('property', 'og:title', doc.title),
    tag('property', 'og:description', doc.description),
    tag('property', 'og:type', 'website'),
    tag('property', 'og:url', doc.url),
    tag('property', 'og:image', doc.image),
    tag('property', 'og:image:width', String(OG_IMAGE_WIDTH)),
    tag('property', 'og:image:height', String(OG_IMAGE_HEIGHT)),
    tag('property', 'og:image:type', doc.imageType),
    tag('name', 'twitter:card', 'summary_large_image'),
    tag('name', 'twitter:title', doc.title),
    tag('name', 'twitter:description', doc.description),
    tag('name', 'twitter:image', doc.image),
    '</head>',
    '<body>',
    `<p><a href="${escapeHtml(doc.url)}">${title}</a> on ${SITE_NAME}</p>`,
    '</body>',
    '</html>',
  ].join('\n')
}

export function renderProblemMeta(args: { row: ProblemRow; board: CatalogBoardDef; origin: string }): string {
  const { row, board, origin } = args
  return renderDoc({
    title: problemTitle(row),
    description: problemDescription(row, board),
    url: canonicalProblemUrl(origin, row),
    image: problemImageUrl(origin, row),
    imageType: OG_IMAGE_TYPE,
  })
}

export function renderGenericMeta(args: { origin: string }): string {
  return renderDoc({
    title: SITE_NAME,
    description: GENERIC_DESCRIPTION,
    url: `${args.origin}/`,
    image: `${args.origin}/og.png`,
    imageType: 'image/png',
  })
}
