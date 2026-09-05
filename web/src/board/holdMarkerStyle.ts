// Hold-marker style shared by the app's board render (CatalogBoard.tsx) and the
// link-preview card (api/_lib/boardCard.ts), so the two renders can never drift.
// A LEAF module on purpose (no imports): api/ runs as Node ESM and may only import
// leaf modules from src/.

/** Marker diameter as a fraction of one column's span on the board art.
    Matches iOS BoardImageView (0.9), so the colored fill reads even at thumbnail
    size where a thin outline ring would nearly vanish. */
export const MARKER_COLUMN_RATIO = 0.9
/** Two-char hex alpha (~0.35) appended to a hex hold color for the fill — the
    translucent center iOS draws under the colored ring. */
export const MARKER_FILL_ALPHA = '59'
/** Width of the role-colored ring, in CSS px. */
export const MARKER_BORDER_PX = 2
