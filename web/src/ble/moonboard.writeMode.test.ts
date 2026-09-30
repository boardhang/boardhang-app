import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMessage, describeBleError } from './moonboard'
import { bleHarness, chunksOf, fakeStack, type WriteFn } from '../test/fakeBleStack'

// Per-link write mode: derivation from controller + properties, the one-way
// unproven flip, the legacy fallback, and chunking on both write methods
// (plan U2: R5-R9; AE2, AE4-AE6).

const { connectedClient, cleanupBleEnv } = bleHarness()

afterEach(cleanupBleEnv)

// A 45-byte message: 'l#' + 11 tokens (one 2-char, ten 3-char) + '#'. Splits into
// 20 + 20 + 5 bytes — three chunks, so ordering and the retry-per-chunk rule are
// observable. Length is asserted below.
const threeChunkHolds = [
  { col: 0, row: 1, type: 'start' as const }, // S0
  ...[1, 2, 3, 4, 5, 6].map((row) => ({ col: 2, row, type: 'right' as const })), // R24…R29
  { col: 4, row: 1, type: 'right' as const }, // R48
  { col: 4, row: 2, type: 'right' as const }, // R49
  { col: 6, row: 1, type: 'right' as const }, // R72
  { col: 8, row: 1, type: 'right' as const }, // R96
]

describe('MoonBoardClient write mode', () => {
  const opts = { rows: 12, flipped: false, showBeta: true }
  const oneHold = [{ col: 0, row: 1, type: 'start' as const }]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Reject the first `n` calls with `err`, then succeed. */
  function rejectFirst(n: number, err: unknown = new Error('GATT operation failed')): WriteFn {
    let calls = 0
    return async () => {
      calls += 1
      if (calls <= n) throw err
    }
  }

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

  it('RedBearLab with write only: three chunks with response, in order, nothing without response', async () => {
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

  it('RedBearLab with writeWithoutResponse only goes without response, known (same-mode retry)', async () => {
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

  it('RedBearLab with no properties goes with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('with-response')
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
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

  it('unproven link: a transient rejection recovers in the acknowledged mode and locks it', async () => {
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      writeWithResponse: rejectFirst(1, 2), // nameless, Bluefy-style
    })
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()

    // Locked: a later double rejection is retried with response only and never flips.
    characteristic.writeValueWithResponse.mockImplementation(rejectFirst(2))
    const second = client.send(oneHold, opts)
    second.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(second).rejects.toThrow()
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(4)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('unproven link: two acknowledged rejections flip the chunk to without response, one-way', async () => {
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      writeWithResponse: async () => {
        throw new DOMException('GATT Error: Not supported.', 'NotSupportedError')
      },
    })
    const sent = client.send(threeChunkHolds, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    // Chunk 1: with response twice (same-mode retry after the beat), then without response.
    const acked = chunksOf(characteristic.writeValueWithResponse)
    const unacked = chunksOf(characteristic.writeValueWithoutResponse)
    expect(acked).toEqual([unacked[0], unacked[0]])
    // Chunks 1–3 all landed without response, in order, message complete.
    expect(unacked.map((c) => c.length)).toEqual([20, 20, 5])
    expect(unacked.join('')).toBe(buildMessage(threeChunkHolds, opts))
    expect(client.writeMode).toBe('without-response')

    // A second message starts without response from the first chunk.
    await client.send(oneHold, opts)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(4)
  })

  it('unproven link: when the flip also fails, send rejects and the link stays unproven with response', async () => {
    const { client, characteristic } = await connectedClient(
      async () => {
        throw new Error('write not permitted')
      },
      {
        nordic: 'absent',
        redbearlab: 'present',
        properties: null,
        writeWithResponse: async () => {
          throw new Error('write rejected')
        },
      },
    )
    const sent = client.send(threeChunkHolds, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('write not permitted')
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
    expect(client.writeMode).toBe('with-response')

    // Still unproven: the next send starts with response again.
    characteristic.writeValueWithResponse.mockImplementation(async () => {})
    await client.send(oneHold, opts)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
  })

  it('locked by success: a later rejection on chunk 2 retries with response and never flips', async () => {
    let calls = 0
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      writeWithResponse: async () => {
        calls += 1
        if (calls >= 2) throw new Error('GATT operation failed')
      },
    })
    const sent = client.send(threeChunkHolds, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('GATT operation failed')
    // Chunk 1 ok, chunk 2 twice, chunk 3 never sent.
    const chunks = chunksOf(characteristic.writeValueWithResponse)
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 20])
    expect(chunks[1]).toBe(chunks[2])
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('interleaved sends on an unproven link both complete after one of them flips', async () => {
    // Two useLightUp instances (or a clear during a send) share the link. If A's
    // flip locks without-response while B's acknowledged retry is still in
    // flight, B must follow the locked mode instead of throwing.
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      writeWithResponse: async () => {
        throw new DOMException('GATT Error: Not supported.', 'NotSupportedError')
      },
    })
    const a = client.send(threeChunkHolds, opts)
    const b = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(200)
    await expect(Promise.all([a, b])).resolves.toBeDefined()
    expect(client.writeMode).toBe('without-response')
    // Every chunk of both messages landed without response.
    const unacked = chunksOf(characteristic.writeValueWithoutResponse)
    expect(unacked.filter((c) => c === buildMessage(oneHold, opts))).toHaveLength(1)
    expect(unacked.join('').includes(buildMessage(threeChunkHolds, opts).slice(0, 20))).toBe(true)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(4)
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

  it('legacy writeValue when the split methods are missing; an unproven link retries once and never loops', async () => {
    const { client, characteristic } = await connectedClient(rejectFirst(99), {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      methods: ['legacy'],
    })
    const sent = client.send(oneHold, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('GATT operation failed')
    expect(characteristic.writeValue).toHaveBeenCalledTimes(2)

    characteristic.writeValue.mockImplementation(async () => {})
    await client.send(threeChunkHolds, opts)
    expect(chunksOf(characteristic.writeValue).slice(2).map((c) => c.length)).toEqual([20, 20, 5])
  })

  it('no write method at all: send rejects with a readable message', async () => {
    const { client } = await connectedClient(undefined, { methods: [] })
    let caught: unknown
    await client.send(oneHold, opts).catch((err: unknown) => {
      caught = err
    })
    expect(caught).toBeInstanceOf(Error)
    expect(describeBleError(caught)).toMatch(/write/i)
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
      properties: null, // unproven, with response
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

    // Link drops; the reconnect resolves a *new* characteristic that is known without-response.
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

    // The old link's write now rejects, retries with response, and that retry succeeds:
    // the old record locks itself with-response — the new link must stay without-response.
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
})
