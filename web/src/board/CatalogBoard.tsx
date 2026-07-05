// Read-only board render for the catalog: stacks the board background, the
// visible hold-set overlays, and hold markers positioned by the shared render
// geometry. Ported from ios/MoonBoardLED/Board/BoardImageView.swift. This is
// non-interactive by design (R13) — it takes no tap handler.

import type { CSSProperties, SyntheticEvent } from 'react'
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
}

/** Marker diameter as a fraction of one column's span on the board art. */
const MARKER_COLUMN_RATIO = 0.6
const MARKER_BORDER_WIDTH = '2px'

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
}: CatalogBoardProps) {
  const g = board.geometry
  const overlays = board.holdSets.filter(
    (s) => visibleHoldSetIds === undefined || visibleHoldSetIds.has(s.id),
  )
  const markerPct = ((1 - g.leftMargin - g.rightMargin) / g.numColumns) * MARKER_COLUMN_RATIO * 100

  return (
    <div
      className="catalog-board overflow-hidden rounded-lg bg-card"
      role="img"
      aria-label={`${board.name} problem, ${holds.length} holds`}
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
              border: `${MARKER_BORDER_WIDTH} solid ${holdColor[role]}`,
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.35)',
              boxSizing: 'border-box',
            }}
          />
        )
      })}
    </div>
  )
}
