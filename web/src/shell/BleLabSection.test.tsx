import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { BleLabSection } from './BleLabSection'
import { disconnectBoard } from '../ble/useBle'
import { getLabSettings, setLabSettings } from '../ble/labSettings'
import { getBleDiagnostics, recordBleEvent } from '../ble/bleDiagnostics'
import { NUS_SERVICE } from '../ble/moonboard'
import { chunksOf, fakeStack, resetLabStores } from '../test/fakeBleStack'

// The admin's BLE lab card (plan R22, R23, AE10, AE12). Drives the real stores and the
// module-level bleClient singleton against the fake Web Bluetooth stack, so every test
// disconnects the client afterwards.

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  act(() => resetLabStores())
})

afterEach(() => {
  // The card may still be mounted here (this hook runs before the global cleanup), so
  // the store resets go through act.
  act(() => {
    disconnectBoard()
    resetLabStores()
  })
  delete (navigator as unknown as { bluetooth?: unknown }).bluetooth
  vi.restoreAllMocks()
})

/** Let the client's promise chain (requestDevice → gatt → lookups) settle inside act. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
    await settle()
  })
}

async function connectViaCard() {
  await click('Connect')
  await screen.findByText(/Connected to MB/)
}

describe('BleLabSection settings', () => {
  it('toggles the lab switch and enables the groups only while on', () => {
    render(<BleLabSection />)
    const toggle = screen.getByRole('switch', { name: /experimental Bluetooth path/i })
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Any device' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Acknowledged' })).toBeDisabled()

    fireEvent.click(toggle)
    expect(getLabSettings().enabled).toBe(true)
    expect(screen.getByRole('switch', { name: /experimental Bluetooth path/i })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Any device' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Acknowledged' })).toBeEnabled()
  })

  it('writes the picker and write-mode choices to the store', () => {
    setLabSettings({ enabled: true })
    render(<BleLabSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Any device' }))
    expect(getLabSettings().chooser).toBe('any')
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledged' }))
    expect(getLabSettings().writeMode).toBe('with-response')
  })

  it('names both groups and explains the options', () => {
    render(<BleLabSection />)
    expect(screen.getByRole('group', { name: 'Device picker' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Write mode' })).toBeInTheDocument()
    expect(screen.getByText(/Acknowledged = write with response/)).toBeInTheDocument()
    expect(screen.getByText(/nRF Connect capture/)).toBeInTheDocument()
    expect(screen.getByText(/Changing a setting disconnects the board/)).toBeInTheDocument()
  })

  it('disconnects the board before a setting changes (AE10)', async () => {
    setLabSettings({ enabled: true })
    const stack = fakeStack()
    render(<BleLabSection />)
    await connectViaCard()

    let modeAtDisconnect: string | null = null
    stack.gatt.disconnect.mockImplementation(() => {
      modeAtDisconnect = getLabSettings().writeMode
      stack.gatt.connected = false
    })
    await click('Acknowledged')
    expect(modeAtDisconnect).toBe('auto')
    expect(getLabSettings().writeMode).toBe('with-response')
    expect(await screen.findByText('Disconnected')).toBeInTheDocument()
  })
})

describe('BleLabSection status and quick actions', () => {
  it('shows Disconnected with no link, then the link after a connect, then the last action', async () => {
    setLabSettings({ enabled: true })
    const stack = fakeStack(undefined, { properties: { write: false, writeWithoutResponse: true } })
    render(<BleLabSection />)
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
    expect(screen.getByText('No link.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Light LED 0' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear LEDs' })).toBeDisabled()

    await connectViaCard()
    expect(screen.getByText('nordic-uart')).toBeInTheDocument()
    expect(screen.getByText('without-response')).toBeInTheDocument()
    // Also appears in the log, so count rather than require a single match.
    expect(screen.getAllByText(/write=false writeWithoutResponse=true/).length).toBeGreaterThan(0)

    await click('Light LED 0')
    await waitFor(() =>
      expect(screen.getByText('Light LED 0 sent, 1 chunk, without-response')).toBeInTheDocument(),
    )
    expect(chunksOf(stack.characteristic.writeValueWithoutResponse)).toEqual(['l#P0#'])

    await click('Clear LEDs')
    await waitFor(() =>
      expect(chunksOf(stack.characteristic.writeValueWithoutResponse)).toEqual(['l#P0#', 'l##']),
    )

    await click('Disconnect')
    expect(await screen.findByText('Disconnected')).toBeInTheDocument()
  })

  it('toasts a connect failure with the raw value', async () => {
    setLabSettings({ enabled: true })
    const stack = fakeStack()
    stack.requestDevice.mockRejectedValueOnce(2)
    render(<BleLabSection />)
    await click('Connect')
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Couldn't reach the board.*\[2\]$/)),
    )
  })

  it('toasts a failed quick action and records it as the last action', async () => {
    setLabSettings({ enabled: true })
    fakeStack(async () => {
      throw new Error('write not permitted')
    })
    render(<BleLabSection />)
    await connectViaCard()
    await click('Light LED 0')
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('write not permitted'))
    expect(screen.getByText(/Light LED 0 failed: write not permitted/)).toBeInTheDocument()
  })

  it("connects through today's path when the lab is off", async () => {
    const stack = fakeStack(undefined, { minimal: true })
    render(<BleLabSection />)
    await connectViaCard()
    expect(stack.requestDevice.mock.calls[0]![0]).toEqual({ filters: [{ services: [NUS_SERVICE] }] })
    expect(stack.reads.properties).toBe(0)
    expect(screen.getByText('not read')).toBeInTheDocument()
  })
})

describe('BleLabSection log', () => {
  it('shows the newest event first and an empty state when there is nothing', () => {
    const { unmount } = render(<BleLabSection />)
    expect(screen.getByText('No events yet. Connect to record one.')).toBeInTheDocument()
    unmount()

    act(() => {
      recordBleEvent('first', 'one')
      recordBleEvent('second', 'two')
    })
    render(<BleLabSection />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('second two')
    expect(items[1]).toHaveTextContent('first one')
  })

  it('copies the diagnostics text and toasts success (AE12)', async () => {
    stubClipboard(async () => {})
    act(() => {
      recordBleEvent('a')
      recordBleEvent('b')
      recordBleEvent('c')
    })
    render(<BleLabSection />)
    await click('Copy diagnostics')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Diagnostics copied'))
    const text = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0] as string
    expect(text).toContain('Boardhang BLE diagnostics')
    expect(text).toContain('Lab: enabled=false')
    // Chronological: the 'a' event line comes before the 'c' event line.
    expect(text.search(/ a$/m)).toBeGreaterThan(-1)
    expect(text.search(/ a$/m)).toBeLessThan(text.search(/ c$/m))
  })

  it('falls back to the text view when the clipboard write fails', async () => {
    stubClipboard(async () => {
      throw new Error('denied')
    })
    act(() => recordBleEvent('a'))
    render(<BleLabSection />)
    const show = screen.getByRole('button', { name: 'Show as text' })
    expect(show).toHaveAttribute('aria-expanded', 'false')
    await click('Copy diagnostics')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const area = screen.getByRole('textbox', { name: 'Diagnostics as text' }) as HTMLTextAreaElement
    expect(area.value).toContain('Boardhang BLE diagnostics')
    expect(screen.getByRole('button', { name: 'Hide text' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('asks before clearing the log, and clears on confirm', async () => {
    act(() => recordBleEvent('keep-me'))
    render(<BleLabSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear log' }))
    expect(await screen.findByRole('heading', { name: 'Clear the Bluetooth log?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(getBleDiagnostics().events).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Clear log' }))
    await screen.findByRole('heading', { name: 'Clear the Bluetooth log?' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(getBleDiagnostics().events).toHaveLength(0))
    expect(await screen.findByText('No events yet. Connect to record one.')).toBeInTheDocument()
  })
})
