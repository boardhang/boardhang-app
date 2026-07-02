import SwiftUI

/// App shell: a bottom tab bar with Home (boards + logbook), Settings, and Search
/// (the active board's catalog browser). Search is outermost right.
struct RootTabView: View {
    @AppStorage("appAppearance") private var appearance: AppAppearance = .system
    /// The board Search browses and Home marks active. Defaults to the Mini 2025
    /// (the physical board). Home writes it; Search reads it.
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default
    @AppStorage(AddedBoards.storageKey) private var addedCSV = ""
    /// Session-only selected tab. Held in a router so other screens (Home) can
    /// switch tabs — e.g. tapping a board jumps to Search.
    @State private var router = TabRouter()

    /// The board Search browses: the active board if it's still added, otherwise the
    /// first added board. `nil` when no boards have been added yet.
    private var activeBoard: Board? {
        let added = AddedBoards.boards(from: addedCSV)
        return added.first { $0.id == activeBoardId } ?? added.first
    }

    // Rebuild the search tab (and its nav stack + per-board angle) when the active
    // board changes. With no added boards, show an empty state pointing to Home.
    @ViewBuilder
    private var searchTab: some View {
        if let activeBoard {
            SearchTab(board: activeBoard)
                .id(activeBoard.id)
        } else {
            NavigationStack {
                ContentUnavailableView {
                    Label("No boards yet", systemImage: "square.grid.3x3")
                } description: {
                    Text("Add a board on the Home tab to browse problems.")
                }
            }
        }
    }

    var body: some View {
        @Bindable var router = router
        return Group {
            if #available(iOS 18.0, *) {
                TabView(selection: $router.selection) {
                    Tab("Home", systemImage: "house.fill", value: RootTab.home) {
                        HomeView()
                    }
                    Tab("Settings", systemImage: "gearshape.fill", value: RootTab.settings) {
                        SettingsView()
                    }
                    // The search role gives this tab its own detached slot
                    // (labelless, system magnifying-glass icon) instead of sitting
                    // inline with the rest.
                    Tab(value: RootTab.search, role: .search) {
                        searchTab
                    }
                }
            } else {
                TabView(selection: $router.selection) {
                    HomeView()
                        .tabItem { Label("Home", systemImage: "house.fill") }
                        .tag(RootTab.home)
                    SettingsView()
                        .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                        .tag(RootTab.settings)
                    searchTab
                        // No label — just the magnifying-glass icon.
                        .tabItem { Image(systemName: "magnifyingglass") }
                        .tag(RootTab.search)
                }
            }
        }
        .environment(router)
        .preferredColorScheme(appearance.colorScheme)
    }
}

/// The app's top-level tabs. File-scope so screens like Home can switch tabs.
enum RootTab: Hashable { case home, settings, search }

/// Session-only holder for the selected top-level tab, injected into the
/// environment so any screen can switch tabs (e.g. Home → Search on board tap).
/// Deliberately not persisted, so the app still launches on Home.
@Observable final class TabRouter {
    var selection: RootTab = .home
    /// Bumped to pop the Search tab back to its problem list (e.g. when a board
    /// is tapped while it's already the active board, so no `.id` rebuild fires).
    var listResetToken = 0
}

/// Namespacing for the active-board selection persisted in `@AppStorage`.
enum ActiveBoard {
    static let storageKey = "activeBoardId"
    static var `default`: Int { Board.mini2025.id }
}

/// Hosts the active board's catalog browser in the Search tab, tracking that
/// board's angle so the right catalog loads. Keyed by board id from the parent,
/// so switching the active board re-initialises it (and its angle @AppStorage).
private struct SearchTab: View {
    let board: Board
    @AppStorage private var angle: Int

    init(board: Board) {
        self.board = board
        _angle = AppStorage(wrappedValue: board.defaultAngle, board.angleKey)
    }

    var body: some View {
        NavigationStack {
            CatalogListView(board: board, angle: angle)
        }
    }
}
