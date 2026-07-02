import Foundation

/// LED (serpentine) mapping for the ArduinoMoonBoardLED firmware, shared by every
/// MoonBoard layout. The strip is wired in a serpentine: LED 0 is the bottom of
/// column A, counting up column A; the strip then snakes down column B, up column
/// C, and so on. We reproduce that so the number we send in `S<n>/P<n>/E<n>` lands
/// on the right physical hold.
///
/// The only thing that differs between boards is the row count — 12 for the Mini
/// boards, 18 for the full boards — so the mapping is parameterized by `rows`.
///
/// Derived/confirmed from the firmware's `additionalledmapping` array, whose
/// period-N groups with alternating +1/−1 direction prove N LEDs per column with
/// alternating (serpentine) wiring direction.
enum BoardGeometry {
    static let columns = 11          // A...K
    /// Row count of the Mini boards; used by the (Mini-only) problem editor.
    static let rows = 12

    static let columnLabels = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]

    /// Total LEDs for a board with `rows` rows (11 columns).
    static func totalLEDs(rows: Int) -> Int { columns * rows }

    /// LED index (0-based) for a hold at the given column/row.
    /// - Parameters:
    ///   - col: 0...10 (A...K, left → right)
    ///   - row: 1...`rows` (1 = bottom)
    ///   - rows: the board's row count (Mini 12, full 18).
    ///   - flipped: if the board is wired/mounted from the opposite end, this
    ///     reverses the whole strip order. Toggle it in the LED test screen.
    static func ledIndex(col: Int, row: Int, rows: Int, flipped: Bool = false) -> Int {
        let base = col * rows
        let led: Int
        if col % 2 == 0 {
            led = base + (row - 1)          // even columns: bottom → top
        } else {
            led = base + (rows - row)       // odd columns: top → bottom
        }
        return flipped ? (totalLEDs(rows: rows) - 1 - led) : led
    }

    /// Reverse mapping: which (col, row) a given LED index lights, for the LED test.
    static func position(forLED led: Int, rows: Int, flipped: Bool = false) -> (col: Int, row: Int)? {
        let total = totalLEDs(rows: rows)
        guard led >= 0 && led < total else { return nil }
        let effective = flipped ? (total - 1 - led) : led
        let col = effective / rows
        let offset = effective % rows
        let row = (col % 2 == 0) ? (offset + 1) : (rows - offset)
        return (col, row)
    }

    static func columnLabel(_ col: Int) -> String {
        guard col >= 0 && col < columnLabels.count else { return "?" }
        return columnLabels[col]
    }
}
