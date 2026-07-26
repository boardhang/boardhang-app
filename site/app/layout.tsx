import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/logo'
import { SITE_URL } from '@/lib/urls'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: '%s · Boardhang',
    default: 'Boardhang',
  },
  description:
    'Boardhang is a free web app for lighting MoonBoard problems on LED boards over Web Bluetooth — browse ~12k curated problems across 5 layouts and light them straight from the browser.',
  // og:image comes from the app/opengraph-image.png file convention. It does
  // NOT survive a page-level openGraph object — that replaces this one
  // wholesale — so every page builds its openGraph through lib/og.ts, which
  // restates the image in full.
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
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold !text-[var(--foreground)] no-underline"
          >
            <Logo className="h-6 w-6" />
            Boardhang
          </Link>
        </header>
        <main className="flex-1 pb-16">{children}</main>
        <footer className="border-t border-[var(--border)] py-8 text-sm text-[var(--muted)]">
          <p className="flex items-center gap-2 font-medium text-[var(--foreground)]">
            <Logo className="h-5 w-5" />
            Boardhang
          </p>
          <p className="mt-3">
            Boardhang is an unofficial, community-built project — not affiliated with, or
            endorsed by, Moon Climbing Ltd. MoonBoard is their trademark.
          </p>
          <p className="mt-3">
            Open source under the MIT license —{' '}
            <a href="https://github.com/boardhang/boardhang-app">issues and pull requests
            welcome</a>.
          </p>
          <p className="mt-3 flex gap-4">
            <a href="https://www.boardhang.app">Open the app</a>
            <Link href="/guides">Guides</Link>
            <a href="https://github.com/boardhang/boardhang-app">GitHub</a>
          </p>
        </footer>
      </body>
    </html>
  )
}
