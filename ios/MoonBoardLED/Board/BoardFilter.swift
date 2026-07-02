import SwiftUI

/// Shared, persisted "which boards to include" selection, used by both the
/// logbook and the home grade pyramid. Stored as a "|"-joined list of layout ids
/// in `@AppStorage(BoardFilter.storageKey)`; empty = all *added* boards.
///
/// The filter is scoped to the boards the user has added (`AddedBoards`), not every
/// supported board. A selection is always intersected with the added set, so
/// removing a board silently drops it from the filter; re-adding it brings it back.
enum BoardFilter {
    static let storageKey = "logbookBoardFilter"
    /// Sentinel meaning "deliberately show no boards" — distinct from `""` (all).
    /// Can't collide with the "|"-joined int ids, so it round-trips unambiguously.
    static let noneToken = "none"

    /// The currently added board ids (app-global). "All" is defined relative to
    /// this set, so the filter tracks the boards you actually own.
    private static var addedIDs: Set<Int> { Set(AddedBoards.ids(from: AddedBoards.currentCSV)) }

    /// Selected board ids, intersected with the added boards. The explicit
    /// `noneToken` means none (empty). Everything else — `""` or a stored list
    /// that no longer matches any *added* board (e.g. the board was removed) —
    /// falls back to all, so a stale selection can never strand an empty logbook.
    static func selected(from csv: String) -> Set<Int> {
        let added = addedIDs
        if csv == noneToken { return [] }
        let ids = Set(csv.split(separator: "|").compactMap { Int($0) }).intersection(added)
        return ids.isEmpty ? added : ids
    }

    static func csv(from ids: Set<Int>) -> String {
        if ids.isEmpty { return noneToken }           // deliberate all-off
        if ids.count >= addedIDs.count { return "" }  // covers all added → "all"
        return ids.sorted().map(String.init).joined(separator: "|")
    }

    /// Short summary for the menu label.
    static func label(from csv: String) -> String {
        let ids = selected(from: csv)
        if ids.isEmpty { return "No boards" }
        if ids.count >= addedIDs.count { return "All boards" }
        if ids.count == 1, let board = Board.all.first(where: { ids.contains($0.id) }) {
            return board.name
        }
        return "\(ids.count) boards"
    }
}

/// A horizontal row of filter pills bound to the shared `BoardFilter` selection —
/// one pill per *added* board, highlighted when included. By default (never
/// filtered) all added boards are selected, so every pill starts highlighted.
/// Tapping a pill toggles that board; deselecting the last one falls back to all
/// (never show nothing). Observes `AddedBoards` so it tracks added/removed boards.
struct BoardFilterPills: View {
    @AppStorage(BoardFilter.storageKey) private var csv = ""
    @AppStorage(AddedBoards.storageKey) private var addedCSV = ""

    private var selected: Set<Int> { BoardFilter.selected(from: csv) }
    private var addedBoards: [Board] { AddedBoards.boards(from: addedCSV) }
    /// Any board selected means the logbook is showing something; none selected is
    /// the deliberate all-off / empty state.
    private var hasSelection: Bool { !selected.isEmpty }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                // Leading filter marker: filled when at least one board is shown,
                // outline when nothing is selected (the empty logbook).
                Image(systemName: hasSelection ? "line.3.horizontal.decrease.circle.fill"
                                                : "line.3.horizontal.decrease.circle")
                    .foregroundStyle(Color.accentColor)
                ForEach(addedBoards) { board in
                    pill(title: board.name, isOn: selected.contains(board.id)) {
                        toggle(board.id)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func pill(title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(isOn ? Color.primary : Color.secondary)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(isOn ? AnyShapeStyle(Color.accentColor.opacity(0.15))
                                 : AnyShapeStyle(Color(.secondarySystemFill)),
                            in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func toggle(_ id: Int) {
        var ids = selected
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
        csv = BoardFilter.csv(from: ids)  // all-off is allowed → empty logbook
    }
}
