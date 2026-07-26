import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/urls'

const base = SITE_URL

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${base}/` },
    { url: `${base}/guides` },
    { url: `${base}/guides/moonboard-website-not-working`, lastModified: '2026-07-25' },
  ]
}
