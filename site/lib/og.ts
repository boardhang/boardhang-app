import type { Metadata } from 'next'

// A page-level openGraph object replaces the layout's wholesale (Next merges
// metadata shallowly), and the app/opengraph-image.png file convention only
// attaches to its own segment — child pages that set openGraph lose both the
// siteName and the image. Every page builds its openGraph through this helper
// so those stay intact.
//
// The image must be spelled out in full. Supplying `images` at all replaces
// what the file convention contributes, so a bare URL string silently drops the
// type/width/height it would otherwise emit — which is what unfurlers use to
// reserve a card before the image loads.
export function og(overrides: NonNullable<Metadata['openGraph']>): Metadata['openGraph'] {
  return {
    siteName: 'Boardhang',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: '/opengraph-image.png',
        type: 'image/png',
        width: 1200,
        height: 630,
        alt: 'Boardhang — MoonBoard problems in the browser',
      },
    ],
    ...overrides,
  }
}
