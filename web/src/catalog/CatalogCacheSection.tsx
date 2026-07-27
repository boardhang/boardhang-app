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
  const [rebuilding, setRebuilding] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
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

  async function handleRebuild() {
    setConfirmOpen(false)
    setRebuilding(true)
    let failed = 0
    let total = 0
    // Sequential, not parallel: each slab is a multi-megabyte paged download, and the
    // failure this feature exists for looks like resource exhaustion. One at a time.
    for (const slab of slabs) {
      patch(slab.key, { busy: true, error: undefined, count: undefined })
      try {
        const { problems, synced, error } = await rebuildSlab(slab.board.layoutId, slab.angle)
        total += problems.length
        if (!synced) failed++
        patch(slab.key, { busy: false, count: problems.length, error: synced ? undefined : (error ?? 'Download failed') })
      } catch (err) {
        failed++
        patch(slab.key, { busy: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
    if (mounted.current) setRebuilding(false)
    toast(
      failed === 0
        ? `Catalog rebuilt — ${total.toLocaleString()} problems`
        : `Rebuild incomplete — ${failed} board${failed === 1 ? '' : 's'} failed to download`,
    )
  }

  if (slabs.length === 0) return null

  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Catalog cache</h2>
          <p className="text-sm text-muted-foreground">
            Problems are downloaded once per board and kept on this device. Rebuild if a board
            is missing problems — it deletes the local copy and downloads every problem again.
          </p>
        </div>

        <ul className="divide-y rounded-md border text-sm">
          {slabs.map(({ key, board, angle }) => {
            const slab = state[key] ?? {}
            return (
              <li key={key} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{board.name}</div>
                  <div className="text-xs text-muted-foreground">{angle}°</div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  {slab.busy ? (
                    <span className="text-muted-foreground">Downloading…</span>
                  ) : slab.error ? (
                    <span className="text-destructive">Failed</span>
                  ) : slab.count === undefined ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {slab.count.toLocaleString()} problems
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {slabs.some(({ key }) => state[key]?.error) && (
          <p className="text-xs text-destructive" role="alert">
            {slabs
              .filter(({ key }) => state[key]?.error)
              .map(({ key, board, angle }) => `${board.name} ${angle}°: ${state[key]?.error}`)
              .join(' · ')}
          </p>
        )}

        <Button
          variant="outline"
          className="w-full"
          disabled={rebuilding}
          onClick={() => setConfirmOpen(true)}
        >
          <RefreshCw className={`size-4 ${rebuilding ? 'animate-spin' : ''}`} />
          {rebuilding ? 'Rebuilding…' : 'Rebuild catalog'}
        </Button>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Rebuild the catalog?</DialogTitle>
              <DialogDescription>
                Deletes the problems stored on this device and downloads them all again — tens
                of thousands per board. Use Wi-Fi, and keep this screen open until it finishes.
                Your logbook, lists and favourites are untouched.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void handleRebuild()}>
                Rebuild
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
