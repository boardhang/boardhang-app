import type { Metadata } from 'next'
import Link from 'next/link'
import { JsonLd } from '@/components/json-ld'
import { og } from '@/lib/og'
import { APP_URL, CONTACT_EMAIL, SITE_URL } from '@/lib/urls'

export const metadata: Metadata = {
  title: { absolute: 'Boardhang — free web app for MoonBoards' },
  description:
    'Free, unofficial web app for MoonBoards: browse around 12,000 problems, keep your filters between visits, and light any problem over Web Bluetooth.',
  alternates: { canonical: '/' },
  openGraph: og({ url: '/' }),
}

const ORG_ID = `${SITE_URL}/#organization`
const GITHUB_URL = 'https://github.com/boardhang/boardhang-app'

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'Boardhang',
  url: SITE_URL,
  logo: `${SITE_URL}/opengraph-image.png`,
  description:
    'Boardhang is an unofficial, community-built free web app for MoonBoards, made by two climbers with a DIY LED board. Not affiliated with Moon Climbing Ltd.',
  sameAs: [GITHUB_URL],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    email: CONTACT_EMAIL,
    url: `${GITHUB_URL}/issues`,
  },
}

const softwareApplicationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SITE_URL}/#app`,
  name: 'Boardhang',
  url: APP_URL,
  applicationCategory: 'SportsApplication',
  operatingSystem: 'Web',
  license: 'https://opensource.org/license/mit/',
  isAccessibleForFree: true,
  publisher: { '@id': ORG_ID },
  sameAs: [GITHUB_URL],
  browserRequirements:
    'Browsing the catalog works in any modern browser. Lighting problems over Web Bluetooth requires Chrome or Edge on desktop or Android, or the Bluefy browser on iOS.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  description:
    'Free, unofficial web app for DIY MoonBoards. Connects over Web Bluetooth and lights MoonBoard problems on boards running the open-source ArduinoMoonBoardLED firmware.',
  featureList: [
    'Lights problems on DIY MoonBoards over Web Bluetooth',
    'Compatible with the open-source ArduinoMoonBoardLED Arduino firmware',
    'Catalog of ~12,000 curated MoonBoard problems including 2,832 official benchmarks',
    'Covers 5 layouts: MoonBoard 2016, 2024, Masters 2017, Masters 2019 and Mini MoonBoard 2025',
    'Search, grade filters and favorites',
    'Remembers filter and sort settings per board between visits',
    'Every problem is shareable as a normal web link',
    'Collaboration sessions (free sign-in required): see what each climber in your crew has sent or tried, and what is lit on the wall right now',
    'Recently-viewed history of lit problems',
    'Local logbook with a grade pyramid, exportable anytime — you own your data',
    'Runs in the browser with no install — browsing, filtering and lighting problems need no account',
    'Open source under the MIT license — issues and pull requests welcome on GitHub',
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
            hand and finish holds each in their own color. It works with DIY LED MoonBoards
            running the open-source ArduinoMoonBoardLED firmware.
          </li>
          <li>
            <strong className="font-medium text-[var(--foreground)]">
              Keep your filters.
            </strong>{' '}
            Sort and filter the catalog once — Boardhang remembers your setup per board, so
            every visit starts where you left off, not from scratch.
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
            A local logbook tracks what you have climbed and builds a grade pyramid from every
            ascent you log.
          </li>
          <li>
            <strong className="font-medium text-[var(--foreground)]">Own your logbook.</strong>{' '}
            Your ascents are yours — export your logbook anytime, so your climbing history is
            never locked in or lost to an app migration.
          </li>
        </ul>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Browser support</h2>
        <p className="mt-3 text-[var(--muted)]">
          Web Bluetooth needs Chrome or Edge on desktop or Android. On iPhone, use the Bluefy
          browser. Browsing the catalog works in any modern browser.
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Built in the open</h2>
        <p className="mt-3 text-[var(--muted)]">
          Boardhang is open source under the MIT license — the whole app, catalog to
          Bluetooth, lives{' '}
          <a href="https://github.com/boardhang/boardhang-app">on GitHub</a>. If something
          bugs you or there’s a feature you wish existed,{' '}
          <a href="https://github.com/boardhang/boardhang-app/issues">open an issue</a> and
          tell us, or send a pull request and build it with us. That’s how this app got made
          in the first place.
        </p>
      </section>

      <section className="mt-14 border-t border-[var(--border)] pt-8">
        <p className="text-[var(--muted)]">
          Ready to climb?{' '}
          <a href="https://www.boardhang.app" className="font-medium">
            Open the app
          </a>{' '}
          — or read{' '}
          <Link href="/guides/moonboard-website-not-working">
            where to browse MoonBoard problems now that moonboard.com no longer serves them
          </Link>
          .
        </p>
      </section>
    </>
  )
}
