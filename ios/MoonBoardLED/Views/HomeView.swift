import SwiftUI
import SwiftData

/// The Home tab: a "Boards" section (one row per *added* board, entry to that
/// board's catalog, plus an add-board affordance) and a "Logbook" section (grade
/// pyramid + latest sessions), both filtered by the shared board filter.
/// Connecting to the board happens from the lightbulb on the problem detail screen.
struct HomeView: View {
    @Query(sort: \Ascent.date, order: .reverse) private var ascents: [Ascent]
    @AppStorage(BoardFilter.storageKey) private var boardFilterCSV = ""
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default
    @AppStorage(AddedBoards.storageKey) private var addedCSV = ""
    /// Presents the two-step add-board flow.
    @State private var addingBoard = false
    /// Lets a board tap jump to the Search tab (which browses the active board).
    @Environment(TabRouter.self) private var router

    private var addedBoards: [Board] { AddedBoards.boards(from: addedCSV) }
    private var availableBoards: [Board] { AddedBoards.available(from: addedCSV) }

    private var filteredAscents: [Ascent] {
        let selected = BoardFilter.selected(from: boardFilterCSV)
        return ascents.filter { selected.contains($0.effectiveBoardLayoutId) }
    }
    private var sessions: [LogSession] { LogSession.sessions(from: filteredAscents) }
    private var latestSessions: [LogSession] { Array(sessions.prefix(3)) }

    var body: some View {
        NavigationStack {
            List {
                Section("My boards") {
                    if addedBoards.isEmpty {
                        ContentUnavailableView {
                            Label("No boards yet", systemImage: "square.grid.3x3")
                        } description: {
                            Text("Add a board to browse problems and track ascents.")
                        }
                        Button {
                            addingBoard = true
                        } label: {
                            Label("Add board", systemImage: "plus.circle")
                        }
                    } else {
                        // The two most recently used boards; the rest live behind
                        // "Show all".
                        ForEach(addedBoards.prefix(2)) { board in
                            BoardRow(board: board, isActive: activeBoardId == board.id,
                                     onTap: { activate(board) },
                                     onDelete: { delete(board) })
                        }

                        if addedBoards.count > 2 {
                            NavigationLink {
                                AllBoardsView()
                            } label: {
                                Label("Show all", systemImage: "square.grid.2x2")
                            }
                        }

                        // Shown until every supported board has been added.
                        if !availableBoards.isEmpty {
                            Button {
                                addingBoard = true
                            } label: {
                                Label("Add board", systemImage: "plus.circle")
                            }
                        }
                    }
                }

                Section {
                    // When the current board filter has no ascents, show the empty
                    // state where the pyramid would be (no empty chart). The filter
                    // pills always render, so you can switch back to a board with
                    // ascents.
                    if filteredAscents.isEmpty {
                        if BoardFilter.selected(from: boardFilterCSV).isEmpty {
                            ContentUnavailableView {
                                Label("No boards selected", systemImage: "square.grid.3x3")
                            } description: {
                                Text("Tap a board below to see its ascents.")
                            }
                        } else {
                            ContentUnavailableView {
                                Label("No ascents yet", systemImage: "book.closed")
                            } description: {
                                Text("Log an ascent from a problem to start your logbook.")
                            }
                        }
                    } else if filteredAscents.contains(where: \.sent) {
                        GradePyramidView(ascents: filteredAscents)
                            .listRowInsets(EdgeInsets(top: 20, leading: 12, bottom: 12, trailing: 12))
                    }

                    // Only worth filtering when there's more than one board.
                    if addedBoards.count > 1 {
                        BoardFilterPills()
                            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    }

                    if !filteredAscents.isEmpty {
                        ForEach(latestSessions) { session in
                            NavigationLink {
                                LogbookView(anchorDay: session.day)
                            } label: {
                                Text(session.title)
                            }
                        }

                        NavigationLink {
                            LogbookView()
                        } label: {
                            Text("See all").foregroundStyle(Color.accentColor)
                        }
                    }
                } header: {
                    Text("Logbook")
                }
            }
            .navigationTitle("")
            .sheet(isPresented: $addingBoard) {
                AddBoardFlow(available: availableBoards, onAdd: add)
            }
            // Warm each added board's catalog in the background while Home is on
            // screen, so tapping a board opens its list instantly instead of showing
            // a parse spinner. No-op once the caches are warm.
            .task(id: addedCSV) {
                for board in addedBoards {
                    for angle in board.angles {
                        Catalog.preload(resource: board.catalogResource(angle: angle))
                    }
                }
            }
        }
    }

    /// Activate a board (making it the one Search browses) and jump to the Search
    /// tab, which shows that board's catalog. Moves it to the front of the
    /// most-recently-used order so Home surfaces it.
    private func activate(_ board: Board) {
        addedCSV = AddedBoards.promoting(board.id, in: addedCSV)
        activeBoardId = board.id
        router.selection = .search
        // Always land on the list, even when re-tapping the already-active board
        // (no `.id` rebuild happens then, so signal the live catalog to pop).
        router.listResetToken += 1
    }

    /// Commit a board chosen in the add flow: add it to the front of the MRU order
    /// and dismiss the sheet. The first board added becomes active; later adds leave
    /// the active board unchanged.
    private func add(_ board: Board) {
        let wasEmpty = AddedBoards.ids(from: addedCSV).isEmpty
        addedCSV = AddedBoards.promoting(board.id, in: addedCSV)
        if wasEmpty { activeBoardId = board.id }
        addingBoard = false
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
    }
}

/// The full list of the user's added boards, pushed from Home's "Show all boards".
/// Same per-row behavior as Home (tap to activate + open catalog, swipe to edit or
/// delete) with no 2-board cap, plus its own "Add board" affordance.
struct AllBoardsView: View {
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default
    @AppStorage(AddedBoards.storageKey) private var addedCSV = ""
    @State private var addingBoard = false
    @State private var isEditing = false
    @Environment(TabRouter.self) private var router

    private var addedBoards: [Board] { AddedBoards.boards(from: addedCSV) }
    private var availableBoards: [Board] { AddedBoards.available(from: addedCSV) }

    var body: some View {
        List {
            Section {
                ForEach(addedBoards) { board in
                    BoardRow(board: board, isActive: activeBoardId == board.id,
                             isEditing: isEditing,
                             onTap: { activate(board) },
                             onDelete: { delete(board) })
                }

                if !availableBoards.isEmpty {
                    Button {
                        addingBoard = true
                    } label: {
                        Label("Add board", systemImage: "plus.circle")
                    }
                }
            }
        }
        .navigationTitle("My boards")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $addingBoard) {
            AddBoardFlow(available: availableBoards, onAdd: add)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(isEditing ? "Done" : "Edit") {
                    withAnimation { isEditing.toggle() }
                }
            }
        }
    }

    private func activate(_ board: Board) {
        addedCSV = AddedBoards.promoting(board.id, in: addedCSV)
        activeBoardId = board.id
        router.selection = .search
        // Always land on the list (see HomeView.activate).
        router.listResetToken += 1
    }

    private func add(_ board: Board) {
        let wasEmpty = AddedBoards.ids(from: addedCSV).isEmpty
        addedCSV = AddedBoards.promoting(board.id, in: addedCSV)
        if wasEmpty { activeBoardId = board.id }
        addingBoard = false
    }

    private func delete(_ board: Board) {
        var ids = AddedBoards.ids(from: addedCSV)
        ids.removeAll { $0 == board.id }
        addedCSV = AddedBoards.csv(from: ids)
        if activeBoardId == board.id, let next = ids.first {
            activeBoardId = next
        }
    }
}

/// One board in the Boards section: layer-rendered thumbnail (reflecting the
/// board's active hold sets), name, an "active hold sets · angle" subtitle, and an
/// "Active" marker. Tapping the row body activates the board and opens its catalog;
/// swipe reveals Edit (angle + hold sets) and Delete (remove from added boards).
private struct BoardRow: View {
    let board: Board
    let isActive: Bool
    /// When true, the row surfaces inline Edit/Delete buttons (driven by the "My
    /// boards" screen's Edit toggle) and stops activating on tap.
    let isEditing: Bool
    let onTap: () -> Void
    let onDelete: () -> Void
    @AppStorage private var activeCSV: String
    @AppStorage private var angle: Int
    @State private var showingEditor = false

    init(board: Board, isActive: Bool, isEditing: Bool = false,
         onTap: @escaping () -> Void, onDelete: @escaping () -> Void) {
        self.board = board
        self.isActive = isActive
        self.isEditing = isEditing
        self.onTap = onTap
        self.onDelete = onDelete
        _activeCSV = AppStorage(wrappedValue: "", board.activeHoldSetsKey)
        _angle = AppStorage(wrappedValue: board.defaultAngle, board.angleKey)
    }

    private var active: Set<Int> { ActiveHoldSets.ids(from: activeCSV, in: board) }
    private var renderIDs: Set<Int> { ActiveHoldSets.visible(active, in: board) }
    private var subtitle: String {
        let sets = ActiveHoldSets.subtitle(active, in: board)
        return board.hasAngleChoice ? "\(sets) · \(angle)°" : sets
    }

    var body: some View {
        HStack(spacing: 12) {
            BoardImageView(setup: board.setup, visibleHoldSetIDs: renderIDs)
                .frame(width: 72)
                .allowsHitTesting(false)
            VStack(alignment: .leading, spacing: 6) {
                // The active board — Search browses this one. Tap any row to switch.
                if isActive {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(.green)
                            .frame(width: 6, height: 6)
                        Text("Active")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.green)
                    }
                }
                Text(board.name)
                    .fontWeight(isActive ? .semibold : .regular)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if isEditing {
                // Edit mode surfaces the swipe actions as tappable buttons.
                HStack(spacing: 16) {
                    Button { showingEditor = true } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                    .tint(.accentColor)
                    Button(role: .destructive, action: onDelete) {
                        Image(systemName: "trash")
                    }
                    .tint(.red)
                }
                .buttonStyle(.borderless)
                .font(.body)
            } else {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        // Row body activates the board + opens its catalog (disabled while editing).
        .contentShape(Rectangle())
        .onTapGesture { if !isEditing { onTap() } }
        // Swipe to edit the board (angle + installed hold sets) or delete it.
        .swipeActions(edge: .trailing) {
            Button(role: .destructive, action: onDelete) {
                Label("Delete", systemImage: "trash")
            }
            Button {
                showingEditor = true
            } label: {
                Label("Edit", systemImage: "slider.horizontal.3")
            }
            .tint(.accentColor)
        }
        .sheet(isPresented: $showingEditor) {
            HoldSetEditorView(board: board)
        }
    }
}
