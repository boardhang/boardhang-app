import createMDX from '@next/mdx'
import type { NextConfig } from 'next'

// App-shaped paths on the apex belong to the PWA at www.boardhang.app.
// Temporary (307) on purpose: these must never accrue permanence on the apex,
// and a 307 keeps crawlers pointed at www for the app itself.
const appPaths = [
  '/board/:path*',
  '/boards',
  '/session/:path*',
  '/lists/:path*',
  '/logbook/:path*',
  '/settings',
]

const nextConfig: NextConfig = {
  pageExtensions: ['ts', 'tsx', 'mdx'],
  async redirects() {
    return appPaths.map((source) => ({
      source,
      destination: `https://www.boardhang.app${source}`,
      permanent: false,
    }))
  },
}

const withMDX = createMDX({})

export default withMDX(nextConfig)
