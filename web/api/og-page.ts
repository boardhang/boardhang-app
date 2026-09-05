// GET /api/og-page?layoutId=&problem= — per-problem Open Graph tags for link-preview
// crawlers. Reached only through the user-agent rewrite in vercel.json; humans keep
// getting the app shell on the catalog URL. Logic lives in _lib/ogPage.ts so it can be
// tested with stubbed fetch/env.

import { handleOgPage } from './_lib/ogPage.js'

export function GET(request: Request): Promise<Response> {
  return handleOgPage(request, { fetch: globalThis.fetch, env: process.env })
}
