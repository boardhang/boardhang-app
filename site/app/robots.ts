import type { MetadataRoute } from 'next'

// Everything on the apex is meant to be crawled — by search engines and by
// AI crawlers alike. The named AI/user agents get explicit Allow entries so
// the policy is unambiguous even if a crawler treats '*' conservatively.
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

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      ...aiCrawlers.map((userAgent) => ({ userAgent, allow: '/' })),
    ],
    sitemap: 'https://boardhang.app/sitemap.xml',
  }
}
