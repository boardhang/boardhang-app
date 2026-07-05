// The original author-and-light screen: tap the grid to build a problem and
// light it on a connected board. Extracted from the old App.tsx; now one screen
// in the shell, sharing the app-wide BLE connection.

import { useState } from 'react'
import { bleClient, connectBoard, disconnectBoard, setBleError, useBle } from '../ble/useBle'
import { mini2025 } from '../board/config'
import { BoardGrid, nextType } from '../components/BoardGrid'
import { ConnectBar } from '../components/ConnectBar'
import type { HoldAssignment } from '../types'

// MVP authoring: single board, beta OFF (grid cycles start → move → end).
const board = mini2025
const SHOW_BETA = false
const sendOptions = { rows: board.rows, flipped: board.flipped, showBeta: SHOW_BETA }

export function BuildScreen() {
  const { state, deviceName, error } = useBle()
  const [holds, setHolds] = useState<HoldAssignment[]>([])

  function toggleCell(col: number, row: number) {
    setHolds((prev) => {
      const current = prev.find((h) => h.col === col && h.row === row)
      const next = nextType(current?.type ?? null)
      const without = prev.filter((h) => !(h.col === col && h.row === row))
      return next ? [...without, { col, row, type: next }] : without
    })
  }

  async function lightUp() {
    setBleError(null)
    try {
      await bleClient.send(holds, sendOptions)
    } catch (err) {
      setBleError(err instanceof Error ? err.message : String(err))
    }
  }

  async function clear() {
    setBleError(null)
    setHolds([])
    if (state === 'connected') {
      try {
        await bleClient.clear()
      } catch (err) {
        setBleError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  return (
    <div className="space-y-4">
      <ConnectBar
        state={state}
        deviceName={deviceName}
        error={error}
        onConnect={connectBoard}
        onDisconnect={disconnectBoard}
      />
      <BoardGrid board={board} holds={holds} onToggle={toggleCell} />
      <div className="actions">
        <button onClick={lightUp} disabled={state !== 'connected'}>
          Light up
        </button>
        <button onClick={clear}>Clear</button>
      </div>
    </div>
  )
}
