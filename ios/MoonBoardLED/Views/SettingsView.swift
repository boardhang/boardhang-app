import SwiftUI

/// The Settings tab: board configuration and tools that used to live in the
/// home screen's overflow menu — LED test/calibration, clear board, and the
/// orientation / beta display toggles.
struct SettingsView: View {
    @EnvironmentObject private var ble: MoonBoardBLEManager
    @AppStorage("appAppearance") private var appearance: AppAppearance = .system
    @AppStorage("autoLightOnSwipe") private var autoLightOnSwipe = false
    @AppStorage("showClimbPreviews") private var showClimbPreviews = true

    @State private var showingConnection = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Display") {
                    Picker("Appearance", selection: $appearance) {
                        ForEach(AppAppearance.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    // "Show beta" is hidden for now: no bundled catalog uses
                    // left/match holds, so there's no beta to show. The `showBeta`
                    // setting (default on) still drives BoardImageView — restore
                    // this toggle once problems with real beta ship.
                    Toggle("Show climb previews", isOn: $showClimbPreviews)
                }

                Section {
                    Toggle("Auto-light on swipe", isOn: $autoLightOnSwipe)
                } footer: {
                    Text("When browsing problems, automatically light each one on the board as you swipe to it.")
                }

                Section {
                    // The LED link is global (not per-board). Tapping opens the
                    // scan/connect sheet, which hosts calibration when connected.
                    Button { showingConnection = true } label: {
                        HStack {
                            Text("LED")
                                .foregroundStyle(.primary)
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                HStack(spacing: 6) {
                                    Circle()
                                        .fill(ble.isConnected ? Color.blue : Color.gray)
                                        .frame(width: 8, height: 8)
                                    Text(ble.isConnected ? "Connected" : "Not connected")
                                        .font(.caption)
                                        .foregroundStyle(ble.isConnected ? Color.blue : Color.secondary)
                                }
                                if ble.isConnected, let name = ble.connectedName {
                                    // Explicit gray, not a hierarchical style: inside a
                                    // tinted Button the latter picks up the accent (blue).
                                    Text(name)
                                        .font(.caption2)
                                        .foregroundStyle(Color.secondary)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Board")
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showingConnection) {
                ConnectionView()
            }
        }
    }
}
