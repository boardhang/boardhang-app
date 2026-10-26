import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMessage, NUS_SERVICE, RX_CHAR } from './moonboard'
import { BLE_DIAG_KEY } from './bleDiagnostics'
import { getLabSettings } from './labSettings'
import { bleHarness, chunksOf, fakeStack } from '../test/fakeBleStack'

// Default-path invariance (plan R7, R8, AE1): with the BLE lab off, the client must
// make exactly the Bluetooth calls it made before the lab existed — the same chooser
// request, the same two lookups, no property or id reads, write-without-response only,
// and no storage writes. These tests are the guard that keeps the experiment from
// leaking into what real users run.

const { newClient, connectedClient, cleanupBleEnv } = bleHarness()

afterEach(cleanupBleEnv)

const opts = { rows: 12, flipped: false, showBeta: true }
// 'l#' + 11 tokens + '#' = 45 bytes → 20 + 20 + 5.
const threeChunkHolds = [
  { col: 0, row: 1, type: 'start' as const },
  ...[1, 2, 3, 4, 5, 6].map((row) => ({ col: 2, row, type: 'right' as const })),
  { col: 4, row: 1, type: 'right' as const },
  { col: 4, row: 2, type: 'right' as const },
  { col: 6, row: 1, type: 'right' as const },
  { col: 8, row: 1, type: 'right' as const },
]

describe('MoonBoardClient with the lab off (today\'s path)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getLabSettings().enabled).toBe(false)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests the chooser with exactly the Nordic UART service filter and nothing else', async () => {
    const { requestDevice } = await connectedClient(undefined, { minimal: true })
    expect(requestDevice).toHaveBeenCalledTimes(1)
    const options = requestDevice.mock.calls[0]![0] as Record<string, unknown>
    expect(options).toEqual({ filters: [{ services: [NUS_SERVICE] }] })
    expect(Object.keys(options)).toEqual(['filters'])
  })

  it('looks up only the Nordic UART service and RX characteristic', async () => {
    const { server } = await connectedClient(undefined, { minimal: true })
    expect(server.getPrimaryService).toHaveBeenCalledTimes(1)
    expect(server.getPrimaryService).toHaveBeenCalledWith(NUS_SERVICE)
    const nordicService = await server.getPrimaryService.mock.results[0]!.value
    expect(nordicService.getCharacteristic).toHaveBeenCalledTimes(1)
    expect(nordicService.getCharacteristic).toHaveBeenCalledWith(RX_CHAR)
  })

  it('never reads the characteristic properties or the device id', async () => {
    const { client, reads } = await connectedClient(undefined, { minimal: true })
    await client.send(threeChunkHolds, opts)
    expect(reads.properties).toBe(0)
    expect(reads.id).toBe(0)
  })

  it('writes three 20/20/5-byte chunks without response, in order', async () => {
    const { client, characteristic } = await connectedClient(undefined, { minimal: true })
    await client.send(threeChunkHolds, opts)
    const chunks = chunksOf(characteristic.writeValueWithoutResponse)
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5])
    expect(chunks.join('')).toBe(buildMessage(threeChunkHolds, opts))
  })

  it('retries a transient rejection exactly once, in the same mode', async () => {
    let calls = 0
    const { client, characteristic } = await connectedClient(
      async () => {
        calls += 1
        if (calls === 1) throw new Error('GATT busy')
      },
      { minimal: true },
    )
    const sent = client.send([{ col: 0, row: 1, type: 'start' }], opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(2)
  })

  it('never calls writeValueWithResponse or writeValue even when the characteristic has them', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      methods: ['with', 'without', 'legacy'],
      properties: { write: true, writeWithoutResponse: false }, // would mean "ack only" on the lab path
    })
    await client.send(threeChunkHolds, opts)
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
    expect(characteristic.writeValue).not.toHaveBeenCalled()
  })

  it('fails the same way as before when the shim lacks writeValueWithoutResponse', async () => {
    const { client } = await connectedClient(undefined, { methods: [] })
    const sent = client.send([{ col: 0, row: 1, type: 'start' }], opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow()
  })

  it('writes nothing to localStorage from the Bluetooth path', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { client, device } = await connectedClient(undefined, { minimal: true })
    await client.send(threeChunkHolds, opts)
    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500)
    client.disconnect()
    expect(setItem).not.toHaveBeenCalledWith(BLE_DIAG_KEY, expect.anything())
  })

  it('a chooser rejection still surfaces as the rejection itself and leaves the client disconnected', async () => {
    const stack = fakeStack(undefined, { minimal: true })
    stack.requestDevice.mockRejectedValueOnce(
      new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError'),
    )
    const client = newClient()
    await expect(client.connect()).rejects.toThrow(/cancelled/)
    expect(client.state).toBe('disconnected')
  })
})
