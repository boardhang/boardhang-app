// Handler behind api/og-image.ts: the 1200×630 card for one problem, CDN-cached per
// URL. The `v` query param must equal the row's updated_at — any other value 302s to
// the canonical URL instead of rendering, so a forged version cannot force an uncached
// render per request while a catalog re-import still yields a fresh URL. Any failure
// redirects (relative Location) to the static og.png after one console.error, so a
// systemic breakage shows up in `vercel logs` rather than as identical generic cards.

import { boardByLayoutId, type CatalogBoardDef } from '../../src/board/boards.js'
import { CARD_HEIGHT, CARD_WIDTH, boardCardElement } from './boardCard.js'
import { fetchProblemRow, type RowDeps } from './catalogRow.js'
import type { CardRenderer } from './renderCard.js'

export const IMAGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
const REDIRECT_CACHE_CONTROL = 'public, max-age=0, s-maxage=3600'

export interface OgImageDeps {
  fetch: RowDeps['fetch']
  env: RowDeps['env']
  loadArt: (board: CatalogBoardDef) => Promise<string[]>
  render: CardRenderer
}

function fallback(): Response {
  return new Response(null, { status: 302, headers: { location: '/og.png', 'cache-control': 'no-store' } })
}

export async function handleOgImage(request: Request, deps: OgImageDeps): Promise<Response> {
  const url = new URL(request.url)
  const id = url.searchParams.get('problem') ?? ''
  const version = url.searchParams.get('v') ?? ''

  try {
    const row = await fetchProblemRow(id, { fetch: deps.fetch, env: deps.env })
    const board = row ? boardByLayoutId(row.layout_id) : undefined
    if (!row || !board) {
      console.error('[og-image] generic fallback', { problem: id, reason: 'no row' })
      return fallback()
    }
    if (version !== row.updated_at) {
      const canonical = new URLSearchParams({ problem: row.source_catalog_id, v: row.updated_at })
      return new Response(null, {
        status: 302,
        headers: { location: `/api/og-image?${canonical.toString()}`, 'cache-control': REDIRECT_CACHE_CONTROL },
      })
    }
    const art = await deps.loadArt(board)
    const element = boardCardElement({ row, board, art })
    return await deps.render(element, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      headers: { 'content-type': 'image/png', 'cache-control': IMAGE_CACHE_CONTROL },
    })
  } catch (err) {
    console.error('[og-image] generic fallback', { problem: id, reason: String(err) })
    return fallback()
  }
}
