# LED geometry — serpentine mapping

Cross-platform spec extracted from `ios/MoonBoardLED/Board/BoardGeometry.swift`.

The LED strip is wired in a **serpentine**: LED 0 is at the bottom of column A,
counting up column A; the strip then snakes down column B, up column C, and so on.
The `<letter><ledIndex>` token in the BLE message (see ble-protocol.md) must carry
the physical LED index this mapping produces.

The only thing that differs between board sizes is the **row count** — 12 for the
Mini boards, 18 for the full boards — so the mapping is parameterized by `rows`.
Columns are always **11** (A…K, index 0…10). Rows are **1-based**, 1 = bottom.

Derived/confirmed from the firmware's `additionalledmapping` array (period-N groups
with alternating +1/−1 direction ⇒ N LEDs per column, alternating wiring direction).

## Constants

- `columns = 11` (labels `A B C D E F G H I J K`)
- `totalLEDs(rows) = columns * rows` (Mini: 11 × 12 = 132)

## Forward mapping: (col, row) → LED index

```
base = col * rows
if col is even:  led = base + (row - 1)      // even columns: bottom → top
else:            led = base + (rows - row)    // odd columns:  top → bottom

if flipped:      led = totalLEDs(rows) - 1 - led
```

- `col`: 0…10 (A…K, left → right)
- `row`: 1…rows (1 = bottom)
- `flipped`: reverses the entire strip order — set when the board is wired/mounted
  from the opposite end. Toggle it in the LED test screen. For Mini 2025, `flipped`
  defaults to **false**.

## Reverse mapping: LED index → (col, row)

Used by the LED test / calibration screen to show which hold a given LED lights.

```
guard 0 <= led < totalLEDs(rows)          // else no position
effective = flipped ? (totalLEDs(rows) - 1 - led) : led
col    = effective / rows
offset = effective % rows
row    = (col is even) ? (offset + 1) : (rows - offset)
```
