// The "light up this problem's holds over BLE" interaction, extracted from ProblemDetail
// so both the detail drawer and the catalog last-opened bar can reuse it. Connects the
// board first when disconnected, then sends the mapped hold assignments; tracks the
// connecting/sending phase and a lit flag. A send failure is surfaced here as a toast
// (both consumers are too slim for inline error text). `lit` resets whenever the target
// problem changes (resetKey) or the board disconnects.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { bleClient, connectBoard, isConnected, setBleError, useBle } from './useBle'
import { describeBleError } from './moonboard'
import { getFlipped } from '../board/boardStore'
import { reportProblemLit } from '../sessions/sessionsStore'
import type { CatalogBoardDef } from '../board/boards'
import type { CatalogHold } from '../catalog/catalogSync'
import type { HoldAssignment } from '../types'

function toHoldAssignments(holds: CatalogHold[]): HoldAssignment[] {
  return holds.map((h) => ({ col: h.c, row: h.r, type: h.t }))
}

export type LightUpBusy = 'connecting' | 'sending' | null

interface UseLightUpResult {
  /** Connect if needed, then send `holds` to the board. No-op while already busy. */
  lightUp: (holds: CatalogHold[]) => Promise<void>
  /** True once a send has completed for the current target; reset on target/disconnect. */
  lit: boolean
  busy: LightUpBusy
  /** The live BLE connection state (for label/affordance decisions). */
  state: ReturnType<typeof useBle>['state']
}

/** @param resetKey a value that changes when the target problem changes (e.g. its id). */
export function useLightUp(board: CatalogBoardDef, resetKey: string): UseLightUpResult {
  const { state } = useBle()
  const [lit, setLit] = useState(false)
  const [busy, setBusy] = useState<LightUpBusy>(null)

  // The target the hook currently points at. A send is async and the hook stays
  // mounted across target swaps (the pager, the last-opened bar), so we capture
  // this at send time and drop any result that resolves after the target changed —
  // otherwise a stale send lights the wrong problem or toasts on the wrong screen.
  const targetRef = useRef(resetKey)
  useEffect(() => {
    targetRef.current = resetKey
  }, [resetKey])

  // A newly-targeted problem isn't lit yet; disconnecting clears the lit state.
  useEffect(() => setLit(false), [resetKey])
  useEffect(() => {
    if (state !== 'connected') setLit(false)
  }, [state])

  async function lightUp(holds: CatalogHold[]) {
    if (busy) return
    setBleError(null)
    const target = resetKey
    if (!isConnected()) {
      setBusy('connecting')
      await connectBoard()
      if (!isConnected()) {
        setBusy(null)
        return // cancelled or failed
      }
    }
    setBusy('sending')
    try {
      await bleClient.send(toHoldAssignments(holds), {
        rows: board.geometry.numRows,
        flipped: getFlipped(board.layoutId),
        showBeta: true,
      })
      if (targetRef.current === target) {
        setLit(true)
        // Session "now on the wall" (#97): a CONFIRMED send records the lit problem on the
        // active session for this board (resetKey IS the catalog problem id in both
        // consumers). Fire-and-forget and fully guarded inside the store — it must never
        // block, delay, or fail the BLE path (a failed/cancelled send never reaches here).
        if (target) void reportProblemLit(board.layoutId, target)
      }
    } catch (err) {
      if (targetRef.current === target) toast.error(describeBleError(err))
    } finally {
      setBusy(null)
    }
  }

  return { lightUp, lit, busy, state }
}
