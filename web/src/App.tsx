import { useMemo, useRef, useState } from 'react'
import './App.css'
import { MoonBoardClient } from './ble/moonboard'
import type { ConnectionState } from './ble/moonboard'
import { mini2025 } from './board/config'
import { AccountMenu } from './components/AccountMenu'
import { BoardGrid, nextType } from './components/BoardGrid'
import { ConnectBar } from './components/ConnectBar'
import type { HoldAssignment } from './types'

// MVP: single board, beta OFF (grid cycles start → move → end).
const board = mini2025
const SHOW_BETA = false

function App() {
  const clientRef = useRef<MoonBoardClient | null>(null)
  if (clientRef.current === null) clientRef.current = new MoonBoardClient()
  const client = clientRef.current

  const [state, setState] = useState<ConnectionState>('disconnected')
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [holds, setHolds] = useState<HoldAssignment[]>([])

  // Mirror client connection state into React.
  client.onStateChange = () => {
    setState(client.state)
    setDeviceName(client.deviceName)
  }

  const sendOptions = useMemo(
    () => ({ rows: board.rows, flipped: board.flipped, showBeta: SHOW_BETA }),
    [],
  )

  function toggleCell(col: number, row: number) {
    setHolds((prev) => {
      const current = prev.find((h) => h.col === col && h.row === row)
      const next = nextType(current?.type ?? null)
      const without = prev.filter((h) => !(h.col === col && h.row === row))
      return next ? [...without, { col, row, type: next }] : without
    })
  }

  async function connect() {
    setError(null)
    try {
      await client.connect()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function disconnect() {
    client.disconnect()
  }

  async function lightUp() {
    setError(null)
    try {
      await client.send(holds, sendOptions)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function clear() {
    setError(null)
    setHolds([])
    if (client.state === 'connected') {
      try {
        await client.clear()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>MoonBoard LED</h1>
        <AccountMenu />
      </header>
      <ConnectBar
        state={state}
        deviceName={deviceName}
        error={error}
        onConnect={connect}
        onDisconnect={disconnect}
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

export default App
