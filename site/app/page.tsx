import type { Metadata } from 'next'
import Link from 'next/link'
import { JsonLd } from '@/components/json-ld'
import { og } from '@/lib/og'
import { APP_URL, SITE_URL } from '@/lib/urls'

export const metadata: Metadata = {
  title: { absolute: 'Boardhang — free web app for MoonBoards' },
  description:
    'A free web app for MoonBoards: filters that stay put, sessions with friends, and one tap to light any problem over Web Bluetooth. No install, no account.',
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
    'Free, unofficial web app for DIY MoonBoards. Connects over Web Bluetooth and lights MoonBoard problems on boards running the open-source ArduinoMoonBoardLED firmware — including boards the official app cannot drive because it truncates Bluetooth writes over 20 bytes.',
  featureList: [
    'Lights problems on DIY MoonBoards over Web Bluetooth',
    'Compatible with the open-source ArduinoMoonBoardLED Arduino firmware',
    'Chunks Bluetooth writes, avoiding the official app’s 20-byte truncation bug on DIY LED systems',
    'Catalog of ~12,000 curated MoonBoard problems including 2,832 official benchmarks',
    'Covers 5 layouts: MoonBoard 2016, 2024, Masters 2017, Masters 2019 and Mini MoonBoard 2025',
    'Search, grade filters and favorites',
    'Remembers filter and sort settings per board between visits',
    'Every problem is shareable as a normal web link',
    'Collaboration sessions: see what each climber in your crew has sent or tried, and what is lit on the wall right now',
    'Recently-viewed history of lit problems',
    'Local logbook with a grade pyramid, exportable anytime — you own your data',
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
          The MoonBoard app we wished we had
        </h1>
        <p className="mt-4 text-lg text-[var(--muted)]">
          Boardhang is a free web app for MoonBoards, built by two climbers tired of
          re-setting filters every visit, cross-checking logbooks by shouting across the mat,
          and asking “which problem is that?”. Open it in a browser — no install, no
          account — and it lights problems on your board over Web Bluetooth.
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
        <h2 className="text-xl font-semibold">Why we built it</h2>
        <p className="mt-3 text-[var(--muted)]">
          Boardhang started with two climbers, one board and a growing list of annoyances
          with the official app. The default sorting never made sense, and nothing was
          saved — every trip into the catalog began with setting the same filters again. The
          grade pyramid didn’t add up. Climbing together meant constant cross-checking:
          “have you done this one?”, “what
          can we both try?”. And every time someone changed the problem, the same questions
          from across the room: “which problem is that?” and “what was the one before?”.
        </p>
        <p className="mt-3 text-[var(--muted)]">
          So we built the app we wished we had: filters that stay how you set them, sessions
          that show what everyone has sent and tried, what’s lit on the wall right now, and a
          recently-viewed list to look back through everything you had up before.
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
              Keep your filters.
            </strong>{' '}
            Sort and filter the catalog once — Boardhang remembers your setup per board, so
            every visit starts where you left off, not from scratch. We also user-tested the
            filter UX with climbers and rebuilt the parts everyone griped about.
          </li>
          <li>
            <strong className="font-medium text-[var(--foreground)]">
              Session with friends.
            </strong>{' '}
            Sign in free to start a session: see what everyone has sent or tried without
            asking, find a problem to work on together, and always know what’s lit on the
            wall — with a recently-viewed list for “what was that last one?”.
          </li>
          <li>
            <strong className="font-medium text-[var(--foreground)]">
              Share problems as links.
            </strong>{' '}
            Every problem in Boardhang has a web address — send it to a friend and it opens
            in their browser, no install needed. Something the official app can’t do.
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
            A local logbook tracks what you have climbed and shows an accurate grade pyramid.
          </li>
          <li>
            <strong className="font-medium text-[var(--foreground)]">Own your logbook.</strong>{' '}
            Your ascents are yours — export your logbook anytime, so your climbing history is
            never locked in or lost to an app migration.
          </li>
        </ul>
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
