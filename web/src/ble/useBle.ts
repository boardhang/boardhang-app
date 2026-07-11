// A single shared MoonBoard BLE connection for the whole app, exposed reactively.
// One physical board = one client, so both the authoring screen and the catalog
// detail's "Light up" drive the same connection.

import { useSyncExternalStore } from 'react'
import { MoonBoardClient, describeBleError, type ConnectionState } from './moonboard'

export interface BleState {
  state: ConnectionState
  deviceName: string | null
  error: string | null
}

const client = new MoonBoardClient()
const listeners = new Set<() => void>()
let snapshot: BleState = { state: client.state, deviceName: client.deviceName, error: null }

function emit(): void {
  for (const l of listeners) l()
}

client.onStateChange = () => {
  snapshot = { ...snapshot, state: client.state, deviceName: client.deviceName }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The shared BLE client (for send/clear). */
export const bleClient = client

/** Live connection check (a function so callers re-read across awaits). */
export function isConnected(): boolean {
  return client.state === 'connected'
}

export function setBleError(error: string | null): void {
  snapshot = { ...snapshot, error }
  emit()
}

/** Prompt for and connect to a board; records any error into the shared state. */
export async function connectBoard(): Promise<void> {
  setBleError(null)
  try {
    await client.connect()
  } catch (err) {
    // Same normalization as the send path: the iOS Bluefy shim rejects connect
    // failures with bare codes too, so String(err) would surface an unreadable "2".
    setBleError(describeBleError(err))
  }
}

export function disconnectBoard(): void {
  client.disconnect()
}

/** Reactive connection state shared across screens. */
export function useBle(): BleState {
  return useSyncExternalStore(subscribe, () => snapshot)
}
