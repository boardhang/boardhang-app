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

/** Why a connect attempt failed: the readable text, plus the raw rejection for the lab. */
export interface ConnectFailure {
  message: string
  /** The Error's own message, or `String(err)` for a non-Error rejection (e.g. Bluefy's bare `2`). */
  raw: string
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

function rawRejection(err: unknown): string {
  // Error-like (Error, DOMException — which does not extend Error in every runtime):
  // its own message is the raw value. Anything else (Bluefy's bare `2`) stringifies.
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  try {
    return String(err)
  } catch {
    return '?'
  }
}

/**
 * Prompt for and connect to a board; records any error into the shared state and
 * resolves to it (null on success) so a caller can decide whether to surface it.
 */
export async function connectBoard(): Promise<ConnectFailure | null> {
  setBleError(null)
  try {
    await client.connect()
    return null
  } catch (err) {
    // Same normalization as the send path: the iOS Bluefy shim rejects connect
    // failures with bare codes too, so String(err) would surface an unreadable "2".
    const message = describeBleError(err)
    setBleError(message)
    return { message, raw: rawRejection(err) }
  }
}

export function disconnectBoard(): void {
  client.disconnect()
}

/** Reactive connection state shared across screens. */
export function useBle(): BleState {
  return useSyncExternalStore(subscribe, () => snapshot)
}
