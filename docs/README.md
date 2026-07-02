# MoonBoard LED — Developer Docs

Deep-dive reference docs for agents and developers working on this codebase. These
**pair with, and do not replace,** the two top-level files:

- **`../CONTEXT.md`** — the handoff/orientation doc. Read it *first* for what the app is,
  why it exists, how to build, the BLE protocol summary, and the "20-byte bug" backstory.
- **`../README.md`** — user-facing run instructions.

The docs here go one level deeper than CONTEXT.md: they document the *implementation*
of each subsystem — the data types, invariants, and gotchas you need to know before
editing code in that area. Each doc is scoped to one subsystem.

## When to read what

| If you're touching… | Read |
| --- | --- |
| Bluetooth, LED lighting, connection UI, calibration | [ble-hardware.md](ble-hardware.md) |
| Hold coordinates, LED index math, board rendering | [board-geometry.md](board-geometry.md) |
| Board registry, adding a board, active/added boards, hold-set filtering | [multi-board-model.md](multi-board-model.md) |
| Fetching/regenerating catalog data, JSON schemas, the Python scripts | [catalog-data-pipeline.md](catalog-data-pipeline.md) |
| SwiftData models, logging ascents/tries, the logbook & pyramid | [data-model-and-logging.md](data-model-and-logging.md) |
| Tabs, navigation, Home board management, catalog filters, Settings | [navigation-and-ui-flows.md](navigation-and-ui-flows.md) |

## Conventions used across these docs

- **Position string** — a hold is identified as `"col-row"`, e.g. `"0-1"` = column A, row 1
  (bottom-left). Column is **0-indexed** (0–10 = A–K); row is **1-indexed** (1 = bottom).
  This exact string is a dictionary key in several places — a typo silently breaks lookups.
- **Layout id / board id** — an integer 1–7 identifying a physical board (see the table in
  [multi-board-model.md](multi-board-model.md)). Mini 2025 = **7**.
- **CSV state** — several settings are persisted in `@AppStorage` as `"|"`-joined strings
  (added boards, board filter, hold-set selection, hold filter, recent problems). Each doc
  notes the exact key and format for the state it covers.
- **References** — docs cite files by path and by Swift *type/function* name rather than line
  numbers, because line numbers drift. Grep for the symbol name to find current location.

> These docs were generated from a subsystem sweep of the codebase. If you change behavior in
> a subsystem, update its doc in the same commit.
