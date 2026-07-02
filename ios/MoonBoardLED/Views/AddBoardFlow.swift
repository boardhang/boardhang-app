import SwiftUI

/// Two-step onboarding for adding a board: pick one of the supported boards you
/// haven't added yet, then configure it (angle + installed hold sets) before
/// committing. Presented as a sheet from Home. Only tapping "Add board" on the
/// configure step actually adds the board — backing out adds nothing. The per-board
/// angle/hold-set settings are written live during configuration (harmless if you
/// cancel; remembered if you re-add later); the board's membership in
/// `AddedBoards` is what's committed on confirm.
struct AddBoardFlow: View {
    /// The boards not yet added, in registry order.
    let available: [Board]
    /// Commit a chosen, configured board. The caller updates `AddedBoards` and
    /// dismisses.
    let onAdd: (Board) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(available) { board in
                        NavigationLink {
                            ConfigureStep(board: board, onAdd: onAdd)
                        } label: {
                            AddBoardRow(board: board)
                        }
                    }
                } footer: {
                    Text("Pick the board you have. You can add more later.")
                }
            }
            .navigationTitle("Add board")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

/// The configure step of the add flow: the shared board settings form with an
/// "Add board" commit button. Pushed onto the pick screen's navigation stack.
private struct ConfigureStep: View {
    let board: Board
    let onAdd: (Board) -> Void

    var body: some View {
        Form {
            BoardConfigForm(board: board)
        }
        .navigationTitle(board.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add board") { onAdd(board) }
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
