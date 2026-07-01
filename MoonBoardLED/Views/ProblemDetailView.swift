import SwiftUI
import SwiftData

/// View a saved problem and light it up on the board.
struct ProblemDetailView: View {
    @EnvironmentObject private var ble: MoonBoardBLEManager
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @AppStorage("boardOrientationFlipped") private var flipped = false
    @AppStorage("showBeta") private var showBeta = true
    @AppStorage(ActiveHoldSets.miniStorageKey) private var activeHoldSetsCSV = ""
    @State private var showingEditor = false
    @State private var confirmingDelete = false
    @State private var showingLog = false
    /// Un-saved tries tapped via "Add try"; saved as an attempt on leaving.
    @State private var pendingTries = 0

    let problem: Problem

    private var activeHoldSets: Set<Int> {
        ActiveHoldSets.ids(from: activeHoldSetsCSV, in: .mini2025)
    }

    var body: some View {
        VStack(spacing: 12) {
            BoardImageView(setup: .mini2025, visibleHoldSetIDs: activeHoldSets,
                           holds: problem.holds, showBeta: showBeta)
                .padding(.horizontal, 8)

            Toggle("Show beta", isOn: $showBeta)
                .padding(.horizontal)
                .onChange(of: showBeta) { _, _ in
                    if ble.isConnected {
                        ble.send(holds: problem.holds, flipped: flipped, showBeta: showBeta)
                    }
                }

            HStack(spacing: 12) {
                Button {
                    ble.send(holds: problem.holds, flipped: flipped, showBeta: showBeta)
                } label: {
                    Label("Light up on board", systemImage: "lightbulb.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!ble.isConnected)

                Button {
                    ble.clear()
                } label: {
                    Label("Clear", systemImage: "lightbulb.slash")
                }
                .buttonStyle(.bordered)
                .disabled(!ble.isConnected)
            }
            .padding(.horizontal)

            HStack(spacing: 12) {
                HStack(spacing: 8) {
                    if pendingTries > 0 {
                        Button {
                            pendingTries = max(pendingTries - 1, 0)
                        } label: {
                            Image(systemName: "minus.circle.fill")
                                .font(.title2)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .transition(.scale.combined(with: .opacity))
                    }

                    Button {
                        pendingTries += 1
                    } label: {
                        Label(pendingTries > 0 ? "Log try · \(pendingTries)" : "Log try",
                              systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .animation(.easeInOut(duration: 0.15), value: pendingTries > 0)

                Button {
                    showingLog = true
                } label: {
                    Label("Log ascent", systemImage: "checkmark.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal)

            if !ble.isConnected {
                Text("Connect to the board to light it up.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.bottom)
        .onDisappear { flushPending() }
        .sheet(isPresented: $showingLog) {
            LogAscentSheet(sourceCatalogID: nil,
                           problemName: problem.name,
                           problemGrade: problem.grade,
                           tries: max(pendingTries, 1),
                           sent: true,
                           onComplete: { pendingTries = 0 })
        }
        .navigationTitle(problem.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack {
                    Text(problem.grade).font(.subheadline.weight(.semibold))
                    Menu {
                        Button { showingEditor = true } label: { Label("Edit", systemImage: "pencil") }
                        Button(role: .destructive) { confirmingDelete = true } label: {
                            Label("Delete Problem", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .sheet(isPresented: $showingEditor) {
            ProblemEditView(existing: problem)
        }
        .confirmationDialog("Delete \"\(problem.name)\"?", isPresented: $confirmingDelete,
                            titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: deleteProblem)
            Button("Cancel", role: .cancel) {}
        }
    }

    /// Save any pending tries as an attempt when leaving the screen.
    private func flushPending() {
        guard pendingTries > 0 else { return }
        let ascent = Ascent(sourceCatalogID: nil,
                            problemName: problem.name,
                            problemGrade: problem.grade,
                            votedGrade: problem.grade,
                            tries: pendingTries,
                            sent: false)
        context.insert(ascent)
        pendingTries = 0
    }

    private func deleteProblem() {
        context.delete(problem)
        dismiss()
    }
}
