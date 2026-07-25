import type { MetadataRoute } from 'next'

const base = 'https://boardhang.app'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${base}/` },
    { url: `${base}/guides` },
  ]
}
