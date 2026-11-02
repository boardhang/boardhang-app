# BLE protocol — DIY MoonBoard LED controller

Cross-platform spec extracted from `ios/MoonBoardLED/BLE/MoonBoardBLEManager.swift`.
The DIY controller runs the **ArduinoMoonBoardLED** firmware, which exposes a Nordic
UART Service (NUS). The app writes a problem string to the RX characteristic; the
firmware lights the LEDs. Nothing is read back. The official MoonBoard LED boxes
speak the same frame over the controllers described below; only the GATT
addresses and the accepted ATT write type differ.

## UUIDs (Nordic UART Service)

| Role | UUID |
| --- | --- |
| Service (NUS) | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX characteristic — write (app → board) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |

Scan/filter by the **service UUID**, not the device name — the board can be renamed
but still advertises the NUS service.

## Write-type rule

The RX characteristic's `properties` decide the ATT write type, read once per
connection after the characteristic resolves:

| The characteristic reports | Nordic UART | RedBearLab |
| --- | --- | --- |
| plain `write` only (`write=true`, `writeWithoutResponse=false`) | **write-with-response** (acknowledged) | write-with-response |
| `writeWithoutResponse` only (`write=false`) | write-without-response | **write-without-response** |
| both flags | write-without-response | write-with-response |
| neither flag, or properties absent or unreadable | write-without-response | write-with-response |

Each controller has a default and exactly one combination that flips it. Nordic
UART defaults to write-without-response — the DIY boards' (ArduinoMoonBoardLED
firmware) field-proven method, which must survive a shim that hides the
properties — and flips to acknowledged writes only for plain write only. RedBearLab
defaults to write-with-response — the box is documented as plain write only, and a
wrong acknowledged write is rejected loudly while a wrong unacknowledged write is
silent at every layer — and flips to unacknowledged writes only when the
characteristic reports `writeWithoutResponse` alone. Plain write only means the box
accepts acknowledged writes only: CoreBluetooth silently drops a
write-without-response to such a characteristic while the browser reports success,
so the rule never guesses in the unacknowledged direction when the properties are
plain. A reconnect re-derives the type from the new characteristic; a live link
never changes it. A forced write type (the web client's admin lab) overrides the
rule. The iOS manager is Nordic UART only and writes without response.

## Official Nordic UART boxes (one unit hardware-verified)

Later official MoonBoard LED kits use a Nordic UART controller with the same service
and RX characteristic UUIDs, frame, letters, and 20-byte chunking as the DIY boards,
but the RX characteristic advertises plain `write` only, so the rule above sends it
acknowledged writes. One unit is verified: the box installed at a gym, advertising as
"MoonBoard A" (also the DIY firmware's default name, so identify a box by its
installation, not its name), in Bluefy 3.9.3 on iPhone on 2026-10-30. Its properties
read `write=true writeWithoutResponse=false`; write-without-response left it dark;
acknowledged writes lit it, about 50 ms for a one-chunk send and 100 to 220 ms for two
or three chunks. Other official boxes may differ — the rule decides per connection.

## Second controller generation: the original RedBearLab box (unverified)

The official MoonBoard LED kit shipped in two Bluetooth generations (per the
Moon Climbing app, as documented in boardsesh's MoonBoard protocol spec): the
original box on a **RedBearLab** BLE module and later boxes on **Nordic UART**.
The frame, letters, LED index, and 20-byte chunking are the same; only the GATT
addresses and the accepted ATT write type differ.

| Role | UUID |
| --- | --- |
| RedBearLab service | `713D0000-503E-4C75-BA94-3148F18D941E` |
| Write characteristic (app → board) | `713D0003-503E-4C75-BA94-3148F18D941E` |

- **Scan rule:** filter on either service (OR'd filters) plus the `MoonBoard` name
  prefix, with both services in `optionalServices`; after connect, resolve the
  NUS pair first and fall back to the RedBearLab pair on any rejection.
- **Write type:** the RedBearLab characteristic is documented as plain `write`
  only, so the write-type rule above sends it acknowledged writes; when its
  `properties` are absent, RedBearLab defaults to write-with-response (a wrong
  acknowledged write fails loudly, a wrong unacknowledged one never does).
- **Status:** unverified on hardware. Only the web client speaks this generation,
  and only through its admin-only BLE lab (docs/ble-hardware.md); the iOS manager
  is Nordic UART only. Clear-all (`l##`) is unconfirmed on official boxes and at
  worst a no-op.

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

- **Clear (all LEDs off):** `l##` — the empty problem string.
- **Single-LED calibration:** `l#P<n>#` — lights exactly one LED, sent as a one-hold
  "move" problem. Used by the LED test / calibration screen.

## The 20-byte chunking + flow control (critical gotcha)

The firmware's RX characteristic accepts **at most 20 bytes per write**
(`BLE_ATTRIBUTE_MAX_VALUE_LENGTH` in ArduinoMultiUserHardwareBLESerial). It
**silently truncates** anything longer, which would drop every hold past roughly the
first four. The firmware reassembles successive writes in its 256-byte receive
buffer, so a long message just needs to be delivered as a sequence of ≤20-byte
writes.

**Do NOT** size chunks from the negotiated MTU / `maximumWriteValueLength`: on modern
phones the MTU is ~180+, but the firmware still only stores 20 bytes per write. Always
hard-cap the chunk length at **20 bytes**.

Encoding is **ASCII** (the message is plain ASCII text).

### Flow control

Each message is self-contained (`l#…#`), so a new message fully replaces any
partially-sent prior one — reset the write queue on every new message.

Chunks are sent with the write type the [write-type rule](#write-type-rule) selects
for the characteristic and must respect back-pressure so the stack never silently
drops packets:

- **iOS (CoreBluetooth):** drain the queue only while
  `peripheral.canSendWriteWithoutResponse` is true; when it goes false, stop and
  resume from `peripheralIsReady(toSendWriteWithoutResponse:)`. One "primed" write is
  allowed right after connect because `canSendWriteWithoutResponse` can briefly report
  false before the ready-callback starts firing.
- **Web Bluetooth:** there is no explicit ready-callback. The equivalent back-pressure
  is to `await` each chunk's write **sequentially**, whichever write type the rule
  selected (`writeValueWithoutResponse` or `writeValueWithResponse`) — awaiting each
  write provides the flow control, and with acknowledged writes the await is a true
  ATT-level acknowledgement. A write can still transiently reject on a healthy link
  (GATT momentarily busy, radio hiccup); the web client retries each chunk once, in
  the same write type, after a short beat before surfacing the failure.

## Connection lifecycle (iOS reference behavior)

1. Scan for peripherals advertising the NUS service UUID.
2. Connect; on connect, discover the NUS service, then the RX characteristic.
3. Only once the RX characteristic is resolved is the link "connected" / writable.
   A message that arrives before then is stashed and flushed when ready.
4. iOS additionally persists the last peripheral UUID and auto-reconnects on
   unexpected drops (not after a user-initiated disconnect). Auto-reconnect is an iOS
   convenience, not part of the protocol.
