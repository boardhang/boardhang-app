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

## Web client (`web/src/ble/`)

The PWA reimplements the same NUS protocol over Web Bluetooth — `moonboard.ts`
(`MoonBoardClient`, a module-level singleton exposed reactively via `useBle.ts`),
with the "connect if needed, then send" interaction in `useLightUp.ts`. Same wire
format, same 20-byte chunking rule; chunks are drained by awaiting each
`writeValueWithoutResponse` sequentially (the web equivalent of the flow-controlled
queue), with a single short retry per chunk for transient GATT hiccups.

### Reconnect model

Web Bluetooth has no background contract: Android Chrome throttles a hidden PWA's
timers, freezes the page after ~5 minutes, and may discard the process entirely —
the GATT link dies with it, sometimes without `gattserverdisconnected` ever being
delivered. The client therefore designs for disconnection instead of fighting it
(the board keeps its own LED state, so the link only matters at send time):

- **Unexpected disconnect** keeps the `BluetoothDevice` — permission persists for
  the life of the page, so `device.gatt.connect()` reconnects **without the
  chooser** — and retries on a short finite backoff (0.5/1/2/4 s), only while the
  page is visible.
- **`visibilitychange` → visible** probes `gatt.connected` and reconnects if the
  link died while the page was frozen (covers the dropped-event case where state
  still claims connected).
- **`connect()` with a retained device** skips the chooser. If the board is
  unreachable, the device is dropped and the error surfaces — the *next* tap gets
  the chooser. Don't chain a failed silent reconnect into `requestDevice()`: the
  transient user activation has expired by then and the chooser call would be
  rejected.
- **The iOS invariant #1 applies here too:** `userDisconnect` is set in
  `disconnect()` and cleared only in `connect()`; while set, all auto-reconnect
  paths are no-ops.
- **`establish()` re-checks before it commits.** Its GATT awaits can settle
  *after* a disconnect (user tap or a second link drop) has already landed —
  Web Bluetooth's `gatt.disconnect()` does not reliably reject an in-flight
  `gatt.connect()`. Before setting the characteristic and `'connected'` state it
  re-checks `userDisconnect`, device identity, and `gatt.connected`; on any
  mismatch it disconnects the freshly-opened link and bails, so a late
  resolution can't resurrect a severed connection.
- **`gatt.connect()` is bounded by a 10 s timeout.** It has no built-in timeout
  and can hang on a flaky link; a forever-pending attempt would wedge the shared
  `inflight` promise and freeze every later `connect()` (including user taps) at
  `'connecting'` with no UI escape. On timeout the attempt aborts the link and
  rejects into the normal backoff/chooser-fallback paths.

`requestDevice()` (first connect, or after a retained device was dropped) must be
called from a user gesture. `getDevices()`/`watchAdvertisements()` (chooser-free
reconnect after a full page reload) are still behind Chrome flags and are not used.

Web Bluetooth itself only works in Chromium browsers (desktop Chrome/Edge, Android
Chrome) and Bluefy on iOS — see `web/src/shell/BleBrowserBanner.tsx`.

## Gotchas summary

- 20-byte chunks + flow control are load-bearing; never size from MTU. (bug's root cause)
- `flipped` reverses the *entire* LED strip (`total - 1 - led`) — see [board-geometry.md](board-geometry.md).
- Message format must be byte-exact `l#…#`.
- Auto-reconnect stays off after a user disconnect until the next explicit `connect()`.
- BLE does **not** work in the iOS Simulator — only on a real device.
- Manager is `@MainActor`; CoreBluetooth callbacks already run on the main queue. Moving to
  Swift 6 language mode will surface concurrency warnings here that are benign under Swift 5.
