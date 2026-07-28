// The problem authoring surface: a full-height drawer with a tap grid over the real
// board art. Built on the HoldFilterPicker pattern (plan KTD8) rather than the retired
// BoardGrid — tap targets are children of CatalogBoard, so they share its exact rendered
// box and register with the drawn holds at any aspect ratio, and only positions owned by
// an installed hold set are tappable.
//
// Interaction (KTD8): tapping an empty position cycles the common roles
// start → move (`right`) → end → empty. The brush palette sets an explicit role for the
// beta moves (left / right / match); with a brush active a tap assigns that role, and
// tapping a hold that already carries it removes it. Every target's aria-label names its
// position and current role — a five-state control can't be conveyed by aria-pressed.
//
// Light-up sends BLE directly and deliberately does NOT call `reportProblemLit`
// (KTD9/R3/AE5): an unsaved draft must never become a session's shared "on the wall"
// problem. The draft persists to localStorage on every change (KTD10) so it survives a
// reload at the wall. Saving is not wired yet — the Save button is a disabled placeholder.

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'
import { bleClient, connectBoard, isConnected, setBleError, useBle } from '../ble/useBle'
import { describeBleError } from '../ble/moonboard'
import { getActiveHoldSetsRaw, getFlipped } from '../board/boardStore'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import { columnLabel } from '../board/geometry'
import { holdSetContext, setIdAt } from '../board/holdSetMembership'
import { center } from '../board/renderGeometry'
import { holdColor, holdLabel, type HoldType } from '../types'
import type { CatalogHold } from './catalogSync'
import { clearDraft, readDraft, writeDraft, type ProblemDraft } from './problemDraftStore'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Tap-target diameter as a fraction of a column's span — matches CatalogBoard's
 *  marker size so the target sits right on the drawn hold. */
const TARGET_COLUMN_RATIO = 0.9

/** The common-role tap cycle, matching the retired BuildScreen's: an empty position
 *  walks start → move → end → empty without ever touching the palette. */
const CYCLE: (HoldType | null)[] = [null, 'start', 'right', 'end']

/** Roles the palette paints. The cycle already reaches start and end; the palette exists
 *  for the beta moves, which have no place in a three-step cycle (KTD8). */
const BRUSH_ROLES: HoldType[] = ['left', 'right', 'match']

function nextInCycle(current: HoldType | null): HoldType | null {
  const i = CYCLE.findIndex((t) => t === current)
  return CYCLE[(i + 1) % CYCLE.length]
}

interface Pos {
  col: number
  row: number
  x: number
  y: number
}

interface ProblemEditorDrawerProps {
  board: CatalogBoardDef
  /** The slab's resolved angle — inherited from the URL, shown in the header, and part
   *  of the draft's storage key. */
  angle: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Busy = 'connecting' | 'sending' | null

export function ProblemEditorDrawer({ board, angle, open, onOpenChange }: ProblemEditorDrawerProps) {
  const g = board.geometry
  const { state, error: connectionError } = useBle()

  const [draft, setDraft] = useState<ProblemDraft>(() => readDraft(board.layoutId, angle))
  const [brush, setBrush] = useState<HoldType | null>(null)
  // Dirty *since open* (KTD10): a restored draft alone must not demand a discard
  // confirmation — only edits made in this sitting do.
  const [dirty, setDirty] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)

  // Restore on open (and on a board/angle switch), which is also the mount path when the
  // editor opens straight from a `?new=1` deep link.
  useEffect(() => {
    if (!open) return
    setDraft(readDraft(board.layoutId, angle))
    setBrush(null)
    setDirty(false)
    setSendError(null)
  }, [open, board.layoutId, angle])

  const { membership, active, visible } = useMemo(
    () => holdSetContext(board.membershipResource, getActiveHoldSetsRaw(board.layoutId)),
    [board],
  )

  // Tappable positions: those owned by an installed hold set. A board with no bundled
  // membership map allows every grid position — the same fail-open `isClimbable` takes,
  // so an unmapped board stays fully authorable rather than becoming untappable.
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

  const roleAt = useMemo(() => {
    const map = new Map<string, HoldType>()
    for (const h of draft.holds) map.set(`${h.c}-${h.r}`, h.t)
    return map
  }, [draft.holds])

  const targetPct = ((1 - g.leftMargin - g.rightMargin) / g.numColumns) * TARGET_COLUMN_RATIO * 100

  function update(holds: CatalogHold[]) {
    const next = { ...draft, holds }
    setDraft(next)
    setDirty(true)
    writeDraft(board.layoutId, angle, next)
  }

  function tap(col: number, row: number) {
    const current = roleAt.get(`${col}-${row}`) ?? null
    // With a brush down the tap is an assignment; tapping the brush's own role lifts it
    // again, so the palette can both paint and erase without a separate eraser mode.
    const next = brush ? (current === brush ? null : brush) : nextInCycle(current)
    if (next === null) {
      update(draft.holds.filter((h) => !(h.c === col && h.r === row)))
      return
    }
    // Replace in place when the position already had a role, so re-roling a hold doesn't
    // reorder the draft under the author.
    update(
      current === null
        ? [...draft.holds, { c: col, r: row, t: next }]
        : draft.holds.map((h) => (h.c === col && h.r === row ? { ...h, t: next } : h)),
    )
  }

  function requestClose() {
    if (dirty) {
      setConfirmingDiscard(true)
      return
    }
    onOpenChange(false)
  }

  function discard() {
    clearDraft(board.layoutId, angle)
    setDraft(readDraft(board.layoutId, angle))
    setDirty(false)
    setConfirmingDiscard(false)
    onOpenChange(false)
  }

  // Direct BLE send, connect-if-needed — modeled on useLightUp but WITHOUT its session
  // pointer write (KTD9). Failures read inline here rather than as a toast: the editor is
  // a working surface the author stays on, so the error belongs beside the button.
  async function lightUp() {
    if (busy) return
    setSendError(null)
    setBleError(null)
    if (!isConnected()) {
      setBusy('connecting')
      await connectBoard()
      if (!isConnected()) {
        setBusy(null)
        return // cancelled, or the connection error is already in the shared BLE state
      }
    }
    setBusy('sending')
    try {
      await bleClient.send(
        draft.holds.map((h) => ({ col: h.c, row: h.r, type: h.t })),
        { rows: g.numRows, flipped: getFlipped(board.layoutId), showBeta: true },
      )
    } catch (err) {
      setSendError(describeBleError(err))
    } finally {
      setBusy(null)
    }
  }

  const shownError = sendError ?? connectionError
  const holdCount = draft.holds.length

  return (
    <>
      <Drawer open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())} showSwipeHandle>
        {/* Nearly full-height so the whole board is visible without scrolling — the
            author needs every row reachable in one view. */}
        <DrawerContent style={{ '--drawer-height': 'calc(100dvh - 4rem)' } as CSSProperties}>
          <DrawerTitle className="sr-only">New problem</DrawerTitle>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
              <div className="min-w-0">
                <div className="font-heading text-base font-medium text-foreground">New problem</div>
                <div className="truncate text-xs text-muted-foreground">
                  {board.name} · {angle}°
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" disabled={holdCount === 0} onClick={() => update([])}>
                  Clear
                </Button>
                <Button variant="ghost" size="sm" onClick={requestClose}>
                  Cancel
                </Button>
              </div>
            </div>

            {/* Role palette. No brush = the tap cycle; a brush paints its role directly. */}
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 pb-3">
              <Button
                variant={brush === null ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={brush === null}
                onClick={() => setBrush(null)}
              >
                Cycle
              </Button>
              {BRUSH_ROLES.map((role) => (
                <Button
                  key={role}
                  variant={brush === role ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-label={`${holdLabel[role]} brush`}
                  aria-pressed={brush === role}
                  className="gap-2"
                  onClick={() => setBrush(brush === role ? null : role)}
                >
                  <span
                    aria-hidden
                    className="size-3 rounded-full border"
                    style={{ backgroundColor: `${holdColor[role]}59`, borderColor: holdColor[role] }}
                  />
                  {holdLabel[role]}
                </Button>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3">
              {/* Height-driven so every row stays visible; width follows the aspect ratio.
                  The tap targets are children of CatalogBoard, so they share its exact
                  rendered box and stay aligned on any board aspect ratio. */}
              <div
                className="flex h-full max-w-full items-center justify-center"
                style={{ aspectRatio: `${g.width} / ${g.height}` }}
              >
                <CatalogBoard board={board} holds={draft.holds} showBeta visibleHoldSetIds={visible}>
                  {positions.map(({ col, row, x, y }) => {
                    const role = roleAt.get(`${col}-${row}`) ?? null
                    return (
                      <button
                        key={`${col}-${row}`}
                        type="button"
                        aria-label={`${columnLabel(col)}${row}, ${role ? `${holdLabel[role].toLowerCase()} hold` : 'empty'}`}
                        onClick={() => tap(col, row)}
                        className="absolute rounded-full"
                        style={{
                          left: `${x * 100}%`,
                          top: `${y * 100}%`,
                          width: `${targetPct}%`,
                          aspectRatio: '1',
                          transform: 'translate(-50%, -50%)',
                          // Transparent but hit-testable: the role marker itself is drawn
                          // by CatalogBoard underneath.
                          backgroundColor: 'transparent',
                        }}
                      />
                    )
                  })}
                </CatalogBoard>
              </div>
            </div>

            {shownError && (
              <p className="shrink-0 px-4 pt-2 text-center text-xs text-destructive" role="alert">
                {shownError}
              </p>
            )}

            <div className="shrink-0 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <p className="pb-2 text-center text-xs text-muted-foreground">
                {holdCount === 0
                  ? 'Tap holds to build your problem'
                  : `${holdCount} hold${holdCount === 1 ? '' : 's'}`}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={holdCount === 0 || busy !== null}
                  onClick={() => void lightUp()}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {busy === 'connecting' ? 'Connecting…' : busy === 'sending' ? 'Sending…' : 'Light up'}
                </Button>
                {/* Saving is wired in a later unit; the placeholder keeps the real layout. */}
                <Button className="flex-1" disabled>
                  Save
                </Button>
              </div>
              {state !== 'connected' && (
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  Light up connects to your board first.
                </p>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={confirmingDiscard} onOpenChange={(next) => !next && setConfirmingDiscard(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard this problem?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your placed holds will be lost. This can’t be undone.
          </p>
          <div className="flex flex-row gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmingDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" className="flex-1" onClick={discard}>
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
