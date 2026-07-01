import SwiftUI

/// App shell: a bottom tab bar with Home (boards + logbook), Settings, and Search
/// (the active board's catalog browser). Search is outermost right.
struct RootTabView: View {
    @AppStorage("appAppearance") private var appearance: AppAppearance = .system
    /// The board Search browses and Home marks active. Defaults to the Mini 2025
    /// (the physical board). Home writes it; Search reads it.
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default
    @State private var selection: TabID = .home

    private enum TabID: Hashable { case home, settings, search }

    private var activeBoard: Board { Board.with(layoutId: activeBoardId) }

    // Rebuild the search tab (and its nav stack + per-board angle) when the
    // active board changes.
    private var searchTab: some View {
        SearchTab(board: activeBoard)
            .id(activeBoard.id)
    }

    var body: some View {
        Group {
            if #available(iOS 18.0, *) {
                TabView(selection: $selection) {
                    Tab("Home", systemImage: "house.fill", value: TabID.home) {
                        HomeView()
                    }
                    Tab("Settings", systemImage: "gearshape.fill", value: TabID.settings) {
                        SettingsView()
                    }
                    // The search role gives this tab its own detached slot
                    // (labelless, system magnifying-glass icon) instead of sitting
                    // inline with the rest.
                    Tab(value: TabID.search, role: .search) {
                        searchTab
                    }
                }
            } else {
                TabView(selection: $selection) {
                    HomeView()
                        .tabItem { Label("Home", systemImage: "house.fill") }
                        .tag(TabID.home)
                    SettingsView()
                        .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                        .tag(TabID.settings)
                    searchTab
                        // No label — just the magnifying-glass icon.
                        .tabItem { Image(systemName: "magnifyingglass") }
                        .tag(TabID.search)
                }
            }
        }
        .preferredColorScheme(appearance.colorScheme)
    }
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
