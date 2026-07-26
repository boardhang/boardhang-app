// Full-height board picker for the holds filter, ported from iOS
// HoldFilterPickerView. Renders the real board art (via CatalogBoard) and
// overlays a tappable target on every installed hold position; tapping toggles
// that "col-row" position in the filter. Selected holds get a yellow ring, and
// only positions on an active hold set are selectable (parity with iOS
// HoldFilter.isSelectable). The predicate (superset match) lives in filters.ts.

import { useMemo, type CSSProperties } from 'react'
import { getActiveHoldSetsRaw, instanceForLayout } from '../board/boardStore'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import { columnLabel } from '../board/geometry'
import { holdSetContext, setIdAt } from '../board/holdSetMembership'
import { center } from '../board/renderGeometry'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'

// Tap-target diameter as a fraction of a column's span — matches CatalogBoard's
// marker size so the ring sits right on the drawn hold.
const TARGET_COLUMN_RATIO = 0.9

interface Pos {
  col: number
  row: number
  x: number
  y: number
}

interface HoldFilterPickerProps {
  board: CatalogBoardDef
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Selected "col-row" positions. */
  value: string[]
  onChange: (next: string[]) => void
}

export function HoldFilterPicker({ board, open, onOpenChange, value, onChange }: HoldFilterPickerProps) {
  const g = board.geometry
  const { membership, active, visible } = useMemo(
    () => holdSetContext(board.membershipResource, getActiveHoldSetsRaw(instanceForLayout(board))),
    [board],
  )

  // Selectable positions: those owned by an installed hold set. A board with no
  // bundled membership map allows every grid position (matches iOS fallback).
  const positions = useMemo<Pos[]>(() => {
    const noMembership = Object.keys(membership.membership).length === 0
    const out: Pos[] = []
    for (let col = 0; col < g.numColumns; col++) {
      for (let row = 1; row <= g.rowTop; row++) {
        if (!noMembership) {
          const id = setIdAt(membership, col, row)
          if (id === undefined || !active.has(id)) continue
        }
        const { x, y } = center(g, col, row)
        out.push({ col, row, x, y })
      }
    }
    return out
  }, [g, membership, active])

  const selected = useMemo(() => new Set(value), [value])
  const targetPct = ((1 - g.leftMargin - g.rightMargin) / g.numColumns) * TARGET_COLUMN_RATIO * 100

  const toggle = (col: number, row: number) => {
    const key = `${col}-${row}`
    onChange(selected.has(key) ? value.filter((k) => k !== key) : [...value, key])
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      {/* Nearly full-height so the whole board is visible without scrolling. */}
      <DrawerContent style={{ '--drawer-height': 'calc(100dvh - 4rem)' } as CSSProperties}>
        <DrawerTitle className="sr-only">Filter by hold</DrawerTitle>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
            <div className="min-w-0">
              <div className="font-heading text-base font-medium text-foreground">Filter by hold</div>
              <div className="truncate text-xs text-muted-foreground">
                {value.length === 0
                  ? 'Tap holds to show only problems that use them'
                  : `${value.length} hold${value.length === 1 ? '' : 's'} selected`}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={value.length === 0}
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3">
            {/* Height-driven so the whole board (all rows) stays visible; width
                follows the aspect ratio and is clamped to the container. The tap
                targets are children of CatalogBoard, so they share its exact
                rendered box and stay aligned on any board aspect ratio. */}
            <div
              className="flex h-full max-w-full items-center justify-center"
              style={{ aspectRatio: `${g.width} / ${g.height}` }}
            >
              <CatalogBoard board={board} holds={[]} visibleHoldSetIds={visible}>
                {positions.map(({ col, row, x, y }) => {
                  const isSelected = selected.has(`${col}-${row}`)
                  return (
                    <button
                      key={`${col}-${row}`}
                      type="button"
                      aria-label={`${columnLabel(col)}${row}`}
                      aria-pressed={isSelected}
                      onClick={() => toggle(col, row)}
                      className="absolute rounded-full transition-shadow"
                      style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        width: `${targetPct}%`,
                        aspectRatio: '1',
                        transform: 'translate(-50%, -50%)',
                        // Selected: yellow ring + faint fill (iOS parity). Idle:
                        // transparent but hit-testable over the drawn hold.
                        boxShadow: isSelected ? '0 0 0 3px #facc15' : undefined,
                        backgroundColor: isSelected ? 'rgba(250, 204, 21, 0.25)' : 'transparent',
                      }}
                    />
                  )
                })}
              </CatalogBoard>
            </div>
          </div>

          <div className="shrink-0 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
