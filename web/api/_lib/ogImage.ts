// Handler behind api/og-image.ts: the 1200×630 card for one problem, CDN-cached per
// URL. The request's query string must be byte-identical to the canonical one
// (`?problem=<id>&v=<version>`, see problemMeta.ts): the CDN key is the whole URL, so
// a forged `v`, an extra `&x=`, a reordered or re-encoded query would each be a fresh
// cache miss and a full render — every such request 302s to the canonical URL instead,
// while a catalog re-import still yields a fresh URL through `v`. Any failure redirects
// (relative Location) to the static og.png after one console.error, so a systemic
// breakage shows up in `vercel logs` rather than as identical generic cards.

import { boardByLayoutId, type CatalogBoardDef } from '../../src/board/boards.js'
import { CARD_HEIGHT, CARD_WIDTH, boardCardElement } from './boardCard.js'
import { fetchProblemRow, type RowDeps } from './catalogRow.js'
import { problemImageSearch } from './problemMeta.js'
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

  try {
    const { row, reason } = await fetchProblemRow(id, { fetch: deps.fetch, env: deps.env })
    // fetchProblemRow already rejects unregistered layouts; the board lookup here only
    // narrows the type for the renderer.
    const board = row ? boardByLayoutId(row.layout_id) : undefined
    if (!row || !board) {
      console.error('[og-image] generic fallback', { problem: id, reason: reason ?? 'unknown-layout' })
      return fallback()
    }
    const canonical = problemImageSearch(row)
    if (url.search !== canonical) {
      return new Response(null, {
        status: 302,
        headers: { location: `/api/og-image${canonical}`, 'cache-control': REDIRECT_CACHE_CONTROL },
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
