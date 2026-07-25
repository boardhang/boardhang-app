import type { Metadata } from 'next'
import Link from 'next/link'
import { JsonLd } from '@/components/json-ld'
import { og } from '@/lib/og'
import { APP_URL, SITE_URL } from '@/lib/urls'

export const metadata: Metadata = {
  title: { absolute: 'Boardhang — free web app for DIY LED MoonBoards' },
  description:
    'Boardhang lights MoonBoard problems on DIY LED boards over Web Bluetooth — no install, no account. Browse ~12,000 curated problems across 5 layouts, including 2,832 official benchmarks.',
  alternates: { canonical: '/' },
  openGraph: og({ url: '/' }),
}

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Boardhang',
  url: SITE_URL,
}

const softwareApplicationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Boardhang',
  url: APP_URL,
  applicationCategory: 'SportsApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  description:
    'Free, unofficial web app for DIY LED MoonBoards. Connects over Web Bluetooth and lights MoonBoard problems on boards running the open-source ArduinoMoonBoardLED firmware — including boards the official app cannot drive because it truncates Bluetooth writes over 20 bytes.',
  featureList: [
    'Lights problems on DIY LED MoonBoards over Web Bluetooth',
    'Compatible with the open-source ArduinoMoonBoardLED Arduino firmware',
    'Chunks Bluetooth writes, avoiding the official app’s 20-byte truncation bug on DIY LED systems',
    'Catalog of ~12,000 curated MoonBoard problems including 2,832 official benchmarks',
    'Covers 5 layouts: MoonBoard 2016, 2024, Masters 2017, Masters 2019 and Mini MoonBoard 2025',
    'Search, grade filters and favorites',
    'Local logbook with a grade pyramid',
    'Runs in the browser with no install and no account',
  ],
}

export default function Home() {
  return (
    <>
      <JsonLd data={organizationJsonLd} />
      <JsonLd data={softwareApplicationJsonLd} />

      <section className="pt-8">
        <h1 className="text-3xl font-semibold leading-tight">
          Light MoonBoard problems on your DIY LED board
        </h1>
        <p className="mt-4 text-lg text-[var(--muted)]">
          Boardhang is a free web app for DIY LED MoonBoards. Open it in the browser — no
          install, no account — and it connects to your board over Web Bluetooth and lights
          problems on the wall.
        </p>
        <p className="mt-6 flex flex-wrap items-center gap-4">
          <a
            href="https://www.boardhang.app"
            className="rounded-lg bg-brand px-5 py-2.5 font-medium !text-white no-underline hover:opacity-90"
          >
            Open the app
          </a>
          <Link href="/guides">Read the guides</Link>
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Why not the official app?</h2>
        <p className="mt-3 text-[var(--muted)]">
          The official MoonBoard app truncates Bluetooth writes longer than 20 bytes. Official
          hardware works around that, but DIY LED systems receive cut-off messages, so longer
          problems light up half-finished or not at all. Boardhang splits every message into
          chunks the board can handle, so each hold lights the way it should.
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">What you can do</h2>
        <ul className="mt-3 space-y-4 text-[var(--muted)]">
          <li>
            <strong className="font-medium text-[var(--foreground)]">
              Light problems on the wall.
            </strong>{' '}
            Pick a problem and Boardhang sends it to your board over Web Bluetooth — start,
            hand and finish holds each in their own color.
          </li>
          <li>
            <strong className="font-medium text-[var(--foreground)]">
              Browse a curated catalog.
            </strong>{' '}
            Around 12,000 curated MoonBoard problems, including 2,832 official benchmarks,
            across 5 layouts: MoonBoard 2016, 2024, Masters 2017, Masters 2019 and Mini
            MoonBoard 2025 — with search, grade filters and favorites.
          </li>
          <li>
            <strong className="font-medium text-[var(--foreground)]">Log your ascents.</strong>{' '}
            A local logbook tracks what you have climbed and shows your grade pyramid.
          </li>
        </ul>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Works with your DIY build</h2>
        <p className="mt-3 text-[var(--muted)]">
          Boardhang is built for people who wired their own LED system instead of buying the
          official kit — typically an Arduino running the open-source ArduinoMoonBoardLED
          firmware. If your board speaks that protocol, Boardhang can drive it.
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Browser support</h2>
        <p className="mt-3 text-[var(--muted)]">
          Web Bluetooth needs Chrome or Edge on desktop or Android. On iPhone, use the Bluefy
          browser. Browsing the catalog works in any modern browser.
        </p>
      </section>

      <section className="mt-14 border-t border-[var(--border)] pt-8">
        <p className="text-[var(--muted)]">
          Ready to climb?{' '}
          <a href="https://www.boardhang.app" className="font-medium">
            Open the app
          </a>{' '}
          or start with the <Link href="/guides">guides</Link>.
        </p>
      </section>
    </>
  )
}
