import type { Metadata } from 'next'
import Link from 'next/link'
import { og } from '@/lib/og'

const description =
  'Boardhang is a free, unofficial web app for MoonBoards, built by two climbers with a DIY LED board. Who makes it, where the catalog comes from, and how to reach us.'

const title = 'About Boardhang: who makes it and where the data comes from'

export const metadata: Metadata = {
  // Absolute: "Boardhang" is already in the title, so the "· Boardhang"
  // template would only push it past the SERP truncation point.
  title: { absolute: title },
  description,
  alternates: { canonical: '/about' },
  openGraph: og({ title, description, url: '/about' }),
}

export default function About() {
  return (
    <>
      <h1 className="text-3xl font-semibold">About Boardhang</h1>

      <p className="mt-4 text-lg text-[var(--muted)]">
        Boardhang is made by two climbers with a MoonBoard and a DIY LED system behind it. It
        is free, open source, and not affiliated with Moon Climbing.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Why it exists</h2>
      <p className="mt-3 text-[var(--muted)]">
        Our board runs the open-source{' '}
        <a href="https://github.com/FabianRig/ArduinoMoonBoardLED">ArduinoMoonBoardLED</a>{' '}
        firmware, and we drove it with the official app for a while. The friction added up.
        The default sorting never made sense and nothing was saved, so every trip into the
        catalog started with setting the same filters again. The grade pyramid didn’t add up.
        Climbing together meant constantly cross-checking who had done what. And every time
        someone changed the problem, someone else asked which one was lit.
      </p>
      <p className="mt-3 text-[var(--muted)]">
        So we wrote the app we wished we had — first for our own board, then for anyone with
        the same setup and the same complaints.
      </p>

      <h2 className="mt-10 text-xl font-semibold">We are not Moon Climbing</h2>
      <p className="mt-3 text-[var(--muted)]">
        Boardhang is unofficial. It is not affiliated with, or endorsed by, Moon Climbing Ltd,
        and MoonBoard is their trademark. The official MoonBoard app remains the only
        sanctioned, complete source of problems, and for some things — a complete problem list
        and an official logbook — it is still the right tool.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Where the catalog comes from</h2>
      <p className="mt-3 text-[var(--muted)]">
        The catalog is a curated subset, not every problem ever set: around 12,000 problems
        including 2,832 official benchmarks, across MoonBoard 2016, MoonBoard 2024, Masters
        2017, Masters 2019 and Mini MoonBoard 2025. The data is mirrored from the community{' '}
        <a href="https://www.boardsesh.com">Boardsesh</a> API, which is the foundation a lot of
        community MoonBoard tools build on, including ours. It is not an official Moon Climbing
        dataset.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Built in the open</h2>
      <p className="mt-3 text-[var(--muted)]">
        The whole app — catalog to Bluetooth — is{' '}
        <a href="https://github.com/boardhang/boardhang-app">on GitHub</a> under the MIT
        license. Read the code, check our claims, or build on it. If something bugs you or
        there’s a feature you wish existed,{' '}
        <a href="https://github.com/boardhang/boardhang-app/issues">open an issue</a> or send a
        pull request.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Get in touch</h2>
      <p className="mt-3 text-[var(--muted)]">
        The fastest way to reach us is to{' '}
        <a href="https://github.com/boardhang/boardhang-app/issues">open an issue</a> — that
        covers bugs, feature ideas and corrections. If you hold rights in anything published
        here and want it changed or taken down, open an issue and we will act on it.
      </p>

      <h2 className="mt-10 text-xl font-semibold">What it costs</h2>
      <p className="mt-3 text-[var(--muted)]">
        Nothing. Browsing the catalog and lighting problems on your board need no install and
        no account. Collaboration sessions need a free sign-in, because they show your crew
        what everyone has sent. There is no advertising and nothing is sold — see our{' '}
        <Link href="/privacy">privacy notice</Link>.
      </p>

      <section className="mt-14 border-t border-[var(--border)] pt-8">
        <p className="text-[var(--muted)]">
          <a href="https://www.boardhang.app" className="font-medium">
            Open the app
          </a>{' '}
          or read the <Link href="/guides">guides</Link>.
        </p>
      </section>
    </>
  )
}
