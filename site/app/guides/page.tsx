import type { Metadata } from 'next'
import Link from 'next/link'
import { og } from '@/lib/og'

export const metadata: Metadata = {
  title: 'Guides',
  description:
    'Guides to browsing MoonBoard problems on the web and building DIY LED MoonBoards.',
  alternates: { canonical: '/guides' },
  openGraph: og({
    title: 'Guides',
    description:
      'Guides to browsing MoonBoard problems on the web and building DIY LED MoonBoards.',
    url: '/guides',
  }),
}

const guides = [
  {
    href: '/guides/moonboard-website-retired',
    title: 'The MoonBoard website is retired — where to browse problems now',
    description:
      'moonboard.com no longer serves problem pages. Where you can still browse MoonBoard problems — in the browser or in the official app.',
    date: 'July 25, 2026',
    dateTime: '2026-07-25',
  },
]

const upcoming = [
  'Build a DIY LED MoonBoard: parts, wiring and firmware',
  'The 20-byte BLE bug: lighting MoonBoard problems from the browser',
]

export default function Guides() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Guides</h1>
      <p className="mt-4 text-[var(--muted)]">
        Practical guides to browsing MoonBoard problems on the web and building DIY LED boards.
      </p>
      <ul className="mt-8 space-y-8">
        {guides.map((guide) => (
          <li key={guide.href}>
            <article>
              <h2 className="text-xl font-semibold">
                <Link href={guide.href} className="!text-[var(--foreground)] hover:underline">
                  {guide.title}
                </Link>
              </h2>
              <p className="mt-2 text-[var(--muted)]">{guide.description}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                <time dateTime={guide.dateTime}>{guide.date}</time>
              </p>
            </article>
          </li>
        ))}
      </ul>
      <h2 className="mt-12 text-xl font-semibold">Coming soon</h2>
      <ul className="mt-4 list-disc space-y-2 pl-6 text-[var(--muted)]">
        {upcoming.map((title) => (
          <li key={title}>{title}</li>
        ))}
      </ul>
    </>
  )
}
