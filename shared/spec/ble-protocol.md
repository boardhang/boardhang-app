# BLE protocol — DIY MoonBoard LED controller

Cross-platform spec extracted from `ios/MoonBoardLED/BLE/MoonBoardBLEManager.swift`.
The controller runs the **ArduinoMoonBoardLED** firmware, which exposes a Nordic
UART Service (NUS). The app writes a problem string to the RX characteristic; the
firmware lights the LEDs. Nothing is read back.

## UUIDs (Nordic UART Service)

| Role | UUID |
| --- | --- |
| Service (NUS) | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX characteristic — write (app → board) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |

Scan/filter by the **service UUID**, not the device name — the board can be renamed
but still advertises the NUS service.

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

## The 20-byte chunking + write-without-response flow control (critical gotcha)

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

Chunks are sent **write-without-response** and must respect back-pressure so the
stack never silently drops packets:

- **iOS (CoreBluetooth):** drain the queue only while
  `peripheral.canSendWriteWithoutResponse` is true; when it goes false, stop and
  resume from `peripheralIsReady(toSendWriteWithoutResponse:)`. One "primed" write is
  allowed right after connect because `canSendWriteWithoutResponse` can briefly report
  false before the ready-callback starts firing.
- **Web Bluetooth:** there is no explicit ready-callback. The equivalent back-pressure
  is to `await characteristic.writeValueWithoutResponse(chunk)` for each chunk
  **sequentially** — awaiting each write provides the flow control. A write can still
  transiently reject on a healthy link (GATT momentarily busy, radio hiccup); the web
  client retries each chunk once after a short beat before surfacing the failure.

## Connection lifecycle (iOS reference behavior)

1. Scan for peripherals advertising the NUS service UUID.
2. Connect; on connect, discover the NUS service, then the RX characteristic.
3. Only once the RX characteristic is resolved is the link "connected" / writable.
   A message that arrives before then is stashed and flushed when ready.
4. iOS additionally persists the last peripheral UUID and auto-reconnects on
   unexpected drops (not after a user-initiated disconnect). Auto-reconnect is an iOS
   convenience, not part of the protocol.
