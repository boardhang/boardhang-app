import SwiftUI

/// App shell: a bottom tab bar with Home (boards + logbook) and Settings.
struct RootTabView: View {
    @AppStorage("appAppearance") private var appearance: AppAppearance = .system

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Home", systemImage: "house.fill") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .preferredColorScheme(appearance.colorScheme)
    }
}
