# BLE protocol — MoonBoard LED controllers

Cross-platform spec extracted from `ios/MoonBoardLED/BLE/MoonBoardBLEManager.swift`
and `web/src/ble/moonboard.ts`. The app writes a problem string to a write
characteristic; the controller lights the LEDs. Nothing is read back.

Two controller generations speak the same protocol over different GATT services:

- **Nordic UART (NUS)** — the DIY / second-generation controllers running the
  **ArduinoMoonBoardLED** firmware. The iOS manager speaks only this generation.
- **RedBearLab** — the first-generation official MoonBoard LED box (RedBearLab
  BLE module). The web client speaks both generations; the iOS app is on hold and
  stays Nordic-only.

The message grammar, LED numbering, ASCII encoding, and 20-byte chunking are
identical on both. Only the UUIDs and the write mode differ.

## UUIDs (both generations)

| Generation | Role | UUID |
| --- | --- | --- |
| Nordic UART | Service (NUS) | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| Nordic UART | RX characteristic — write (app → board) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| RedBearLab | Service | `713D0000-503E-4C75-BA94-3148F18D941E` |
| RedBearLab | Write characteristic (app → board) | `713D0003-503E-4C75-BA94-3148F18D941E` |

Web Bluetooth requires the UUIDs lowercase; CoreBluetooth accepts either case.

### Scan / chooser rule

Filter on the **service UUIDs**, not only the device name — a board can be renamed
but still advertises its service. The web client's chooser request lists three
OR'd filters: the NUS service, the RedBearLab service, and the name prefix
`MoonBoard`, with both service UUIDs in `optionalServices`. The name prefix is
included because the original box's advertisement is not guaranteed to carry
its 128-bit service UUID (advertisement payload is small); a name-only match can
still open either service after connecting because Web Bluetooth grants access
by the union of the filter services and `optionalServices`. A device matched by
name alone that exposes neither service fails at connect with a readable
"no known MoonBoard LED service" error. The iOS manager scans for the NUS
service only.

## Message grammar

```
message  = "l#" tokens "#"
tokens   = token ( "," token )*        ; empty for a clear
token    = letter ledIndex
letter   = "S" | "L" | "R" | "M" | "E" | "P"
ledIndex = 0-based integer (serpentine LED index — see led-geometry.md)
```

Example: `l#S0,P14,P40,E131#` — start at LED 0, moves at 14 and 40, end at 131.

### Letters → hold role → firmware LED color

| Letter | Role  | Color  |
| ------ | ----- | ------ |
| `S`    | start | green  |
| `L`    | left  | violet |
| `R`    | right | blue   |
| `M`    | match | pink   |
| `E`    | end   | red    |
| `P`    | move / plain (beta-off collapse, single-LED calibration) | blue |

`P` is what the firmware documents as a plain "move" LED. When beta is off the app
collapses left/right/match to a single move color (see data-model.md); the Swift
`message(for:)` emits the *displayed* role's protocol letter, so with beta off those
tokens go out as the blue "right"/move letter.

### Special messages

- **Clear (all LEDs off):** `l##` — the empty problem string. Sent identically on
  both generations; on the original box it is unconfirmed and at worst a no-op.
- **Single-LED calibration:** `l#P<n>#` — lights exactly one LED, sent as a one-hold
  "move" problem. Used by the LED test / calibration screen.

## The 20-byte chunking rule (critical gotcha)

Both generations accept **at most 20 bytes per characteristic write**: the
ArduinoMoonBoardLED firmware's `BLE_ATTRIBUTE_MAX_VALUE_LENGTH`, and the RedBearLab
firmware's per-write buffer. The Nordic firmware **silently truncates** anything
longer, which would drop every hold past roughly the first four. The firmware
reassembles successive writes in its receive buffer, so a long message just needs
to be delivered as a sequence of ≤20-byte writes.

**Do NOT** size chunks from the negotiated MTU / `maximumWriteValueLength`: on modern
phones the MTU is ~180+, but the firmware still only stores 20 bytes per write. Always
hard-cap the chunk length at **20 bytes**, on both generations.

Encoding is **ASCII** (the message is plain ASCII text).

## Write mode

Chunks are written either **without response** (an ATT write command: no
acknowledgement, no error can come back) or **with response** (an ATT write
request: the peripheral acknowledges or rejects each write). The two failure
directions are not symmetric: a wrong acknowledged write is *loud* (the
peripheral answers "write not permitted" and the browser rejects), a wrong
unacknowledged write is *silent* at every layer, and a locally successful
unacknowledged write proves only that the browser accepted it, not that the
board did. So the rule prefers the loud direction whenever the properties leave
room for doubt.

Per resolved link, from the controller generation and the characteristic's
reported properties:

| Controller | Properties | Mode |
| --- | --- | --- |
| Nordic UART | anything except "only plain write" (including absent) | without response, known |
| Nordic UART | `write` true and `writeWithoutResponse` false | with response, known |
| RedBearLab | `write` true (whatever `writeWithoutResponse` says) | with response, known |
| RedBearLab | `write` false and `writeWithoutResponse` true | without response, known |
| RedBearLab | absent, or neither flag true | with response, **unproven** |

On an **unproven** link, a rejected chunk first gets the ordinary same-mode retry
after a short beat. If that second acknowledged attempt also rejects, the chunk is
retried once without response. Whichever attempt succeeds locks its mode for the
rest of the link; if all three fail the error propagates and the link stays
unproven in the acknowledged mode. The flip is **one-way** (acknowledged →
unacknowledged only) and happens only after the same-mode retry, so a single
transient error can never lock the silent mode for the whole connection.
"Proven" means the browser accepted the write, not that the board rendered it;
only a light-up on hardware confirms the LEDs.

Nothing is remembered per board: every connect (including a silent reconnect)
re-derives the mode, and an unproven link pays at most one rejected chunk after
each reconnect.

When the split `writeValueWithResponse` / `writeValueWithoutResponse` methods are
missing (older Web Bluetooth shims), the legacy `writeValue` method is used for
either mode; the flip is then a no-op. With no write method at all, sends fail with
a readable message.

The iOS manager writes **without response** only (Nordic UART).

### Flow control

Each message is self-contained (`l#…#`), so a new message fully replaces any
partially-sent prior one on iOS — reset the write queue on every new message. The
web client has no replacement queue; interleaved sends share one link and its
write mode.

Chunks must respect back-pressure so the stack never silently drops packets:

- **iOS (CoreBluetooth):** drain the queue only while
  `peripheral.canSendWriteWithoutResponse` is true; when it goes false, stop and
  resume from `peripheralIsReady(toSendWriteWithoutResponse:)`. One "primed" write is
  allowed right after connect because `canSendWriteWithoutResponse` can briefly report
  false before the ready-callback starts firing.
- **Web Bluetooth:** there is no explicit ready-callback. The equivalent back-pressure
  is to `await` each chunk's write **sequentially**, whichever write method the link
  uses — awaiting each write provides the flow control, and with acknowledged writes
  it is a true ATT-level acknowledgement. A write can still transiently reject on a
  healthy link (GATT momentarily busy, radio hiccup); the web client retries each
  chunk once after a short beat before surfacing the failure (or, on an unproven
  link, before the one-way flip described above).

## Connection lifecycle

1. Scan / choose: iOS scans for the NUS service UUID; the web chooser uses the
   three-filter rule above.
2. Connect. Then resolve the write characteristic by **probing Nordic UART first,
   RedBearLab second**: try the NUS service and its RX characteristic; on *any*
   rejection (including the nameless numeric rejections the Bluefy shim produces)
   try the RedBearLab service and its write characteristic. Record which
   generation matched.
3. If both lookups fail because the service or characteristic is absent
   (`NotFoundError`, or a rejection with no name), connect fails with a readable
   "no known MoonBoard LED service" error. If either lookup failed with any other
   name (`NetworkError`, `SecurityError`), that error surfaces as itself.
4. Only once the write characteristic is resolved is the link "connected" /
   writable, and the write mode is derived from it as above. On iOS a message that
   arrives before then is stashed and flushed when ready.
5. iOS additionally persists the last peripheral UUID and auto-reconnects on
   unexpected drops (not after a user-initiated disconnect). The web client keeps
   the `BluetoothDevice` and reconnects without the chooser, re-running the probe
   and re-deriving the write mode each time. Auto-reconnect is a client
   convenience, not part of the protocol.

## Hardware verification status

- **Nordic UART:** verified on the DIY Mini MoonBoard 2025 (iOS and web).
- **RedBearLab (first-generation box):** **unverified on hardware.** The client
  logic is unit-tested against both possible characteristic properties
  (boardsesh reports plain write only; the RedBearLab Biscuit firmware declares
  write-without-response). The observed advertisement, characteristic properties,
  and working write mode from a real box are to be recorded here and in
  `docs/ble-hardware.md` once captured.
