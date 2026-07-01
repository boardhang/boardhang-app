import SwiftUI

/// The app's single board renderer. Stacks board art — the shared background
/// first, then one transparent overlay per visible hold set — then draws
/// colored markers over holds. Used read-only (detail views,
/// thumbnails), tappable (the problem editor, via `onTap`), and with a highlight
/// ring (LED calibration, via `highlight`).
///
/// `visibleHoldSetIDs` controls which hold-set layers show (nil = all). On the
/// display surfaces this is the board's active hold sets, so holds from
/// uninstalled sets visibly disappear.
struct BoardImageView: View {
    let setup: MoonBoardSetup
    /// Which hold sets to show, by id. nil shows every hold set in the setup.
    var visibleHoldSetIDs: Set<Int>? = nil
    /// Holds to light up on top of the art (a problem's beta).
    var holds: [HoldAssignment] = []
    /// Beta off collapses left/right/match to blue.
    var showBeta: Bool = true
    /// Called when a hold is tapped (nil = read-only). When set, every grid
    /// position is tappable, not just the lit ones.
    var onTap: ((Int, Int) -> Void)? = nil
    /// Optional highlight ring at a position (used by the LED test screen).
    var highlight: (col: Int, row: Int)? = nil

    /// "col-row" → assignment, for O(1) lookup while rendering markers.
    private let assignments: [String: HoldAssignment]

    init(setup: MoonBoardSetup,
         visibleHoldSetIDs: Set<Int>? = nil,
         holds: [HoldAssignment] = [],
         showBeta: Bool = true,
         onTap: ((Int, Int) -> Void)? = nil,
         highlight: (col: Int, row: Int)? = nil) {
        self.setup = setup
        self.visibleHoldSetIDs = visibleHoldSetIDs
        self.holds = holds
        self.showBeta = showBeta
        self.onTap = onTap
        self.highlight = highlight
        self.assignments = Dictionary(uniqueKeysWithValues: holds.map { ("\($0.col)-\($0.row)", $0) })
    }

    private var shownHoldSets: [MoonBoardHoldSet] {
        guard let ids = visibleHoldSetIDs else { return setup.holdSets }
        return setup.holdSets.filter { ids.contains($0.id) }
    }

    var body: some View {
        let geom = setup.geometry
        // Marker size tracks the column spacing so rings sit snugly on the holds.
        let colStepFrac = (1 - geom.leftMargin - geom.rightMargin) / CGFloat(geom.numColumns)

        ZStack {
            // The static art (background + visible hold-set overlays) is flattened
            // into ONE cached image, so a list row draws a single layer instead of
            // stacking 5+. Falls back to layered rendering if the composite fails.
            if let art = BoardArtCache.image(for: setup, visibleHoldSetIDs: visibleHoldSetIDs) {
                Image(uiImage: art)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                Image(setup.backgroundAsset)
                    .resizable()
                    .aspectRatio(contentMode: .fit)

                ForEach(shownHoldSets) { holdSet in
                    Image(setup.asset(for: holdSet))
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                }
            }

            // Only lay out the marker overlay when there's actually something to
            // draw. Plain thumbnails (no holds, not interactive, no highlight) skip
            // the GeometryReader + per-cell work entirely, which keeps big lists
            // and swipe gestures smooth.
            if !holds.isEmpty || onTap != nil || highlight != nil {
                GeometryReader { geo in
                    let w = geo.size.width
                    let h = geo.size.height
                    let marker = colStepFrac * w * 0.9
                    // Interactive / highlight modes need every cell present (tappable
                    // or highlightable); read-only display only needs the lit holds.
                    if onTap != nil || highlight != nil {
                        ForEach(0..<geom.numColumns, id: \.self) { col in
                            ForEach(1...geom.rowTop, id: \.self) { row in
                                positionedMarker(col: col, row: row, size: marker, w: w, h: h, geom: geom)
                            }
                        }
                    } else {
                        ForEach(holds) { hold in
                            positionedMarker(col: hold.col, row: hold.row, size: marker, w: w, h: h, geom: geom)
                        }
                    }
                }
            }
        }
        .aspectRatio(geom.aspect, contentMode: .fit)
    }

    /// A positioned hold marker.
    @ViewBuilder
    private func positionedMarker(col: Int, row: Int, size: CGFloat,
                                  w: CGFloat, h: CGFloat, geom: MoonBoardGeometry) -> some View {
        let p = geom.center(col: col, row: row)
        holdMarker(col: col, row: row, size: size)
            .position(x: p.x * w, y: p.y * h)
    }

    @ViewBuilder
    private func holdMarker(col: Int, row: Int, size: CGFloat) -> some View {
        let assignment = assignments["\(col)-\(row)"]
        let shownType = assignment?.type.displayed(showBeta: showBeta)
        let shownColor = shownType?.color
        let isHighlighted = highlight.map { $0.col == col && $0.row == row } ?? false
        let ringColor: Color = isHighlighted ? .orange : (shownColor ?? .clear)
        let ringWidth: CGFloat = isHighlighted ? 4 : (assignment == nil ? 0 : 3.5)

        Circle()
            .fill((shownColor ?? .clear).opacity(assignment == nil ? 0 : 0.35))
            .frame(width: size, height: size)
            .overlay(Circle().strokeBorder(ringColor, lineWidth: ringWidth))
            .shadow(color: .black.opacity(assignment == nil && !isHighlighted ? 0 : 0.5), radius: 1)
            .overlay(alignment: .bottom) {
                if showBeta, let shownType {
                    Text(shownType.label)
                        .font(.system(size: max(8, size * 0.34), weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(shownType.color.opacity(0.9), in: Capsule())
                        .fixedSize()
                        .offset(y: size * 0.62)
                }
            }
            .contentShape(Circle())
            .onTapGesture { onTap?(col, row) }
            .allowsHitTesting(onTap != nil)
    }
}

#Preview("All hold sets") {
    ScrollView {
        VStack(spacing: 24) {
            ForEach(MoonBoardSetup.all) { setup in
                VStack(alignment: .leading) {
                    Text(setup.name).font(.headline)
                    BoardImageView(setup: setup)
                }
            }
        }
        .padding()
    }
}
