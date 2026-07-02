import SwiftUI

/// The "Configure board" sheet: a single place to manage your boards. It lists the
/// boards you've already added (tap to edit, or use the "Edit" toggle to reveal
/// inline Edit/Delete) above a pick list of the supported boards you haven't added
/// yet. Adding is still a two-step drill-down — pick a board, configure it (angle +
/// installed hold sets), then confirm — which pops back to this list. Presented as a
/// sheet from Home. Per-board angle/hold-set settings are written live during
/// configuration (harmless if you cancel; remembered if you re-add later); the
/// board's membership in `AddedBoards` is what's committed on confirm.
struct AddBoardFlow: View {
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default
    @AppStorage(AddedBoards.storageKey) private var addedCSV = ""
    /// Flips the added rows into inline Edit/Delete mode (swipe still works too).
    @State private var isEditing = false

    @Environment(\.dismiss) private var dismiss

    private var addedBoards: [Board] { AddedBoards.boards(from: addedCSV) }
    private var availableBoards: [Board] { AddedBoards.available(from: addedCSV) }

    var body: some View {
        NavigationStack {
            List {
                if !addedBoards.isEmpty {
                    Section("Your boards") {
                        ForEach(addedBoards) { board in
                            BoardRow(board: board, isActive: activeBoardId == board.id,
                                     isEditing: isEditing,
                                     tapOpensEditor: true,
                                     onTap: {},
                                     onDelete: { delete(board) })
                        }
                    }
                }

                if !availableBoards.isEmpty {
                    Section {
                        ForEach(availableBoards) { board in
                            NavigationLink {
                                ConfigureStep(board: board, onAdd: add)
                            } label: {
                                AddBoardRow(board: board)
                            }
                        }
                    } header: {
                        Text("Add a board")
                    } footer: {
                        Text("Pick the board you have. You can add more later.")
                    }
                }
            }
            .navigationTitle("Configure board")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                if !addedBoards.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(isEditing ? "Done" : "Edit") {
                            withAnimation { isEditing.toggle() }
                        }
                    }
                }
            }
        }
    }

    /// Commit a board chosen in the add flow: add it to the front of the MRU order.
    /// The first board added becomes active; later adds leave the active board
    /// unchanged. The sheet stays open (the configure step pops back to this list),
    /// so the board simply moves from "Add a board" up into "Your boards".
    private func add(_ board: Board) {
        let wasEmpty = AddedBoards.ids(from: addedCSV).isEmpty
        addedCSV = AddedBoards.promoting(board.id, in: addedCSV)
        if wasEmpty { activeBoardId = board.id }
    }

    /// Remove a board from the added set. Logged ascents are untouched — the logbook
    /// keeps rendering them via `CatalogIndex`, they just lose their filter pill. If
    /// the removed board was active, reassign to the most-recently-used remaining
    /// board (the front of the MRU order).
    private func delete(_ board: Board) {
        var ids = AddedBoards.ids(from: addedCSV)
        ids.removeAll { $0 == board.id }
        addedCSV = AddedBoards.csv(from: ids)
        if activeBoardId == board.id, let next = ids.first {
            activeBoardId = next
        }
        // If nothing's left to edit, drop back out of edit mode.
        if ids.isEmpty { isEditing = false }
    }
}

/// The configure step of the add flow: the shared board settings form with an
/// "Add board" commit button. Pushed onto the pick screen's navigation stack;
/// confirming adds the board and pops back to the Configure list.
private struct ConfigureStep: View {
    let board: Board
    let onAdd: (Board) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            BoardConfigForm(board: board)
        }
        .navigationTitle(board.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add board") {
                    onAdd(board)
                    dismiss()
                }
                .fontWeight(.semibold)
            }
        }
    }
}

/// A board in the pick list: layer-rendered thumbnail (all filterable hold sets
/// shown, since nothing's configured yet) + name and angle summary.
private struct AddBoardRow: View {
    let board: Board

    private var subtitle: String {
        board.hasAngleChoice ? "\(board.angles.map { "\($0)°" }.joined(separator: " / "))" : "\(board.defaultAngle)°"
    }

    var body: some View {
        HStack(spacing: 12) {
            BoardImageView(setup: board.setup,
                           visibleHoldSetIDs: Set(board.filterableHoldSets.map(\.id)))
                .frame(width: 72)
                .allowsHitTesting(false)
            VStack(alignment: .leading, spacing: 6) {
                Text(board.name)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
