import type { Metadata } from 'next'

// A page-level openGraph object replaces the layout's wholesale (Next merges
// metadata shallowly), and the app/opengraph-image.png file convention only
// attaches to its own segment — child pages that set openGraph lose both the
// siteName and the image. Every page builds its openGraph through this helper
// so those stay intact.
export function og(overrides: NonNullable<Metadata['openGraph']>): Metadata['openGraph'] {
  return {
    siteName: 'Boardhang',
    type: 'website',
    images: ['/opengraph-image.png'],
    ...overrides,
  }
}
