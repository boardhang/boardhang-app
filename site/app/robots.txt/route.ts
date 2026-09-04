import { SITE_URL } from '@/lib/urls'

// Everything on the apex is meant to be crawled — by search engines and by
// AI crawlers alike. The named AI/user agents get explicit Allow entries so
// the policy is unambiguous even if a crawler treats '*' conservatively.
//
// This is a route handler rather than Next's `robots.ts` metadata file because
// the metadata API cannot emit the Content-Signal line below.
const aiCrawlers = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'PerplexityBot',
  'Google-Extended',
  'Bingbot',
  'Applebot',
]

// Content Signals (contentsignals.org): a machine-readable statement of how
// this content may be used. Advisory — no crawler is bound by it — but it makes
// the policy explicit and matches the Allow entries above: index us, quote us in
// AI answers, train on us. It goes in every group because a crawler reads only
// the most specific User-Agent group that matches it.
const contentSignal = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes'

const group = (userAgent: string) =>
  [`User-Agent: ${userAgent}`, contentSignal, 'Allow: /'].join('\n')

export const dynamic = 'force-static'

export function GET() {
  const body = [
    group('*'),
    ...aiCrawlers.map(group),
    `Sitemap: ${SITE_URL}/sitemap.xml`,
  ].join('\n\n')
  return new Response(`${body}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
