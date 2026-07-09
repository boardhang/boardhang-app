// Read-only board render for the catalog: stacks the board background, the
// visible hold-set overlays, and hold markers positioned by the shared render
// geometry. Ported from ios/MoonBoardLED/Board/BoardImageView.swift. This is
// non-interactive by design (R13) — it takes no tap handler.

import type { CSSProperties, ReactNode, SyntheticEvent } from 'react'
import type { CatalogHold } from '../catalog/catalogSync'
import { displayed, holdColor } from '../types'
import type { CatalogBoardDef } from './boards'
import { center } from './renderGeometry'

interface CatalogBoardProps {
  board: CatalogBoardDef
  holds: CatalogHold[]
  /** Hold-set ids whose overlay art is drawn; defaults to all of the board's sets. */
  visibleHoldSetIds?: Set<number>
  /** When false (default), move roles collapse to a single blue marker. */
  showBeta?: boolean
  /** "col-row" positions from the active holds filter to ring in yellow. Only
      positions the problem actually uses are ringed, so no stray rings appear. */
  highlightHolds?: Set<string>
  /** Overlay rendered inside the board's own position:relative, aspect-ratio-sized
      box. Interactive children position themselves (e.g. `absolute inset-0`), so
      targets placed with the render geometry share the exact art box and stay
      aligned regardless of how the parent sizes the board. */
  children?: ReactNode
}

/** Marker diameter as a fraction of one column's span on the board art.
    Matches iOS BoardImageView (0.9), so the colored fill reads even at thumbnail
    size where a thin outline ring would nearly vanish. */
const MARKER_COLUMN_RATIO = 0.9
const MARKER_BORDER_WIDTH = '2px'
/** Yellow ring for holds-filter highlights; a touch larger than the marker so it
    encircles rather than overlaps it. Matches the picker's selection color. */
const HIGHLIGHT_COLUMN_RATIO = 1.15
const HIGHLIGHT_COLOR = '#facc15'
/** Two-hex-digit alpha (~0.35) appended to a 6-digit hold color for the fill —
    the translucent center iOS draws under the colored ring. */
const MARKER_FILL_ALPHA = '59'

const fill: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
}

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}boards/${path}`
}

// A missing PNG (e.g. export_board_art_web.py not re-run) degrades to nothing
// visible rather than the browser's broken-image icon.
function hideBrokenImage(e: SyntheticEvent<HTMLImageElement>): void {
  e.currentTarget.style.visibility = 'hidden'
}

/**
 * Renders a board and a problem's holds. Fills 100% of its parent's width and
 * derives height from the board aspect ratio, so the parent must constrain the
 * width (e.g. a max-width card) — otherwise the board grows to the full width
 * available.
 */
export function CatalogBoard({
  board,
  holds,
  visibleHoldSetIds,
  showBeta = false,
  highlightHolds,
  children,
}: CatalogBoardProps) {
  const g = board.geometry
  const overlays = board.holdSets.filter(
    (s) => visibleHoldSetIds === undefined || visibleHoldSetIds.has(s.id),
  )
  const colSpanPct = ((1 - g.leftMargin - g.rightMargin) / g.numColumns) * 100
  const markerPct = colSpanPct * MARKER_COLUMN_RATIO
  const highlightPct = colSpanPct * HIGHLIGHT_COLUMN_RATIO
  // Ring only the highlighted positions the problem actually uses (a ring on an
  // empty slot — e.g. an unfiltered recent — would float over bare board art).
  const rings = highlightHolds
    ? holds.filter((h) => highlightHolds.has(`${h.c}-${h.r}`))
    : []

  return (
    <div
      className="catalog-board overflow-hidden rounded-lg bg-card"
      role="img"
      aria-label={
        holds.length > 0 ? `${board.name} problem, ${holds.length} holds` : `${board.name} board`
      }
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${g.width} / ${g.height}`,
      }}
    >
      {/* The background art is black axis labels on transparency; invert so they
          read white on the dark board surface (iOS template-tints them the same way). */}
      <img
        src={assetUrl(`${board.background}.png`)}
        alt=""
        className="invert"
        style={fill}
        onError={hideBrokenImage}
      />
      {overlays.map((s) => (
        <img
          key={s.id}
          src={assetUrl(`${board.folder}/${s.imageName}.png`)}
          alt=""
          data-holdset={s.id}
          style={fill}
          onError={hideBrokenImage}
        />
      ))}
      {holds.map((h, i) => {
        const { x, y } = center(g, h.c, h.r)
        const role = displayed(h.t, showBeta)
        return (
          <div
            key={`${h.c}-${h.r}-${i}`}
            data-testid="hold-marker"
            data-role={role}
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${markerPct}%`,
              aspectRatio: '1',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              backgroundColor: `${holdColor[role]}${MARKER_FILL_ALPHA}`,
              border: `${MARKER_BORDER_WIDTH} solid ${holdColor[role]}`,
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.4)',
              boxSizing: 'border-box',
            }}
          />
        )
      })}
      {rings.map((h) => {
        const { x, y } = center(g, h.c, h.r)
        return (
          <div
            key={`ring-${h.c}-${h.r}`}
            data-testid="hold-highlight"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${highlightPct}%`,
              aspectRatio: '1',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              border: `2px solid ${HIGHLIGHT_COLOR}`,
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.45)',
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          />
        )
      })}
      {/* Interactive overlay (e.g. the holds-filter tap targets). Absolutely
          positioned children share this box, so geometry-based coordinates land
          on the drawn holds no matter how the parent sizes the board. */}
      {children}
    </div>
  )
}
