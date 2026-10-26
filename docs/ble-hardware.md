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
format, same 20-byte chunking rule; chunks are drained by awaiting each write
sequentially (the web equivalent of the flow-controlled queue), with a single short
retry per chunk for transient GATT hiccups.

The client has **two paths** selected by the device-local BLE lab setting (next
section). With the lab **off** — every user, and the default — it is the Nordic UART
client exactly as it shipped before the lab existed: the chooser filters on the NUS
service only, only the NUS service and RX characteristic are looked up, the
characteristic's `properties` and the device `id` are never read, and chunks go
through `writeValueWithoutResponse`. `moonboard.invariance.test.ts` pins those calls;
treat a red test there as a regression for real users, not as a test to update.

### BLE lab (admin-only experimental path)

The lab exists because the original official MoonBoard LED box (and possibly other
official generations) only accepts **acknowledged** ATT writes. On Apple stacks
(Bluefy on iPhone, Chrome on macOS) a `writeValueWithoutResponse` to such a
characteristic is handed to CoreBluetooth, which drops it with a log line while the
browser reports success — the app says "lit", the wall stays dark. Boardsesh's
MoonBoard protocol spec documents the two controller generations; the first attempt to
support both for everyone (PR #165) broke the owner's phone and was reverted (#167),
so the second attempt is opt-in per device and observable.

- **Settings** live in `labSettings.ts` (localStorage `ble.lab.v1`): `enabled`
  (default off), `chooser` (`nordic` = today's filter, `both` = NUS + RedBearLab
  services + `MoonBoard` name prefix, `any` = `acceptAllDevices`), `writeMode`
  (`auto`, `with-response`, `without-response`). The in-memory snapshot is the
  source of truth and storage a best-effort mirror, so the lab still works where
  `localStorage` throws. The client snapshots the settings once per user-initiated
  connect and reuses that snapshot for the attempt's silent reconnects; the
  Settings card disconnects the board before any change, so a live link never
  changes behaviour.
- **Chooser** options are built fresh per call and never frozen (the reverted
  release froze a module constant — the leading hypothesis for the Bluefy failure).
  Web Bluetooth exposes only the services named in `filters`/`optionalServices`,
  so `any` lets the probe try both known services on an unlisted box; it cannot
  enumerate an unknown one (that is an nRF Connect job).
- **Probe** after `gatt.connect()`: the NUS pair first, then on *any* rejection
  (Bluefy rejects with bare numeric codes, so no name gating) the RedBearLab pair
  (`713d0000-503e-4c75-ba94-3148f18d941e` / write `713d0003-…`). Both absent →
  readable "no known MoonBoard LED service" error and the link is severed; a named
  `NetworkError`/`SecurityError` surfaces as itself. The guard before the second
  lookup checks user-disconnect and device identity only — never `gatt.connected`,
  which Chrome clears before a lookup rejects with `NetworkError`.
- **Write mode** `auto`: Nordic → without response unless `properties` reports
  only plain `write`; RedBearLab → with response unless `properties` reports only
  `writeWithoutResponse` (absent properties also → with response, the loud-failure
  direction). A forced mode wins outright. The split method for the mode is used;
  when a shim lacks it, legacy `writeValue` stands in and the link is marked
  `legacy` (the browser then chooses the ATT type, so "forced" is nominal). No
  method at all → a readable send error. A link's mode never changes; a reconnect
  re-derives it from the new characteristic.
- **Diagnostics** (`bleDiagnostics.ts`): a 100-event in-memory ring buffer plus a
  link summary, recorded on **both** paths (the lab-off run is the control),
  mirrored to localStorage `ble.diag.v1` only while the lab is on, never throwing
  into the Bluetooth path. Events cover connect start, the chosen device, each
  lookup with the raw rejection (`name`/`code`/`message`/`typeof`/`String(err)`),
  properties and available writers (or `not read`/`not probed` with the lab off),
  the mode, every send (bytes, chunks, mode, writer, duration), chunk retries,
  disconnects as `user`/`link`/`echo`, reconnect attempts, and the step a connect
  timeout was waiting on. The Settings card (`web/src/shell/BleLabSection.tsx`,
  rendered only when `useAuth().isAdmin`) shows the log newest-first with Copy,
  Show as text, and a confirmed Clear, plus quick actions (Connect, Light LED 0 =
  `l#P0#` via `lightLed(0)`, Clear LEDs, Disconnect).
- **Toasts:** a failed connect on the problem screens is toasted only while the
  lab is on (message plus the raw rejection in brackets); with the lab off it stays
  silent, as before.
- **Hardware status:** the RedBearLab path and the write-type rule are
  **unverified on hardware**. The owner's check order on the DIY Nordic board is
  lab off → `nordic` + Unacknowledged → `nordic` + Auto; at a gym `both` + Auto,
  then `both` + Acknowledged if dark, then `any`. Copy the diagnostics between steps.

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
- **Chrome echoes the client's own `gatt.disconnect()`** (after a failed lookup,
  the connect timeout, or a guard bail) back as `gattserverdisconnected`, while
  state is still `'connecting'`. Only a drop from `'connected'` resets the backoff
  counter; an echo keeps counting, so an auto-reconnect whose lookups keep failing
  stops after the four attempts instead of looping. This is the one rule that
  applies on both the default and the lab path.

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
- CoreBluetooth (Bluefy, Chrome on macOS) **silently drops** a write-without-response to a
  characteristic that only permits plain `write`, and the browser still reports success —
  the only sign is a dark wall. The original RedBearLab box is such a characteristic. The
  web client's lab path writes with response there; the default path still cannot.
- With the BLE lab off the web client must stay byte-identical to the pre-lab client
  (`moonboard.invariance.test.ts`); route any new Bluetooth behaviour through the lab first.
- BLE does **not** work in the iOS Simulator — only on a real device.
- Manager is `@MainActor`; CoreBluetooth callbacks already run on the main queue. Moving to
  Swift 6 language mode will surface concurrency warnings here that are benign under Swift 5.
