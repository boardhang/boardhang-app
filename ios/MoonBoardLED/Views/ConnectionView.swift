import SwiftUI

/// Scan for and connect to the MoonBoard LED controller.
struct ConnectionView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var ble: MoonBoardBLEManager
    /// Presents the calibration screen full-screen (only offered when connected).
    @State private var showingTest = false

    var body: some View {
        NavigationStack {
            List {
                Section("Status") {
                    HStack {
                        Image(systemName: ble.isConnected ? "checkmark.circle.fill" : "circle.dashed")
                            .foregroundStyle(ble.isConnected ? .green : .secondary)
                        Text(ble.connectedName ?? ble.state.label)
                        Spacer()
                        if ble.isConnected {
                            Button("Disconnect", role: .destructive) { ble.disconnect() }
                                .font(.caption)
                        }
                    }

                    // Calibration only makes sense with a live link, so surface it
                    // here (below the divider) once connected rather than in Settings.
                    if ble.isConnected {
                        Button { showingTest = true } label: {
                            Text("LED Test / Calibration")
                        }
                    }
                }

                Section("Found boards") {
                    if ble.discovered.isEmpty {
                        Text("No boards found yet. Make sure the Arduino is powered and tap Scan.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(ble.discovered) { device in
                        Button {
                            ble.connect(device)
                        } label: {
                            HStack {
                                Text(device.name)
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Connect")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { ble.stopScan(); dismiss() }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button(ble.state == .scanning ? "Scanning…" : "Scan") { ble.startScan() }
                        .disabled(ble.state == .scanning)
                }
            }
            .onAppear { ble.startScan() }
            .onDisappear { ble.stopScan() }
            .fullScreenCover(isPresented: $showingTest) {
                LEDTestView()
            }
        }
    }
}
