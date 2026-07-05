import type { ConnectionState } from '../ble/moonboard'
import { Button } from '@/components/ui/button'

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
        <Button size="sm" variant="secondary" onClick={onDisconnect}>
          Disconnect
        </Button>
      ) : (
        // Web Bluetooth requires the picker to be opened from a user gesture.
        <Button size="sm" onClick={onConnect} disabled={state === 'connecting'}>
          Connect
        </Button>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  )
}
