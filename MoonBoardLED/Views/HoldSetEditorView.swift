import SwiftUI

/// Edit which hold sets are installed on a board. A live board preview shows only
/// the active sets (plus always-on feet art); toggling a set updates it live.
/// Changes persist to the board's `@AppStorage` key as they're made. At least one
/// filterable set stays active. Feet-only sets (no grid holds) aren't listed —
/// they're always-on art and don't affect problem filtering.
struct HoldSetEditorView: View {
    let board: Board
    @AppStorage private var activeCSV: String
    @Environment(\.dismiss) private var dismiss

    init(board: Board) {
        self.board = board
        _activeCSV = AppStorage(wrappedValue: "", board.activeHoldSetsKey)
    }

    private var active: Set<Int> { ActiveHoldSets.ids(from: activeCSV, in: board) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    BoardImageView(setup: board.setup,
                                   visibleHoldSetIDs: ActiveHoldSets.visible(active, in: board))
                        .frame(maxHeight: 320)
                        .frame(maxWidth: .infinity)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        .padding(.vertical, 8)
                }

                Section {
                    ForEach(board.filterableHoldSets) { holdSet in
                        let isOn = active.contains(holdSet.id)
                        let isLast = isOn && active.count == 1
                        Button { toggle(holdSet.id) } label: {
                            HStack {
                                Text(holdSet.name).foregroundStyle(.primary)
                                Spacer()
                                if isOn {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                        .disabled(isLast)
                    }
                } header: {
                    Text("Installed hold sets")
                } footer: {
                    Text("Only problems you can climb with these hold sets are shown in the catalog. At least one set must stay active.")
                }
            }
            .navigationTitle("Hold Sets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func toggle(_ id: Int) {
        var ids = active
        if ids.contains(id) {
            guard ids.count > 1 else { return }  // keep at least one
            ids.remove(id)
        } else {
            ids.insert(id)
        }
        activeCSV = ActiveHoldSets.csv(from: ids, in: board)
    }
}
