import SwiftUI

/// Board art (background + per-hold-set overlays) for every MoonBoard setup.
///
/// A board is rendered by stacking transparent PNG layers: one shared
/// background per board family, then one overlay per hold set. `BoardImageView`
/// does the same with the assets imported by `scripts/import_board_images.py`.
///
/// Asset names are namespaced (`Boards/<folder>/<file>`) because hold-set basenames
/// (holdseta, originalschoolholds, …) repeat across layouts.

/// One hold set: the physical set of holds and its overlay image.
struct MoonBoardHoldSet: Identifiable, Hashable {
    /// Hold set id.
    let id: Int
    let name: String
    /// Basename of the overlay imageset (e.g. "holdseta").
    let imageName: String
}

/// Placement of the hold grid within a board-art image (margins measured from
/// the MoonBoard app's board art).
struct MoonBoardGeometry: Hashable {
    let numColumns: Int   // 11 (A–K) for every current layout
    let rowTop: Int       // highest row number, drawn at the top slot
    let numRows: Int      // vertical slots, counting down from rowTop
    let width: CGFloat    // board-art px
    let height: CGFloat
    /// Fractions (0–1) of the hold grid inset within the image.
    let leftMargin, rightMargin, topMargin, bottomMargin: CGFloat

    var aspect: CGFloat { width / height }

    /// Center of a hold, as fractions (0–1) of the image. `col` 0–10 (A–K),
    /// `row` 1 = bottom.
    func center(col: Int, row: Int) -> CGPoint {
        let gridW = 1 - leftMargin - rightMargin
        let gridH = 1 - topMargin - bottomMargin
        let x = leftMargin + (CGFloat(col) + 0.5) / CGFloat(numColumns) * gridW
        let slotFromTop = CGFloat(rowTop - row)
        let y = topMargin + (slotFromTop + 0.5) / CGFloat(numRows) * gridH
        return CGPoint(x: x, y: y)
    }

    static let standard = MoonBoardGeometry(
        numColumns: 11, rowTop: 18, numRows: 18, width: 650, height: 1000,
        leftMargin: 0.10, rightMargin: 0.05, topMargin: 0.06, bottomMargin: 0.04)

    static let mini = MoonBoardGeometry(
        numColumns: 11, rowTop: 12, numRows: 12, width: 650, height: 694,
        leftMargin: 0.1047, rightMargin: 0.0508, topMargin: 0.0793, bottomMargin: 0.0571)
}

/// A complete MoonBoard setup: its background art, grid geometry, and hold sets.
struct MoonBoardSetup: Identifiable, Hashable {
    /// Layout id (1–7).
    let id: Int
    let name: String
    /// Asset-catalog namespace folder (e.g. "moonboard2016").
    let folder: String
    /// Background imageset basename ("moonboard-bg" or "minimoonboard-bg").
    let background: String
    let geometry: MoonBoardGeometry
    let holdSets: [MoonBoardHoldSet]

    /// A compact label for chips/pills: "Mini MoonBoard 2025" → "Mini 2025", and
    /// "MoonBoard Masters 2019" → "MoonBoard 2019" (the Masters line referred to by year).
    /// A plain "MoonBoard 2024" is left intact.
    var shortName: String {
        name.replacingOccurrences(of: "Mini MoonBoard", with: "Mini")
            .replacingOccurrences(of: "MoonBoard Masters", with: "MoonBoard")
    }

    /// Full asset name for the background layer.
    var backgroundAsset: String { "Boards/\(background)" }

    /// Full asset name for a hold-set overlay layer.
    func asset(for holdSet: MoonBoardHoldSet) -> String {
        "Boards/\(folder)/\(holdSet.imageName)"
    }

    static func == (a: MoonBoardSetup, b: MoonBoardSetup) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

extension MoonBoardSetup {
    private static func set(_ id: Int, _ name: String, _ img: String) -> MoonBoardHoldSet {
        MoonBoardHoldSet(id: id, name: name, imageName: img)
    }

    /// All seven MoonBoard setups, in board-family order.
    static let all: [MoonBoardSetup] = [
        MoonBoardSetup(id: 1, name: "MoonBoard 2010", folder: "moonboard2010",
                       background: "moonboard-bg", geometry: .standard, holdSets: [
            set(1, "Original School Holds", "originalschoolholds"),
        ]),
        MoonBoardSetup(id: 2, name: "MoonBoard 2016", folder: "moonboard2016",
                       background: "moonboard-bg", geometry: .standard, holdSets: [
            set(2, "Hold Set A", "holdseta"),
            set(3, "Hold Set B", "holdsetb"),
            set(4, "Original School Holds", "originalschoolholds"),
        ]),
        MoonBoardSetup(id: 3, name: "MoonBoard 2024", folder: "moonboard2024",
                       background: "moonboard-bg", geometry: .standard, holdSets: [
            set(5, "Hold Set D", "holdsetd"),
            set(6, "Hold Set E", "holdsete"),
            set(7, "Hold Set F", "holdsetf"),
            set(8, "Wooden Holds", "woodenholds"),
            set(9, "Wooden Holds B", "woodenholdsb"),
            set(10, "Wooden Holds C", "woodenholdsc"),
        ]),
        MoonBoardSetup(id: 4, name: "MoonBoard Masters 2017", folder: "moonboardmasters2017",
                       background: "moonboard-bg", geometry: .standard, holdSets: [
            set(11, "Hold Set A", "holdseta"),
            set(12, "Hold Set B", "holdsetb"),
            set(13, "Hold Set C", "holdsetc"),
            set(14, "Original School Holds", "originalschoolholds"),
            set(15, "Screw-on Feet", "screw-onfeet"),
            set(16, "Wooden Holds", "woodenholds"),
        ]),
        MoonBoardSetup(id: 5, name: "MoonBoard Masters 2019", folder: "moonboardmasters2019",
                       background: "moonboard-bg", geometry: .standard, holdSets: [
            set(17, "Hold Set A", "holdseta"),
            set(18, "Hold Set B", "holdsetb"),
            set(19, "Original School Holds", "originalschoolholds"),
            set(20, "Screw-on Feet", "screw-onfeet"),
            set(21, "Wooden Holds", "woodenholds"),
            set(22, "Wooden Holds B", "woodenholdsb"),
            set(23, "Wooden Holds C", "woodenholdsc"),
        ]),
        MoonBoardSetup(id: 6, name: "Mini MoonBoard 2020", folder: "minimoonboard2020",
                       background: "minimoonboard-bg", geometry: .mini, holdSets: [
            set(24, "Original School Holds", "originalschoolholds"),
            set(25, "Wooden Holds", "woodenholds"),
            set(26, "Wooden Holds B", "woodenholdsb"),
            set(27, "Wooden Holds C", "woodenholdsc"),
        ]),
        MoonBoardSetup(id: 7, name: "Mini MoonBoard 2025", folder: "minimoonboard2025",
                       background: "minimoonboard-bg", geometry: .mini, holdSets: [
            set(28, "Hold Set F", "holdsetf"),
            set(29, "Original School Holds", "originalschoolholds"),
            set(30, "Wooden Holds B", "woodenholdsb"),
            set(31, "Wooden Holds C", "woodenholdsc"),
        ]),
    ]

    static func with(id: Int) -> MoonBoardSetup? { all.first { $0.id == id } }

    /// The Mini 2025 setup this app is built around.
    static let mini2025 = with(id: 7)!
}
