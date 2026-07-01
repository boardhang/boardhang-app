import SwiftUI

/// The Settings tab: board configuration and tools that used to live in the
/// home screen's overflow menu — LED test/calibration, clear board, and the
/// orientation / beta display toggles.
struct SettingsView: View {
    @EnvironmentObject private var ble: MoonBoardBLEManager
    @AppStorage("appAppearance") private var appearance: AppAppearance = .system
    @AppStorage("boardOrientationFlipped") private var flipped = false
    @AppStorage("showBeta") private var showBeta = true
    @AppStorage("autoLightOnSwipe") private var autoLightOnSwipe = false
    @AppStorage("showClimbPreviews") private var showClimbPreviews = true

    @State private var showingTest = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Display") {
                    Picker("Appearance", selection: $appearance) {
                        ForEach(AppAppearance.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Toggle("Flip board orientation", isOn: $flipped)
                    Toggle("Show beta", isOn: $showBeta)
                    Toggle("Show climb previews", isOn: $showClimbPreviews)
                }

                Section {
                    Toggle("Auto-light on swipe", isOn: $autoLightOnSwipe)
                } footer: {
                    Text("When browsing problems, automatically light each one on the board as you swipe to it.")
                }

                Section("Board") {
                    Button { showingTest = true } label: {
                        Label("LED Test / Calibration", systemImage: "lightbulb")
                    }
                    Button { ble.clear() } label: {
                        Label("Clear Board", systemImage: "lightbulb.slash")
                    }
                    .disabled(!ble.isConnected)
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showingTest) {
                LEDTestView()
            }
        }
    }
}
