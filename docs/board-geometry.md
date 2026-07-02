# Board Geometry & Coordinate System

The coordinate math that maps a hold on the wall to an LED index and to a pixel on screen.
Getting an axis or an index base wrong here produces subtly wrong lighting or rendering, so
read this before editing anything in `MoonBoardLED/Board/`.

**Key files:** `BoardGeometry.swift` (LED index math), `MoonBoardSetup.swift`
(`MoonBoardGeometry`, per-board dimensions), `BoardImageView.swift` (rendering),
`BoardArt.swift` (overlay caching), `HoldType.swift` (`HoldAssignment`).

## The grid model

- **Columns**: `0…10` → labels `A…K`, left → right. 11 columns on every board.
- **Rows**: `1…N`, where **row 1 is the bottom** and row N is the top. `N` is
  **12** on the Mini boards, **18** on the standard boards.
- **Position string**: a hold is `"col-row"`, e.g. `"0-1"` = A1 (bottom-left).
  Column is 0-indexed, row is 1-indexed. This asymmetry is the #1 source of off-by-one bugs.
  The string is used as a dictionary key in membership, rendering, and hold-filter code — a
  typo silently breaks lookups rather than erroring.

`HoldAssignment` (in `HoldType.swift`) is `{ col: Int (0–10), row: Int (1–N), type: HoldType }`
and its `id` is the `"col-row"` string.

## LED index: serpentine mapping

`BoardGeometry.ledIndex(col:row:rows:flipped:)` converts a hold to a strip index. The LED strip
snakes up one column and down the next:

```
even columns (0,2,4,6,8,10 = A,C,E,G,I,K):  led = col*rows + (row - 1)      // bottom → top
odd  columns (1,3,5,7,9    = B,D,F,H,J):     led = col*rows + (rows - row)   // top → bottom
if flipped:                                   led = (11*rows - 1) - led       // reverse whole strip
```

Note the base asymmetry: **LED index is 0-based, row is 1-based**. `flipped` is applied *after*
the serpentine computation and reverses the entire strip (for boards wired from the opposite
end); it is not merely a display orientation.

`BoardGeometry.position(forLED:rows:flipped:)` is the inverse map, used by `LEDTestView` to show
which physical hold a given LED should light.

> ⚠️ This formula was **derived from** the ArduinoMoonBoardLED firmware's mapping but is only
> truly confirmed by physical testing. `LEDTestView` is the validation tool — always calibrate
> against the real board before trusting a change here. The per-board `flipped` setting exists
> precisely to absorb wiring-direction differences.

## Screen rendering

`MoonBoardGeometry` (in `MoonBoardSetup.swift`) holds per-board layout: `numColumns` (11),
`rowTop` (12 or 18), and margin fractions (0–1) inset from the board-art image edges. Its
`center(col:row:)` returns a **normalized** `CGPoint` (fractions 0–1) for a hold's center.

`BoardImageView` lays out with a `GeometryReader` and multiplies those fractions by the actual
container pixel size. It stacks, bottom to top:

1. **Background / axis labels** — drawn as a *separately tinted* template layer (primary color),
   so A–K and row numbers adapt to dark mode. **This is deliberately NOT baked into the cached
   art** (see below).
2. **Cached hold-set art** — the flattened overlay image (see `BoardArt.swift`).
3. **Markers** — colored circles + type letters for a problem's holds (`assignments` dict keyed
   by `"col-row"`).
4. **`selectedHolds`** — an optional `Set<String>` of `"col-row"` positions drawn as yellow
   rings, used to visualize the catalog hold-filter without a typed marker underneath.

## Board art cache (`BoardArt.swift`)

`BoardArtCache.image(for:visibleHoldSetIDs:)` flattens the currently visible hold-set overlay
PNGs into one `UIImage`, keyed by the concatenated asset names, guarded by an `NSLock`.

**The background is intentionally excluded from the cache.** Axis labels are drawn separately by
`BoardImageView` (see above) so they can be tinted for dark mode; baking them into the cached
composite would make them a fixed color. All overlay PNGs within a single board setup must share
the same pixel dimensions (they're composited onto a shared canvas with no per-layer scaling).

## Gotchas summary

- Column 0-indexed (A–K), row 1-indexed, **row 1 = bottom**.
- `"col-row"` string keys everywhere — exact format, no spaces.
- `ledIndex` is serpentine, not row-major; LED base 0, row base 1.
- `flipped` reverses the *whole* strip and is applied last.
- `center()` returns fractions, not pixels — multiply by container size.
- Axis labels are a separate tinted layer, not part of the cached art.
