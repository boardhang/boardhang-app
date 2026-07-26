import type { Metadata } from 'next'
import Link from 'next/link'
import { og } from '@/lib/og'
import { CONTACT_EMAIL } from '@/lib/urls'

const description =
  'What Boardhang stores, what stays in your browser, and how to delete your account. No advertising, no analytics, no tracking.'

export const metadata: Metadata = {
  title: 'Privacy',
  description,
  alternates: { canonical: '/privacy' },
  openGraph: og({ title: 'Privacy', description, url: '/privacy' }),
}

export default function Privacy() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Privacy</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        <time dateTime="2026-07-26">Last updated: July 26, 2026</time>
      </p>

      <p className="mt-4 text-lg text-[var(--muted)]">
        Boardhang does very little with your data, which makes this page short. There is no
        advertising, no analytics and no third-party tracking on this site or in the app.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Browsing needs no account</h2>
      <p className="mt-3 text-[var(--muted)]">
        If you only browse the catalog, filter problems and light them on your board, we store
        nothing about you on our servers. Your filters and sort order, your favorites, your
        recently-viewed problems, your added boards, your theme and your logbook all live in
        your own browser’s local storage on your own device. Clearing your browser data
        removes them, and they are not sent anywhere.
      </p>

      <h2 className="mt-10 text-xl font-semibold">If you sign in</h2>
      <p className="mt-3 text-[var(--muted)]">
        Signing in is optional and only needed for collaboration sessions and syncing your
        data between devices. You can sign in with an emailed code or with Google. In either
        case we store:
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-6 text-[var(--muted)]">
        <li>
          your email address — from you, or from the Google account you choose to use;
        </li>
        <li>
          the <code>@handle</code> and display name you pick, and an avatar image if you
          upload one;
        </li>
        <li>
          the content you create in the app: your logged ascents, your saved lists, the
          sessions you start or join, and any beta video you attach to a problem.
        </li>
      </ul>
      <p className="mt-3 text-[var(--muted)]">
        We use these only to run the app: to sign you in, to show your handle to the other
        climbers in a session, and to sync your own data between your devices.
      </p>

      <h2 className="mt-10 text-xl font-semibold">What other people can see</h2>
      <p className="mt-3 text-[var(--muted)]">
        Be aware of two things. Your handle, display name and avatar are readable by any
        signed-in Boardhang user — that is what makes handles findable and sessions work — and
        uploaded avatar images are served from a public URL. Inside a session, the other
        members see which problems you have sent or tried. Your logbook itself is not public.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Who processes it</h2>
      <p className="mt-3 text-[var(--muted)]">
        Sign-in, the database and file storage are provided by{' '}
        <a href="https://supabase.com">Supabase</a>. This site and the app are hosted by{' '}
        <a href="https://vercel.com">Vercel</a>. Both process data on our behalf. We do not
        sell your data or share it with anyone else.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Getting your data out, and deleting it</h2>
      <p className="mt-3 text-[var(--muted)]">
        You can export your logbook from the app at any time — it is your climbing history and
        it should never be locked in. You can also delete your account from the account menu
        in the app. Deleting your account removes your profile, your ascents, your lists, your
        session membership and your uploaded avatar. It cannot be undone, so export anything
        you want to keep first.
      </p>
      <p className="mt-3 text-[var(--muted)]">
        If you would rather we did it for you, or you want to know what we hold about you,
        email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will sort it out.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Questions</h2>
      <p className="mt-3 text-[var(--muted)]">
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, or{' '}
        <a href="https://github.com/boardhang/boardhang-app/issues">open an issue</a> if it is
        something other people would benefit from seeing answered. Boardhang is{' '}
        <Link href="/about">an unofficial project built by two climbers</Link>, and the whole
        app is <a href="https://github.com/boardhang/boardhang-app">open source</a> — if you
        want to check any of the above, you can read the code.
      </p>
    </>
  )
}
