import SwiftUI

/// Calibration screen: step an LED along the strip and confirm it lights the hold
/// the app expects. If the physical board lights the opposite hold, flip the
/// orientation. This validates the serpentine mapping against the real wiring.
///
/// Each board is calibrated independently: pick the board, and the LED count,
/// mapping and flip all reflect that board (flip persists to its per-board key).
struct LEDTestView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var ble: MoonBoardBLEManager

    @State private var selectedBoard: Board = .mini2025
    @State private var flipped = false
    @State private var ledIndex = 0

    private var maxLED: Int { BoardGeometry.totalLEDs(rows: selectedBoard.rows) - 1 }

    private var expected: (col: Int, row: Int)? {
        BoardGeometry.position(forLED: ledIndex, rows: selectedBoard.rows, flipped: flipped)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if Board.all.count > 1 {
                    Picker("Board", selection: $selectedBoard) {
                        ForEach(Board.all) { Text($0.name).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                }

                Text("LED \(ledIndex) of \(maxLED)")
                    .font(.title2.weight(.semibold))

                if let p = expected {
                    Text("Expected hold: \(BoardGeometry.columnLabel(p.col))\(p.row)")
                        .foregroundStyle(.secondary)
                }

                BoardImageView(setup: selectedBoard.setup, highlight: expected)
                    .frame(maxHeight: 360)
                    .padding(.horizontal, 8)

                Stepper("LED index: \(ledIndex)", value: $ledIndex, in: 0...maxLED)
                    .onChange(of: ledIndex) { _, new in ble.lightSingleLED(new) }
                    .padding(.horizontal)

                Toggle("Board wired from opposite end (flip)", isOn: $flipped)
                    .onChange(of: flipped) { _, newValue in
                        UserDefaults.standard.set(newValue, forKey: selectedBoard.flippedKey)
                        ble.lightSingleLED(ledIndex)
                    }
                    .padding(.horizontal)

                if !ble.isConnected {
                    Text("Connect to the board first to see the LEDs.")
                        .font(.caption).foregroundStyle(.secondary)
                }

                Spacer()
            }
            .padding(.top)
            .navigationTitle("LED Test")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { ble.clear(); dismiss() }
                }
            }
            .onAppear {
                flipped = UserDefaults.standard.bool(forKey: selectedBoard.flippedKey)
                if ble.isConnected { ble.lightSingleLED(ledIndex) }
            }
            .onChange(of: selectedBoard) { _, board in
                flipped = UserDefaults.standard.bool(forKey: board.flippedKey)
                if ledIndex > maxLED { ledIndex = maxLED }
                if ble.isConnected { ble.lightSingleLED(ledIndex) }
            }
        }
    }
}
