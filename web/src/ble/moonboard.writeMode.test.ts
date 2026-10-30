import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMessage, describeBleError } from './moonboard'
import { BLE_DIAG_KEY, getBleDiagnostics } from './bleDiagnostics'
import { setLabSettings } from './labSettings'
import {
  THREE_CHUNK_HOLDS as threeChunkHolds,
  bleHarness,
  chunksOf,
  fakeStack,
  type WriteFn,
} from '../test/fakeBleStack'

// Per-link write mode with the lab on: derivation from controller + properties, the
// forced overrides, the legacy fallback, the calibration write, and chunking on every
// write method (plan R11-R13, AE6-AE9).

const { connectedClient, cleanupBleEnv } = bleHarness()

afterEach(cleanupBleEnv)

const opts = { rows: 12, flipped: false, showBeta: true }
const oneHold = [{ col: 0, row: 1, type: 'start' as const }]

/** Reject the first `n` calls with `err`, then succeed. */
function rejectFirst(n: number, err: unknown = new Error('GATT operation failed')): WriteFn {
  let calls = 0
  return async () => {
    calls += 1
    if (calls <= n) throw err
  }
}

describe('MoonBoardClient write mode (lab on, auto)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setLabSettings({ enabled: true, chooser: 'both', writeMode: 'auto' })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('the three-chunk fixture is 45 bytes', () => {
    expect(buildMessage(threeChunkHolds, opts)).toHaveLength(45)
  })

  it('Nordic with writeWithoutResponse: three chunks of 20/20/5 without response, nothing with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: false, writeWithoutResponse: true },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('without-response')
    const chunks = chunksOf(characteristic.writeValueWithoutResponse)
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5])
    expect(chunks.join('')).toBe(buildMessage(threeChunkHolds, opts))
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('Nordic with no properties (thin shim): without response, and the retry stays without response', async () => {
    const { client, characteristic } = await connectedClient(rejectFirst(1), { properties: null })
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('Nordic reporting only plain write goes with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('with-response')
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('Nordic reporting both write types stays without response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: true, writeWithoutResponse: true },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('without-response')
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('Nordic reporting neither write type (nonsense properties) stays without response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: false, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('without-response')
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('RedBearLab with write only: three chunks with response, in order, nothing without response', async () => {
    // Covers AE6.
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('with-response')
    const chunks = chunksOf(characteristic.writeValueWithResponse)
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5])
    expect(chunks.join('')).toBe(buildMessage(threeChunkHolds, opts))
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
    expect(getBleDiagnostics().link?.writeMode).toBe('with-response')
  })

  it('RedBearLab with both write flags goes with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: true },
    })
    await client.send(threeChunkHolds, opts)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('RedBearLab with writeWithoutResponse only goes without response (same-mode retry)', async () => {
    const { client, characteristic } = await connectedClient(rejectFirst(2), {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: false, writeWithoutResponse: true },
    })
    expect(client.writeMode).toBe('without-response')
    const sent = client.send(oneHold, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('GATT operation failed')
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('RedBearLab with no properties goes with response, and a double rejection just propagates', async () => {
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      writeWithResponse: rejectFirst(2, 2), // nameless, Bluefy-style
    })
    expect(client.writeMode).toBe('with-response')
    const sent = client.send(oneHold, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toBe(2)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
    expect(client.writeMode).toBe('with-response')
  })

  it('RedBearLab with properties that report neither flag goes with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: false, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('known RedBearLab link: a transient rejection is retried with response, mode unchanged', async () => {
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
      writeWithResponse: rejectFirst(1, new Error('GATT busy')),
    })
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
    expect(client.writeMode).toBe('with-response')
  })

  it('legacy writeValue when the split methods are missing, with the single retry', async () => {
    const { client, characteristic } = await connectedClient(rejectFirst(99), {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      methods: ['legacy'],
    })
    expect(getBleDiagnostics().link?.writer).toBe('legacy')
    const sent = client.send(oneHold, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('GATT operation failed')
    expect(characteristic.writeValue).toHaveBeenCalledTimes(2)

    characteristic.writeValue.mockImplementation(async () => {})
    await client.send(threeChunkHolds, opts)
    expect(chunksOf(characteristic.writeValue).slice(2).map((c) => c.length)).toEqual([20, 20, 5])
  })

  it('no write method at all: send rejects with a readable message and nothing is written', async () => {
    const { client } = await connectedClient(undefined, { methods: [] })
    let caught: unknown
    await client.send(oneHold, opts).catch((err: unknown) => {
      caught = err
    })
    expect(caught).toBeInstanceOf(Error)
    expect(describeBleError(caught)).toMatch(/exposes no writeValueWithoutResponse method/)
    expect(describeBleError(caught)).not.toContain("Couldn't reach the board")
  })

  it('clear() on a RedBearLab box writes the single 3-byte l## chunk with the link mode', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.clear()
    expect(chunksOf(characteristic.writeValueWithResponse)).toEqual(['l##'])
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('lightLed(n) writes the single-LED calibration message in the link mode', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: false, writeWithoutResponse: true },
    })
    await client.lightLed(0)
    await client.lightLed(131)
    expect(chunksOf(characteristic.writeValueWithoutResponse)).toEqual(['l#P0#', 'l#P131#'])
  })

  it('a stale link settling after a reconnect cannot touch the new link', async () => {
    let settleFirst!: (err: unknown) => void
    let calls = 0
    const {
      client,
      device,
      gatt,
      characteristic: oldChar,
    } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null, // with response
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
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(0) // first acknowledged write pending

    const fresh = fakeStack(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: false, writeWithoutResponse: true },
    })
    gatt.connect.mockImplementation(async () => {
      gatt.connected = true
      return fresh.server
    })
    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(client.writeMode).toBe('without-response')

    // The old link's write rejects and retries on its own characteristic; the new link is untouched.
    settleFirst(new Error('GATT operation failed'))
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(oldChar.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(client.writeMode).toBe('without-response')
    await client.send(oneHold, opts)
    expect(fresh.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
    expect(fresh.characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('mode is re-derived from the new characteristic after a reconnect', async () => {
    const { client, device, gatt } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
    })
    expect(client.writeMode).toBe('with-response')

    const fresh = fakeStack(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: false, writeWithoutResponse: true },
    })
    gatt.connect.mockImplementation(async () => {
      gatt.connected = true
      return fresh.server
    })
    device.dropConnection()
    expect(client.writeMode).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(client.writeMode).toBe('without-response')
    await client.send(oneHold, opts)
    expect(fresh.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
  })

  it('records each send with its size, chunk count, mode, and writer, and a retry', async () => {
    const { client } = await connectedClient(rejectFirst(1), {
      properties: { write: false, writeWithoutResponse: true },
    })
    const sent = client.send(threeChunkHolds, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    const events = getBleDiagnostics().events.map((e) => `${e.kind} ${e.detail ?? ''}`)
    expect(
      events.some(
        (e) =>
          e.startsWith('send ') &&
          e.includes('bytes=45') &&
          e.includes('chunks=3') &&
          e.includes('mode=without-response') &&
          e.includes('writer=split'),
      ),
    ).toBe(true)
    expect(events.some((e) => e.startsWith('chunk-retry'))).toBe(true)
    expect(events.some((e) => e.startsWith('send-ok'))).toBe(true)
  })

  it('still completes a send with the same write calls when the diagnostics mirror throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === BLE_DIAG_KEY) throw new Error('quota')
    })
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: false, writeWithoutResponse: true },
    })
    await client.send(threeChunkHolds, opts)
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(3)
  })
})

describe('MoonBoardClient forced write modes (lab on)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('forced with-response on a Nordic board: three chunks with response; a second rejection propagates', async () => {
    // Covers AE8.
    setLabSettings({ enabled: true, writeMode: 'with-response' })
    const { client, characteristic } = await connectedClient(async () => {}, {
      properties: { write: false, writeWithoutResponse: true },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('with-response')
    expect(chunksOf(characteristic.writeValueWithResponse).map((c) => c.length)).toEqual([20, 20, 5])
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
    expect(getBleDiagnostics().link?.forced).toBe(true)

    characteristic.writeValueWithResponse.mockImplementation(rejectFirst(2, new Error('write not permitted')))
    const sent = client.send(oneHold, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('write not permitted')
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(5)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
    expect(client.writeMode).toBe('with-response')
  })

  it('forced without-response on a RedBearLab box that reports plain write only', async () => {
    setLabSettings({ enabled: true, writeMode: 'without-response' })
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('without-response')
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('forced with-response with only writeValueWithoutResponse and no legacy method rejects readably without writing', async () => {
    // Covers AE9.
    setLabSettings({ enabled: true, writeMode: 'with-response' })
    const { client, characteristic } = await connectedClient(undefined, { methods: ['without'] })
    let caught: unknown
    await client.send(oneHold, opts).catch((err: unknown) => {
      caught = err
    })
    expect(describeBleError(caught)).toMatch(/writeValueWithResponse/)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('forced with-response falls back to legacy writeValue and records the writer as legacy', async () => {
    setLabSettings({ enabled: true, writeMode: 'with-response' })
    const { client, characteristic } = await connectedClient(undefined, { methods: ['without', 'legacy'] })
    await client.send(threeChunkHolds, opts)
    expect(chunksOf(characteristic.writeValue).map((c) => c.length)).toEqual([20, 20, 5])
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
    expect(getBleDiagnostics().link?.writer).toBe('legacy')
    const send = getBleDiagnostics().events.find((e) => e.kind === 'send')
    expect(send?.detail).toContain('writer=legacy')
  })
})

describe('MoonBoardClient link with the lab off', () => {
  it('is a direct without-response link even when properties say plain write only, with not-read markers', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: true, writeWithoutResponse: false },
    })
    expect(client.writeMode).toBe('without-response')
    expect(client.controller).toBe('nordic-uart')
    await client.send(oneHold, opts)
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
    const link = getBleDiagnostics().link
    expect(link?.writer).toBe('direct')
    expect(link?.properties).toBe('not read')
    expect(link?.writers).toBe('not probed')
  })
})
