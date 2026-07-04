import SwiftUI
import SwiftData

/// A live view of the problems you've favorited — the heart button in the catalog
/// (`CatalogProblemDetailView.toggleFavorite`) is the only writer, so this list stays in
/// sync automatically. Favorites are local (`FavoriteProblem`) and can span boards, so
/// each id is resolved via `CatalogIndex`.
///
/// The page filters by board, defaulting to the active board (the one the Search tab is
/// browsing). When favorites exist on more than one board, a multi-select pill row (styled
/// like the catalog's filter chips) lets you add/remove boards; clearing every pill shows
/// all boards' favorites. Tapping a problem opens the standard pager scoped to that
/// problem's board (source `.logbook`, so it doesn't record a "recently viewed" entry).
struct FavoritesView: View {
    @Query private var favorites: [FavoriteProblem]
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default

    /// Boards the user has explicitly toggled. `nil` = untouched (follow the default =
    /// active board). An empty set means "all boards" (every pill cleared).
    @State private var selectedBoardIds: Set<Int>?
    @State private var selected: CatalogProblem?
    @State private var pagerBoard: Board = .mini2025
    @State private var pagerProblems: [CatalogProblem] = []

    /// All favorites resolved to (board, problem), dropping ids that no longer resolve.
    private var allEntries: [CatalogIndex.Entry] {
        favorites.compactMap { CatalogIndex.entry(forCatalogID: $0.catalogID) }
    }

    /// Boards (in canonical registry order) that have at least one favorite — the pills.
    private var boardsWithFavorites: [Board] {
        let ids = Set(allEntries.map(\.board.id))
        return Board.all.filter { ids.contains($0.id) }
    }

    /// Default selection when the user hasn't touched a pill: the active board if it has
    /// favorites, else the first board that does (else empty when there are no favorites).
    private var defaultSelection: Set<Int> {
        if boardsWithFavorites.contains(where: { $0.id == activeBoardId }) { return [activeBoardId] }
        if let first = boardsWithFavorites.first?.id { return [first] }
        return []
    }

    /// The boards currently filtered on. Empty = no board filter (show all).
    private var selection: Set<Int> { selectedBoardIds ?? defaultSelection }

    /// Favorites for the current selection, or all favorites when nothing is selected.
    private var shownEntries: [CatalogIndex.Entry] {
        let sel = selection
        guard !sel.isEmpty else { return allEntries }
        return allEntries.filter { sel.contains($0.board.id) }
    }

    var body: some View {
        Group {
            if allEntries.isEmpty {
                ContentUnavailableView {
                    Label("No favorites yet", systemImage: "heart")
                } description: {
                    Text("Tap the heart on any problem in the catalog to save it here.")
                }
            } else {
                VStack(spacing: 0) {
                    if boardsWithFavorites.count > 1 {
                        boardPills
                    }
                    List(shownEntries, id: \.problem.id) { entry in
                        Button {
                            // Freeze the swipe set to this problem's board at tap time.
                            pagerBoard = entry.board
                            pagerProblems = shownEntries
                                .filter { $0.board.id == entry.board.id }
                                .map(\.problem)
                            selected = entry.problem
                        } label: {
                            CatalogProblemRow(
                                problem: entry.problem,
                                isFavorite: true,
                                showPreview: true,
                                setup: entry.board.setup
                            )
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .navigationTitle("Favorites")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $selected) { problem in
            CatalogProblemPager(problems: pagerProblems, current: problem,
                                board: pagerBoard, source: .logbook)
        }
    }

    /// A horizontally-scrolling row of multi-select board pills, styled like the catalog's
    /// filter chips (accent when on, gray when off). Shown only when favorites span more
    /// than one board. Toggling is additive; clearing them all shows every board.
    private var boardPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(boardsWithFavorites) { board in
                    boardPill(board)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }

    private func boardPill(_ board: Board) -> some View {
        let on = selection.contains(board.id)
        return Button {
            var next = selection
            if next.contains(board.id) { next.remove(board.id) } else { next.insert(board.id) }
            selectedBoardIds = next
        } label: {
            Text(board.shortName)
                .font(.caption.weight(.medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(on ? Color.accentColor : Color(.systemGray5), in: Capsule())
                .foregroundStyle(on ? .white : .primary)
        }
        .buttonStyle(.plain)
    }
}
