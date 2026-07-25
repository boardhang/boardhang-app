import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Guides',
}

export default function Guides() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Guides</h1>
      <p className="mt-4 text-[var(--muted)]">
        Guides for building and using DIY LED MoonBoards are coming soon.
      </p>
    </>
  )
}
