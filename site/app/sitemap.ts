import type { MetadataRoute } from 'next'

const base = 'https://boardhang.app'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${base}/` },
    { url: `${base}/guides` },
    { url: `${base}/guides/moonboard-website-retired`, lastModified: '2026-07-25' },
  ]
}
