# Data model — holds, roles, board config

Cross-platform spec extracted from `ios/MoonBoardLED/Models/HoldType.swift`
(with board dimensions from `ios/MoonBoardLED/Board/BoardGeometry.swift`).

## HoldType

The official MoonBoard hold roles. Each maps to a **protocol letter** (the BLE
message letter, see ble-protocol.md) and a **display color** chosen to mirror the
color the firmware lights on the strip.

| Role   | Protocol letter | Firmware / display color |
| ------ | --------------- | ------------------------ |
| start  | `S`             | green                    |
| left   | `L`             | violet / purple          |
| right  | `R`             | blue                     |
| match  | `M`             | pink                     |
| end    | `E`             | red                      |

### Beta-collapse rule

The "Show beta" setting controls whether the individual hand roles are shown:

- **Beta on:** every role displays/lights as itself (green / violet / blue / pink /
  red).
- **Beta off:** the move roles **left, right, match all collapse to `right`** (blue).
  Only start (green), the collapsed move (blue), and end (red) remain. The BLE message
  is built from the *displayed* role, so with beta off those holds go out as the blue
  move letter.

`displayed(showBeta)` = the role itself if `showBeta`; otherwise `start`/`end` stay
put and everything else becomes `right`.

**MVP default: beta OFF** — so the editable grid cycles start → move → end.

## HoldAssignment

A single placed hold: its grid position and role.

```
HoldAssignment {
  col:  Int      // 0…10  (A…K, left → right)
  row:  Int      // 1…12  (1 = bottom; up to `rows` on larger boards)
  type: HoldType
}
```

Identity is the `col-row` pair (one hold per cell).

## Board config shape

Board geometry is data-driven so other sizes drop in without code changes. A board
definition carries:

| Field   | Meaning                                        | Mini 2025 |
| ------- | ---------------------------------------------- | --------- |
| cols    | column count (always 11 for current boards)    | 11        |
| rows    | row count (Mini 12, full 18) — drives LED map  | 12        |
| angle   | board angle in degrees (metadata)              | 40        |
| flipped | strip wired/mounted from the opposite end      | false     |

`mini2025 = { cols: 11, rows: 12, angle: 40, flipped: false }`.
