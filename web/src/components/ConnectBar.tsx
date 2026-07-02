import type { ConnectionState } from '../ble/moonboard'

interface ConnectBarProps {
  state: ConnectionState
  deviceName: string | null
  error: string | null
  onConnect: () => void
  onDisconnect: () => void
}

const stateLabel: Record<ConnectionState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
}

export function ConnectBar({
  state,
  deviceName,
  error,
  onConnect,
  onDisconnect,
}: ConnectBarProps) {
  const connected = state === 'connected'
  const status = connected && deviceName ? `Connected · ${deviceName}` : stateLabel[state]

  return (
    <div className="connect-bar">
      <span className={`status status-${state}`}>{status}</span>
      {connected ? (
        <button onClick={onDisconnect}>Disconnect</button>
      ) : (
        // Web Bluetooth requires the picker to be opened from a user gesture.
        <button onClick={onConnect} disabled={state === 'connecting'}>
          Connect
        </button>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  )
}
