import SwiftUI
import SwiftData

@main
struct MoonBoardApp: App {
    /// Explicit container so the logbook sync manager can share it (a background/main
    /// context off the same store). Same model set as before.
    let container: ModelContainer

    @StateObject private var ble = MoonBoardBLEManager()
    @StateObject private var auth = AuthManager()
    @StateObject private var sync: LogbookSyncManager
    @StateObject private var lists = ListsManager()

    init() {
        let container = try! ModelContainer(for: Problem.self, Ascent.self, FavoriteProblem.self)
        self.container = container
        _sync = StateObject(wrappedValue: LogbookSyncManager(container: container))
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(ble)
                .environmentObject(auth)
                .environmentObject(sync)
                .environmentObject(lists)
                // Magic-link / OAuth redirects return through the app's custom URL
                // scheme; hand them to the auth manager to complete sign-in.
                .onOpenURL { url in
                    Task { await auth.handleCallback(url: url) }
                }
        }
        .modelContainer(container)
    }
}
