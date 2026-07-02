import SwiftUI

/// Storage helpers for the catalog "holds" filter: a set of grid positions the
/// user wants every shown problem to include. Persisted per board as a
/// "|"-joined list of "col-row" tokens in `@AppStorage`; empty = filter off.
enum HoldFilter {
    static func storageKey(for board: Board) -> String { "catalogHoldFilter_\(board.id)" }

    /// Parse the stored string into a set of "col-row" position keys.
    static func selected(from csv: String) -> Set<String> {
        Set(csv.split(separator: "|").map(String.init))
    }

    static func csv(from positions: Set<String>) -> String {
        positions.sorted().joined(separator: "|")
    }

    /// Whether a position may be selected: a real hold on an active set. When the
    /// board has no membership map, every grid position is allowed (fallback).
    static func isSelectable(col: Int, row: Int,
                             membership: HoldSetMembership,
                             activeSetIDs: Set<Int>) -> Bool {
        guard let id = membership.setID(col: col, row: row) else {
            return membership.membership.isEmpty
        }
        return activeSetIDs.contains(id)
    }

    /// Drop any selected position that no longer sits on an active hold set, so a
    /// selection can't outlive the hold set it came from. No-op without membership.
    static func pruned(_ positions: Set<String>,
                       membership: HoldSetMembership,
                       activeSetIDs: Set<Int>) -> Set<String> {
        guard !membership.membership.isEmpty else { return positions }
        return positions.filter { key in
            let parts = key.split(separator: "-")
            guard let col = Int(parts.first ?? ""), let row = Int(parts.last ?? "") else { return false }
            return isSelectable(col: col, row: row, membership: membership, activeSetIDs: activeSetIDs)
        }
    }
}

/// A bottom sheet that shows the full board and lets the user tap holds to build
/// the catalog "holds" filter. Only positions on active hold sets are tappable;
/// selected holds get a yellow ring (see `BoardImageView.selectedHolds`).
struct HoldFilterPickerView: View {
    @Environment(\.dismiss) private var dismiss

    let board: Board
    /// Hold-set layers to render (active + always-on feet), matching the catalog.
    let visibleHoldSetIDs: Set<Int>
    /// Active hold-set ids — gate which positions are tappable.
    let activeSetIDs: Set<Int>
    @Binding var selection: Set<String>

    private var membership: HoldSetMembership { board.membership }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                BoardImageView(setup: board.setup,
                               visibleHoldSetIDs: visibleHoldSetIDs,
                               selectedHolds: selection,
                               showBeta: false) { col, row in
                    toggle(col: col, row: row)
                }
                .padding(.horizontal, 8)
                Spacer(minLength: 0)
            }
            .padding(.top, 8)
            .navigationTitle("Filter by holds")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear") { selection = [] }
                        .disabled(selection.isEmpty)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func toggle(col: Int, row: Int) {
        guard HoldFilter.isSelectable(col: col, row: row,
                                      membership: membership, activeSetIDs: activeSetIDs) else { return }
        let key = "\(col)-\(row)"
        if selection.contains(key) { selection.remove(key) } else { selection.insert(key) }
    }
}
