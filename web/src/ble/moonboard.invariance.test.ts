import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMessage, describeBleError, NUS_SERVICE, RX_CHAR } from './moonboard'
import { getLabSettings, setLabSettings } from './labSettings'
import { getBleDiagnostics } from './bleDiagnostics'
import {
  THREE_CHUNK_HOLDS as threeChunkHolds,
  bleHarness,
  chunksOf,
  fakeStack,
  type StackOptions,
} from '../test/fakeBleStack'

// Default-path pins (docs/plans/2026-10-30-001-feat-web-ble-ack-writes-plan.md, R2 to R5
// and R7; AE1 to AE7). With the BLE lab off — every user — the client makes exactly these
// Bluetooth calls: the Nordic-only chooser request, the two Nordic lookups, no device id
// read, one properties read per connect, the write type derived from those properties
// (acknowledged only when the box reports plain write and not write-without-response),
// 20-byte chunks with one same-mode retry, and no storage writes. A stored lab override
// is never honoured here. Change a pin only through a plan that names it.

const { newClient, connectedClient, cleanupBleEnv } = bleHarness()

afterEach(cleanupBleEnv)

const opts = { rows: 12, flipped: false, showBeta: true }
const oneHold = [{ col: 0, row: 1, type: 'start' as const }]

/** Call count of a write mock the fake may not expose at all (a thin shim). */
function callCount(fn: { mock: { calls: unknown[][] } } | undefined): number {
  return fn?.mock.calls.length ?? 0
}

function eventLines(): string[] {
  return getBleDiagnostics().events.map((e) => `${e.kind}${e.detail !== undefined ? ' ' + e.detail : ''}`)
}

describe('MoonBoardClient with the lab off (the default path)', () => {
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

  it('reads the characteristic properties exactly once per connect and never the device id', async () => {
    const { client, device, reads } = await connectedClient(undefined, {
      properties: { write: false, writeWithoutResponse: true },
    })
    await client.send(threeChunkHolds, opts)
    expect(reads.properties).toBe(1)
    expect(reads.id).toBe(0)

    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(reads.properties).toBe(2)
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
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(2)
  })

  it('writes with response when the characteristic reports plain write only', async () => {
    // Covers AE1. The gym's official Nordic UART box: write=true, writeWithoutResponse=false.
    const { client, characteristic } = await connectedClient(undefined, {
      methods: ['with', 'without', 'legacy'],
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('with-response')
    const chunks = chunksOf(characteristic.writeValueWithResponse)
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5])
    expect(chunks.join('')).toBe(buildMessage(threeChunkHolds, opts))
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
    expect(characteristic.writeValue).not.toHaveBeenCalled()
    const link = eventLines().find((e) => e.startsWith('link '))
    expect(link).toBe('link controller=nordic-uart mode=with-response forced=false writer=split')
  })

  for (const [label, stack, absent] of [
    ['writeWithoutResponse only', { properties: { write: false, writeWithoutResponse: true } }, false],
    ['both write flags', { properties: { write: true, writeWithoutResponse: true } }, false],
    ['neither write flag', { properties: { write: false, writeWithoutResponse: false } }, false],
    ['no properties and only writeValueWithoutResponse (thin shim)', { minimal: true }, true],
    ['a properties getter that throws', { properties: 'throws' }, true],
  ] as const satisfies ReadonlyArray<readonly [string, StackOptions, boolean]>) {
    it(`writes without response when the characteristic reports ${label}`, async () => {
      // Covers AE2, AE3. Every other combination keeps the DIY boards' unacknowledged mode.
      const { client, characteristic, reads } = await connectedClient(undefined, {
        methods: ['with', 'without', 'legacy'],
        ...stack,
      })
      await client.send(threeChunkHolds, opts)
      expect(client.writeMode).toBe('without-response')
      expect(chunksOf(characteristic.writeValueWithoutResponse).map((c) => c.length)).toEqual([20, 20, 5])
      const c = characteristic as Partial<typeof characteristic>
      expect(callCount(c.writeValueWithResponse)).toBe(0)
      expect(callCount(c.writeValue)).toBe(0)
      expect(reads.properties).toBe(1)
      const properties = eventLines().find((e) => e.startsWith('properties '))
      if (absent) expect(properties).toBe('properties absent')
      else expect(properties).toMatch(/^properties write=(true|false) writeWithoutResponse=(true|false)/)
    })
  }

  it('with no write method the link commits and a send rejects readably at once, without naming the lab', async () => {
    const { client, characteristic } = await connectedClient(undefined, { methods: [] })
    expect(client.state).toBe('connected')
    // No timer advance: a rejection that waited for the retry beat would never settle here.
    let caught: unknown
    await client.send(oneHold, opts).catch((err: unknown) => {
      caught = err
    })
    expect(caught).toBeInstanceOf(Error)
    const message = describeBleError(caught)
    expect(message).toMatch(/exposes no writeValueWithoutResponse method/)
    expect(message).not.toMatch(/BLE lab/i)
    expect(message).not.toMatch(/lab/i)
    expect(vi.getTimerCount()).toBe(0)
    const c = characteristic as Partial<typeof characteristic>
    expect(callCount(c.writeValueWithoutResponse)).toBe(0)
    expect(callCount(c.writeValueWithResponse)).toBe(0)
    expect(callCount(c.writeValue)).toBe(0)
    expect(eventLines().some((e) => e.startsWith('chunk-retry'))).toBe(false)
  })

  it('with only legacy writeValue the chunks go through it and the link records writer=legacy', async () => {
    const { client, characteristic } = await connectedClient(undefined, { methods: ['legacy'] })
    await client.send(threeChunkHolds, opts)
    expect(chunksOf(characteristic.writeValue).map((c) => c.length)).toEqual([20, 20, 5])
    const link = eventLines().find((e) => e.startsWith('link '))
    expect(link).toContain('writer=legacy')
    expect(getBleDiagnostics().link?.writer).toBe('legacy')
  })

  it('ignores a stored with-response override: a write-without-response box still goes without response', async () => {
    // Covers AE4. A device whose admin last forced Acknowledged keeps that in storage after
    // the lab is switched off; the default path must not pick it up.
    setLabSettings({ enabled: false, writeMode: 'with-response' })
    expect(getLabSettings().writeMode).toBe('with-response')
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: false, writeWithoutResponse: true },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('without-response')
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
    expect(getBleDiagnostics().link?.forced).toBe(false)
    const link = eventLines().find((e) => e.startsWith('link '))
    expect(link).toContain('mode=without-response forced=false')
  })

  it('ignores a stored without-response override: a plain-write-only box still goes with response', async () => {
    // Covers AE4.
    setLabSettings({ enabled: false, writeMode: 'without-response' })
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('with-response')
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
    expect(getBleDiagnostics().link?.forced).toBe(false)
  })

  it('records connect, device, gatt-connected, properties, writers, link, send, send-ok — and no probe', async () => {
    // Covers AE6. The lab-off log shape; the default path does not probe.
    expect(getBleDiagnostics().events).toEqual([])
    const { client } = await connectedClient(undefined, {
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.send(oneHold, opts)
    const events = getBleDiagnostics().events
    expect(events.map((e) => e.kind)).toEqual([
      'connect',
      'device',
      'gatt-connected',
      'properties',
      'writers',
      'link',
      'send',
      'send-ok',
    ])
    expect(events[0]!.detail).toBe('lab=off')
    expect(events.some((e) => e.kind === 'probe')).toBe(false)
  })

  it('re-derives the mode from the new characteristic on reconnect; a pending write stays on the old one', async () => {
    // Covers AE7.
    let settleFirst!: (err: unknown) => void
    let calls = 0
    const {
      client,
      device,
      gatt,
      characteristic: oldChar,
    } = await connectedClient(async () => {}, {
      properties: { write: true, writeWithoutResponse: false },
      writeWithResponse: () => {
        calls += 1
        if (calls === 1) {
          return new Promise<void>((_resolve, reject) => {
            settleFirst = reject
          })
        }
        return Promise.resolve()
      },
    })
    expect(client.writeMode).toBe('with-response')
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(0) // first acknowledged write pending

    const fresh = fakeStack(undefined, { properties: { write: false, writeWithoutResponse: true } })
    gatt.connect.mockImplementation(async () => {
      gatt.connected = true
      return fresh.server
    })
    device.dropConnection()
    expect(client.writeMode).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(client.writeMode).toBe('without-response')

    // The old link's write rejects and retries on its own characteristic; the new link is untouched.
    settleFirst(new Error('GATT operation failed'))
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(oldChar.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(fresh.characteristic.writeValueWithResponse).not.toHaveBeenCalled()
    expect(client.writeMode).toBe('without-response')
    await client.send(oneHold, opts)
    expect(fresh.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
    expect(fresh.characteristic.writeValueWithResponse).not.toHaveBeenCalled()
    const links = eventLines().filter((e) => e.startsWith('link '))
    expect(links.map((l) => /mode=([a-z-]+)/.exec(l)?.[1])).toEqual(['with-response', 'without-response'])
  })

  it('writes nothing to localStorage from the Bluetooth path', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    const { client, device } = await connectedClient(undefined, { minimal: true })
    await client.send(threeChunkHolds, opts)
    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500)
    client.disconnect()
    // Any key, not just the diagnostics one (R5).
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
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
