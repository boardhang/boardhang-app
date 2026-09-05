// Handler behind api/og-page.ts: the meta document for a crawler that fetched a
// problem URL (vercel.json rewrites matching user agents here). Always a 200 — an
// unknown problem, a layout mismatch, or any failure serves the generic Boardhang tags
// rather than a 5xx (a crawler that sees an error shows nothing at all). Never
// CDN-cached: the cache key is the request URL, which a human's app shell shares.

import { boardByLayoutId } from '../../src/board/boards.js'
import { fetchProblemRow, type RowDeps } from './catalogRow.js'
import { resolveOrigin, type OriginEnv } from './origin.js'
import { renderGenericMeta, renderProblemMeta } from './problemMeta.js'

export interface OgPageDeps {
  fetch: RowDeps['fetch']
  env: RowDeps['env'] & OriginEnv
}

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex',
}

export async function handleOgPage(request: Request, deps: OgPageDeps): Promise<Response> {
  const url = new URL(request.url)
  const origin = resolveOrigin(request.headers, deps.env)
  const id = url.searchParams.get('problem') ?? ''
  const layoutId = url.searchParams.get('layoutId')

  let html: string
  try {
    const { row, reason } = await fetchProblemRow(id, { fetch: deps.fetch, env: deps.env })
    const board = row ? boardByLayoutId(row.layout_id) : undefined
    if (row && board && String(row.layout_id) === layoutId) {
      html = renderProblemMeta({ row, board, origin })
    } else {
      console.error('[og-page] generic fallback', {
        problem: id,
        layoutId,
        reason: row ? 'layout-mismatch' : (reason ?? 'unknown-layout'),
      })
      html = renderGenericMeta({ origin })
    }
  } catch (err) {
    console.error('[og-page] generic fallback', { problem: id, layoutId, reason: String(err) })
    html = renderGenericMeta({ origin })
  }
  return new Response(html, { status: 200, headers: HEADERS })
}
