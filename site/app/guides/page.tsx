import type { Metadata } from 'next'
import Link from 'next/link'
import { og } from '@/lib/og'

const description = 'Practical guides to browsing MoonBoard problems on the web.'

export const metadata: Metadata = {
  title: 'MoonBoard guides: browsing problems on the web',
  description,
  alternates: { canonical: '/guides' },
  openGraph: og({
    title: 'MoonBoard guides: browsing problems on the web',
    description,
    url: '/guides',
  }),
}

const guides = [
  {
    href: '/guides/moonboard-website-not-working',
    title: 'MoonBoard website not working — where to browse problems now',
    description:
      'A comparison of the four places you can still browse MoonBoard problems — including the honest limits of ours.',
    date: 'July 25, 2026',
    dateTime: '2026-07-25',
  },
]

export default function Guides() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Guides</h1>
      <p className="mt-4 text-[var(--muted)]">
        moonboard.com no longer serves problem pages and the official app is the only
        sanctioned source, so a lot of MoonBoard knowledge now lives in forum threads and
        GitHub issues. These guides write it down.
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
    </>
  )
}
