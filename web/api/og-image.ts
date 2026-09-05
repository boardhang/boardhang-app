// GET /api/og-image?problem=&v= — the per-problem link-preview card (PNG). Logic lives
// in _lib/ogImage.ts; the art loader and the @vercel/og renderer are wired here with
// static imports so the builder traces the bundled PNGs and the WASM assets.

import { loadBoardArt } from './_lib/boardArt.js'
import { handleOgImage } from './_lib/ogImage.js'
import { renderCard } from './_lib/renderCard.js'

export function GET(request: Request): Promise<Response> {
  return handleOgImage(request, {
    fetch: globalThis.fetch,
    env: process.env,
    loadArt: loadBoardArt,
    render: renderCard,
  })
}
