# BLE / Hardware Subsystem

How the app talks to the DIY MoonBoard LED hardware over Bluetooth. Read
[`../CONTEXT.md`](../CONTEXT.md) §"The BLE protocol" and §"The 20-byte bug" first — this doc
covers the *implementation* details and invariants that CONTEXT.md doesn't.

**Key files:** `MoonBoardLED/BLE/MoonBoardBLEManager.swift` (the whole link),
`MoonBoardLED/Views/ConnectionView.swift` (scan/connect sheet),
`MoonBoardLED/Views/LEDTestView.swift` (calibration), `MoonBoardLED/Board/BoardGeometry.swift`
(hold↔LED mapping — see also [board-geometry.md](board-geometry.md)).

## The manager

`MoonBoardBLEManager` is a single `@MainActor` `ObservableObject` created once in
`MoonBoardApp` as a `@StateObject` and injected via `.environmentObject`. It owns the whole
CoreBluetooth lifecycle and implements both `CBCentralManagerDelegate` and `CBPeripheralDelegate`.

### Connection state machine

`@Published var state: ConnectionState` with cases:
`poweredOff | unauthorized | disconnected | scanning | connecting | connected`.
Other published state: `discovered` (found devices), `connectedName`.

Transport uses the **Nordic UART Service**; the app writes to the RX characteristic
(`writeChar`) with **write-without-response** only. The board advertises as `"MoonBoard A"`
(name is user-configurable on the hardware).

### Invariants you must not break

1. **`userInitiatedDisconnect` suppresses auto-reconnect.**
   - Set `true` in `disconnect()`, reset to `false` only in `connect()`.
   - `attemptAutoReconnect()` (called from `centralManagerDidUpdateState` on power-on, and on
     unexpected disconnect) is a no-op while this flag is `true`.
   - Effect: after the user explicitly disconnects, toggling Bluetooth off/on will **not**
     reconnect. Only an explicit `connect()` re-enables it. If you add any new disconnect path,
     remember it will stay disconnected until an explicit connect.

2. **Scan-while-connected does not change `state`.**
   - `startScan()` does *not* flip to `.scanning` if already `.connected`; `stopScan()` restores
     the prior state. This lets `ConnectionView` re-scan for other boards without the UI losing
     the "connected" status. Preserve this or the connection indicator will flicker/lie.

3. **The 20-byte chunking is mandatory.**
   - The firmware's RX characteristic buffers only **20 bytes** and *silently truncates* the
     rest (no error). This is the root cause of the "only ~4 LEDs light" bug.
   - `write()` splits the message into ≤20-byte chunks (`maxChunkLength = 20`) and drains them
     with flow control.
   - **Do NOT** size chunks from `peripheral.maximumWriteValueLength` — modern iPhones negotiate
     a large MTU (180+), which overflows the firmware buffer. The constant 20 is the safe value.
   - Flow control: check `peripheral.canSendWriteWithoutResponse`, and drain the queue from the
     `peripheralIsReady(toSendWriteWithoutResponse:)` callback. The first write is "primed"
     (sent even if `canSendWriteWithoutResponse` is momentarily false) to kick the callback.

4. **Message replacement, not queuing.**
   - Each `write()` **replaces** the entire `writeQueue` with the new message's chunks. Because
     every message is complete and self-contained (`l#…#`), only the latest board state matters;
     discarding half-sent prior chunks is intentional. Don't "fix" this into an append queue.

5. **Pending message before the characteristic is ready.**
   - If a send happens before `writeChar` is discovered (e.g. user taps "Light up" mid-connect),
     the message is stashed in `pendingMessage` and flushed once `didDiscoverCharacteristics`
     fires. A newer send replaces the pending one.

## Sending: the three paths

The wire format is exactly `l#<token>,<token>,…#`, tokens are `<TypeLetter><ledIndex>`
(e.g. `S0,R14`); empty/clear is `l##`. No spaces, no other delimiters — the firmware won't parse
anything else.

- `send(holds:rows:flipped:showBeta:)` — immediate; cancels any pending debounce.
- `sendDebounced(…)` — **90 ms** debounce (`0.09s`) for live preview while editing; each call
  cancels and reschedules the work item, so only the final state is sent under rapid edits.
- `lightSingleLED(index:)` — lights one LED for calibration.
- `clear()` — sends `l##` to turn everything off.

`HoldType.displayed(showBeta:)` collapses `left/right/match → right` when "beta" is off. This is
**display-only** — the message always sends the *actual* type letter (S/L/R/M/E). If you touch
message building, build from the real type, not the displayed one.

## Calibration (`LEDTestView`)

- Steps through LEDs one at a time; shows the *expected* hold position via the reverse map
  `MoonBoardGeometry`/`BoardGeometry.position(forLED:rows:flipped:)`.
- Lights on **every** stepper/flip change immediately (not debounced) so calibration feels snappy.
- The **flip** toggle is per-board and persists **immediately** to `@AppStorage(board.flippedKey)`
  (e.g. `"flipped_7"`), not on dismiss. New boards default to `false`.
- Clears all LEDs (`ble.clear()`) on dismiss.
- `ConnectionView` only surfaces the LED-test entry point when `.connected`; it starts scanning
  in `onAppear` and stops in `onDisappear`.

## Gotchas summary

- 20-byte chunks + flow control are load-bearing; never size from MTU. (bug's root cause)
- `flipped` reverses the *entire* LED strip (`total - 1 - led`) — see [board-geometry.md](board-geometry.md).
- Message format must be byte-exact `l#…#`.
- Auto-reconnect stays off after a user disconnect until the next explicit `connect()`.
- BLE does **not** work in the iOS Simulator — only on a real device.
- Manager is `@MainActor`; CoreBluetooth callbacks already run on the main queue. Moving to
  Swift 6 language mode will surface concurrency warnings here that are benign under Swift 5.
