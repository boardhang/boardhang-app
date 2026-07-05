import SwiftUI
import SwiftData

/// A live view of the problems you've favorited — the heart button in the catalog
/// (`CatalogProblemDetailView.toggleFavorite`) is the only writer, so this list stays in
/// sync automatically. Favorites are local (`FavoriteProblem`, catalog id only), so each
/// id's board is derived via `CatalogIndex`.
///
/// The page is hard-scoped to the active board (the one the Search tab is browsing) — only
/// that board's favorites show, no cross-board mixing. To see another board's favorites,
/// switch the active board on the Home tab. Tapping a problem opens the standard pager
/// scoped to the active board (source `.logbook`, so it doesn't record a "recently viewed"
/// entry).
struct FavoritesView: View {
    @Query private var favorites: [FavoriteProblem]
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default

    @State private var selected: CatalogProblem?

    private var activeBoard: Board { Board.with(layoutId: activeBoardId) }

    /// Favorites on the active board only, resolved to (board, problem); ids that no longer
    /// resolve or belong to another board are dropped.
    private var shownEntries: [CatalogIndex.Entry] {
        favorites
            .compactMap { CatalogIndex.entry(forCatalogID: $0.catalogID) }
            .filter { $0.board.id == activeBoardId }
    }

    var body: some View {
        Group {
            if shownEntries.isEmpty {
                ContentUnavailableView {
                    Label("No favorites yet", systemImage: "heart")
                } description: {
                    Text("Tap the heart on any problem in the catalog to save it here.")
                }
            } else {
                List(shownEntries, id: \.problem.id) { entry in
                    Button {
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
        .navigationTitle("Favorites")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $selected) { problem in
            CatalogProblemPager(problems: shownEntries.map(\.problem), current: problem,
                                board: activeBoard, source: .logbook)
        }
    }
}
