import SwiftUI

/// The configurable settings of a board — a live preview, an angle picker (for
/// boards with an angle choice), and the installed hold-set toggles — as a set of
/// `Form` sections. Shared by the board editor (`HoldSetEditorView`) and the
/// add-board onboarding flow (`AddBoardFlow`), which each wrap it in their own
/// `Form` and navigation chrome. Changes persist to the board's `@AppStorage` keys
/// as they're made. At least one filterable set stays active. Feet-only sets (no
/// grid holds) aren't listed — they're always-on art and don't affect filtering.
struct BoardConfigForm: View {
    let board: Board
    @AppStorage private var activeCSV: String
    @AppStorage private var angle: Int

    init(board: Board) {
        self.board = board
        _activeCSV = AppStorage(wrappedValue: "", board.activeHoldSetsKey)
        _angle = AppStorage(wrappedValue: board.defaultAngle, board.angleKey)
    }

    private var active: Set<Int> { ActiveHoldSets.ids(from: activeCSV, in: board) }

    var body: some View {
        Section {
            BoardImageView(setup: board.setup,
                           visibleHoldSetIDs: ActiveHoldSets.visible(active, in: board))
                .frame(maxHeight: 320)
                .frame(maxWidth: .infinity)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .padding(.vertical, 8)
        }

        if board.hasAngleChoice {
            Section {
                Picker("Angle", selection: $angle) {
                    ForEach(board.angles, id: \.self) { Text("\($0)°").tag($0) }
                }
                .pickerStyle(.segmented)
            } header: {
                Text("Angle")
            } footer: {
                Text("The wall angle this board is set at. Switches which catalog is shown.")
            }
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

/// Edit which hold sets are installed on an already-added board (and its angle). A
/// live board preview shows only the active sets (plus always-on feet art);
/// changes persist as they're made. Opened from swipe-to-edit on a board row.
struct HoldSetEditorView: View {
    let board: Board
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var ble: MoonBoardBLEManager
    /// Presents the scan/connect sheet — the same one the problem screen's
    /// lightbulb opens when the LED isn't connected yet.
    @State private var showingConnection = false

    var body: some View {
        NavigationStack {
            Form {
                BoardConfigForm(board: board)

                Section {
                    if ble.isConnected {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text(ble.connectedName ?? "Connected")
                            Spacer()
                            Button("Disconnect", role: .destructive) { ble.disconnect() }
                                .font(.caption)
                        }
                    } else {
                        Button {
                            showingConnection = true
                        } label: {
                            Label("Connect LED", systemImage: "lightbulb")
                        }
                    }
                } header: {
                    Text("LED")
                } footer: {
                    Text("Connect to the board's LED controller to light up problems.")
                }
            }
            .navigationTitle(board.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showingConnection) {
                ConnectionView()
            }
        }
    }
}
