import SwiftUI

/// Shared, persisted "which boards to include" selection, used by both the
/// logbook and the home grade pyramid. Stored as a "|"-joined list of layout ids
/// in `@AppStorage(BoardFilter.storageKey)`; empty = all boards.
enum BoardFilter {
    static let storageKey = "logbookBoardFilter"

    private static var allIDs: Set<Int> { Set(Board.all.map(\.id)) }

    /// Selected board ids. Empty stored string → all boards.
    static func selected(from csv: String) -> Set<Int> {
        let ids = Set(csv.split(separator: "|").compactMap { Int($0) }).intersection(allIDs)
        return ids.isEmpty ? allIDs : ids
    }

    static func csv(from ids: Set<Int>) -> String {
        if ids.count >= Board.all.count { return "" }
        return ids.sorted().map(String.init).joined(separator: "|")
    }

    /// Short summary for the menu label.
    static func label(from csv: String) -> String {
        let ids = selected(from: csv)
        if ids.count >= Board.all.count { return "All boards" }
        if ids.count == 1, let board = Board.all.first(where: { ids.contains($0.id) }) {
            return board.name
        }
        return "\(ids.count) boards"
    }
}

/// A multiselect menu that toggles which boards are included, bound to the shared
/// `BoardFilter` selection. Deselecting the last board falls back to all boards.
struct BoardFilterMenu: View {
    @AppStorage(BoardFilter.storageKey) private var csv = ""

    var body: some View {
        Menu {
            ForEach(Board.all) { board in
                let selected = BoardFilter.selected(from: csv)
                Button { toggle(board.id, in: selected) } label: {
                    if selected.contains(board.id) {
                        Label(board.name, systemImage: "checkmark")
                    } else {
                        Text(board.name)
                    }
                }
            }
        } label: {
            Label(BoardFilter.label(from: csv), systemImage: "line.3.horizontal.decrease.circle")
                .font(.subheadline)
        }
    }

    private func toggle(_ id: Int, in selected: Set<Int>) {
        var ids = selected
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
        if ids.isEmpty { ids = Set(Board.all.map(\.id)) }  // never show nothing
        csv = BoardFilter.csv(from: ids)
    }
}
