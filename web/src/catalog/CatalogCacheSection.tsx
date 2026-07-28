// Settings section: what the local catalog cache actually holds, per owned board+angle,
// and a "Rebuild catalog" escape hatch that wipes it and re-downloads every problem.
//
// Pull-to-refresh (CatalogScreen) already resets a slab's sync cursor, but it's additive —
// it can't recover a cache the browser evicted or a first sync left half-written, and it
// gives no signal that a slab is short. This section makes the count visible and offers
// the reset that previously required deleting and reinstalling the browser/PWA.

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useBoardStore } from '../board/boardStore'
import type { CatalogBoardDef } from '../board/boards'
import { countSlab, rebuildSlab } from './catalogSync'

interface Slab {
  key: string
  board: CatalogBoardDef
  angle: number
}

/** Every slab the user could browse: one per owned board × wall angle. */
function slabsFor(boards: CatalogBoardDef[]): Slab[] {
  return boards.flatMap((board) =>
    board.angles.map((angle) => ({ key: `${board.layoutId}_${angle}`, board, angle })),
  )
}

type SlabState = { count?: number; error?: string; busy?: boolean }

export function CatalogCacheSection() {
  const { addedBoards } = useBoardStore()
  const slabs = slabsFor(addedBoards)
  const [state, setState] = useState<Record<string, SlabState>>({})
  // Rebuilds are per board+angle and one at a time: each slab is a multi-megabyte paged
  // download, and the failure this section exists for looks like resource exhaustion.
  const [rebuilding, setRebuilding] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Slab | null>(null)
  // Guards the async count/rebuild writes against leaving Settings mid-flight.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const patch = useCallback((key: string, next: SlabState) => {
    if (mounted.current) setState((prev) => ({ ...prev, [key]: { ...prev[key], ...next } }))
  }, [])

  // Counts are read once per visit — the cache only changes under a rebuild here or a
  // catalog visit, both of which re-enter this screen. `addedBoards` is boardStore's
  // cached snapshot (stable between writes), so this doesn't loop.
  useEffect(() => {
    for (const slab of slabsFor(addedBoards)) {
      countSlab(slab.board.layoutId, slab.angle)
        .then((count) => patch(slab.key, { count }))
        .catch(() => patch(slab.key, { count: undefined }))
    }
  }, [addedBoards, patch])

  async function handleRebuild(slab: Slab) {
    const label = `${slab.board.name} ${slab.angle}°`
    setConfirming(null)
    setRebuilding(slab.key)
    patch(slab.key, { busy: true, error: undefined, count: undefined })
    try {
      const { problems, synced, error } = await rebuildSlab(slab.board.layoutId, slab.angle)
      patch(slab.key, {
        busy: false,
        count: problems.length,
        error: synced ? undefined : (error ?? 'Download failed'),
      })
      toast(
        synced
          ? `${label} rebuilt — ${problems.length.toLocaleString()} problems`
          : `${label} didn't finish downloading — try again`,
      )
    } catch (err) {
      patch(slab.key, { busy: false, error: err instanceof Error ? err.message : String(err) })
      toast(`${label} didn't finish downloading — try again`)
    } finally {
      if (mounted.current) setRebuilding(null)
    }
  }

  if (slabs.length === 0) return null

  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Catalog cache</h2>
          <p className="text-sm text-muted-foreground">
            Problems are downloaded once per board and kept on this device. Rebuild a board
            that's missing problems — it deletes that board's local copy and downloads every
            problem again.
          </p>
        </div>

        <ul className="divide-y rounded-md border text-sm">
          {slabs.map((slab) => {
            const { key, board, angle } = slab
            const row = state[key] ?? {}
            return (
              <li key={key} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{board.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {angle}°
                    {' · '}
                    {row.busy ? (
                      'Downloading…'
                    ) : row.error ? (
                      <span className="text-destructive" role="alert">
                        {row.error}
                      </span>
                    ) : row.count === undefined ? (
                      '—'
                    ) : (
                      `${row.count.toLocaleString()} problems`
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  // One rebuild at a time — a second concurrent slab download is the surest
                  // way to re-create the resource exhaustion this is here to undo.
                  disabled={rebuilding !== null}
                  aria-label={`Rebuild ${board.name} ${angle}°`}
                  onClick={() => setConfirming(slab)}
                >
                  <RefreshCw className={`size-4 ${row.busy ? 'animate-spin' : ''}`} />
                  Rebuild
                </Button>
              </li>
            )
          })}
        </ul>

        <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                Rebuild {confirming?.board.name} {confirming?.angle}°?
              </DialogTitle>
              <DialogDescription>
                Deletes this board's downloaded problems from this device and downloads them
                all again — up to tens of thousands. Use Wi-Fi, and keep this screen open
                until it finishes. Problems you've created are untouched, as are other
                boards, your logbook, lists and favourites.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => confirming && void handleRebuild(confirming)}
              >
                Rebuild
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
