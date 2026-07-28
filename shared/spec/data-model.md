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

## User problem

A problem a person authored, as stored in `public.user_problems` (Supabase) and
cached by each client. The holds are a `HoldAssignment` array serialized as
`{ c, r, t }` — `c`/`r` are the grid coordinates above, `t` the role's raw value.

| Field            | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `id`             | uuid, client-generated (the primary key)                                |
| `name`, `grade`  | display name and Font grade                                             |
| `holds`          | `[{ c, r, t }]` — 1–60 entries when public                              |
| `layout_id`      | the board it was drawn on; null on legacy rows that recorded no board   |
| `angle`          | wall angle in degrees; null on the same legacy rows                     |
| `visibility`     | `private` (default) or `public`                                          |
| `source_catalog_id` | `"user:" + id` — the text id shared with official catalog problems   |
| `setter_user_id` | authoritative author of a **public** problem                            |
| `setter_handle`  | the setter's profile handle, denormalized so anon readers can attribute  |

Identity and attribution are **server-owned**: `source_catalog_id` is a generated
column and the two `setter_*` fields are trigger-stamped when a problem becomes
public and cleared when it goes private or is deleted. A client reads all three
and writes none of them.

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
