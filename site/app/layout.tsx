import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { SITE_URL } from '@/lib/urls'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: '%s · Boardhang',
    default: 'Boardhang',
  },
  description:
    'Boardhang is a free web app for lighting MoonBoard problems on DIY LED boards over Web Bluetooth — browse ~12k curated problems across 5 layouts and light them straight from the browser.',
  // og:image comes from the app/opengraph-image.png file convention, which
  // applies to every route and survives page-level openGraph overrides
  // (a page-level openGraph object replaces this one wholesale).
  openGraph: {
    siteName: 'Boardhang',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto flex min-h-screen max-w-2xl flex-col px-6">
        <header className="flex items-center py-6">
          <Link href="/" className="text-lg font-semibold !text-[var(--foreground)] no-underline">
            Boardhang
          </Link>
        </header>
        <main className="flex-1 pb-16">{children}</main>
        <footer className="border-t border-[var(--border)] py-8 text-sm text-[var(--muted)]">
          <p>
            Boardhang is an unofficial, community-built project — not affiliated with Moon
            Climbing Ltd.
          </p>
          <p className="mt-3 flex gap-4">
            <a href="https://www.boardhang.app">Open the app</a>
            <Link href="/guides">Guides</Link>
          </p>
        </footer>
      </body>
    </html>
  )
}
