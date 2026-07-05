import SwiftUI

/// A nav-bar control (placed in the `.principal` toolbar slot) that shows the active board
/// and lets the user re-scope it **in place** from a board-scoped surface (Search, Lists) —
/// without the Home board-tap's jump to the Search tab.
///
/// It writes the same `@AppStorage` keys `HomeView.activate` writes — `activeBoardId` plus the
/// MRU-promoted added-boards CSV — but deliberately *not* `TabRouter.selection`/`listResetToken`,
/// so the current screen rebuilds reactively and stays put. With 0–1 added boards there's
/// nothing to switch to, so it renders a plain title instead of a menu.
struct BoardSwitcher: View {
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default
    @AppStorage(AddedBoards.storageKey) private var addedCSV = ""
    @Environment(TabRouter.self) private var router

    private var addedBoards: [Board] { AddedBoards.boards(from: addedCSV) }
    private var activeBoard: Board { Board.with(layoutId: activeBoardId) }
    private var canSwitch: Bool { addedBoards.count > 1 }

    var body: some View {
        if canSwitch {
            Menu {
                ForEach(addedBoards) { board in
                    Button { select(board) } label: {
                        if board.id == activeBoardId {
                            Label(board.name, systemImage: "checkmark")
                        } else {
                            Text(board.name)
                        }
                    }
                }
                Divider()
                Button {
                    router.selection = .home
                } label: {
                    Label("Manage boards…", systemImage: "square.grid.2x2")
                }
            } label: {
                label
            }
        } else {
            // 0–1 boards: nothing to switch to — show a plain, non-interactive title.
            label
        }
    }

    private var label: some View {
        HStack(spacing: 4) {
            Text(activeBoard.name)
                .font(.headline)
            if canSwitch {
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
            }
        }
        .foregroundStyle(.primary)
    }

    /// Mirror of `HomeView.activate` minus the router jump: promote the board to MRU-front and
    /// make it active, letting the board-scoped screen rebuild in place.
    private func select(_ board: Board) {
        guard board.id != activeBoardId else { return }
        addedCSV = AddedBoards.promoting(board.id, in: addedCSV)
        activeBoardId = board.id
    }
}
