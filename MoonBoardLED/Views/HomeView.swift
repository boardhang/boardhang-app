import SwiftUI
import SwiftData

/// The Home tab: a "Boards" section (one row per supported board, entry to that
/// board's catalog) and a "Logbook" section (grade pyramid + latest sessions),
/// both filtered by the shared board filter. Connecting to the board happens from
/// the lightbulb on the problem detail screen.
struct HomeView: View {
    @Query(sort: \Ascent.date, order: .reverse) private var ascents: [Ascent]
    @AppStorage(BoardFilter.storageKey) private var boardFilterCSV = ""
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default
    /// Tapping a board row makes it active *and* pushes its catalog.
    @State private var openBoard: Board?

    private var filteredAscents: [Ascent] {
        let selected = BoardFilter.selected(from: boardFilterCSV)
        return ascents.filter { selected.contains($0.boardLayoutId) }
    }
    private var sessions: [LogSession] { LogSession.sessions(from: filteredAscents) }
    private var latestSessions: [LogSession] { Array(sessions.prefix(3)) }

    var body: some View {
        NavigationStack {
            List {
                Section("Boards") {
                    ForEach(Board.all) { board in
                        BoardRow(board: board, isActive: activeBoardId == board.id) {
                            activeBoardId = board.id
                            openBoard = board
                        }
                    }
                }

                Section {
                    if filteredAscents.isEmpty {
                        ContentUnavailableView {
                            Label("No ascents yet", systemImage: "book.closed")
                        } description: {
                            Text("Log an ascent from a problem to start your logbook.")
                        }
                    } else {
                        if filteredAscents.contains(where: \.sent) {
                            GradePyramidView(ascents: filteredAscents)
                                .listRowInsets(EdgeInsets(top: 20, leading: 12, bottom: 12, trailing: 12))
                        }

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
                    HStack {
                        Text("Logbook")
                        Spacer()
                        BoardFilterMenu()
                    }
                }
            }
            .navigationTitle("")
            // Tapping a board row activates it and pushes its catalog. Angle is
            // read (non-reactively) from the board's stored setting.
            .navigationDestination(item: $openBoard) { board in
                let angle = (UserDefaults.standard.object(forKey: board.angleKey) as? Int) ?? board.defaultAngle
                CatalogListView(board: board, angle: angle)
            }
            // Warm each board's catalog in the background while Home is on screen,
            // so tapping a board opens its list instantly instead of showing a
            // parse spinner. No-op once the caches are warm.
            .task {
                for board in Board.all {
                    for angle in board.angles {
                        Catalog.preload(resource: board.catalogResource(angle: angle))
                    }
                }
            }
        }
    }
}

/// One board in the Boards section: layer-rendered thumbnail (reflecting the
/// board's active hold sets), name, an "active hold sets · angle" subtitle, an
/// inline angle switch for boards with multiple bundled angles, and swipe-to-edit
/// for its installed hold sets. Tapping the row opens that board's catalog.
private struct BoardRow: View {
    let board: Board
    let isActive: Bool
    let onTap: () -> Void
    @AppStorage private var activeCSV: String
    @AppStorage private var angle: Int
    @State private var showingEditor = false

    init(board: Board, isActive: Bool, onTap: @escaping () -> Void) {
        self.board = board
        self.isActive = isActive
        self.onTap = onTap
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
                if board.hasAngleChoice {
                    Picker("Angle", selection: $angle) {
                        ForEach(board.angles, id: \.self) { Text("\($0)°").tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 150)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        // Whole row is the hit target; the segmented angle picker still handles
        // its own taps.
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
        .swipeActions(edge: .trailing) {
            Button {
                showingEditor = true
            } label: {
                Label("Edit hold sets", systemImage: "square.stack.3d.up")
            }
            .tint(.accentColor)
        }
        .sheet(isPresented: $showingEditor) {
            HoldSetEditorView(board: board)
        }
    }
}
