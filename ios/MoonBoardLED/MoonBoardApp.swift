import SwiftUI
import SwiftData

@main
struct MoonBoardApp: App {
    @StateObject private var ble = MoonBoardBLEManager()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(ble)
        }
        .modelContainer(for: [Problem.self, Ascent.self, FavoriteProblem.self])
    }
}
