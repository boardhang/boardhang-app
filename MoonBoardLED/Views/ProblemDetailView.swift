import SwiftUI
import SwiftData

/// View a saved problem and light it up on the board.
struct ProblemDetailView: View {
    @EnvironmentObject private var ble: MoonBoardBLEManager
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Board.mini2025.flippedKey) private var flipped = false
    @AppStorage("showBeta") private var showBeta = true
    @AppStorage(Board.mini2025.activeHoldSetsKey) private var activeHoldSetsCSV = ""
    @State private var showingEditor = false
    @State private var confirmingDelete = false
    @State private var showingLog = false
    /// Un-saved tries tapped via "Add try"; saved as an attempt on leaving.
    @State private var pendingTries = 0

    let problem: Problem

    /// User-created problems live on the Mini 2025 board.
    private let board = Board.mini2025
    private var renderHoldSetIDs: Set<Int> {
        ActiveHoldSets.visible(ActiveHoldSets.ids(from: activeHoldSetsCSV, in: board), in: board)
    }

    var body: some View {
        VStack(spacing: 12) {
            BoardImageView(setup: board.setup, visibleHoldSetIDs: renderHoldSetIDs,
                           holds: problem.holds, showBeta: showBeta)
                .padding(.horizontal, 8)

            Toggle("Show beta", isOn: $showBeta)
                .padding(.horizontal)
                .onChange(of: showBeta) { _, _ in
                    if ble.isConnected {
                        ble.send(holds: problem.holds, rows: board.rows, flipped: flipped, showBeta: showBeta)
                    }
                }

            HStack(spacing: 12) {
                Button {
                    ble.send(holds: problem.holds, rows: board.rows, flipped: flipped, showBeta: showBeta)
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
                TryStepper(count: pendingTries,
                           onRemove: { pendingTries = max(pendingTries - 1, 0) },
                           onAdd: { pendingTries += 1 })

                Button {
                    showingLog = true
                } label: {
                    Label("Log ascent", systemImage: "checkmark.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
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
                           boardLayoutId: board.id,
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

    /// Save any pending tries as an attempt when leaving the screen. Tries logged
    /// on this problem earlier the same day are merged into that existing attempt
    /// rather than creating a second entry.
    private func flushPending() {
        guard pendingTries > 0 else { return }
        let tries = pendingTries
        pendingTries = 0
        if let existing = todaysAttempt() {
            existing.tries += tries
        } else {
            context.insert(Ascent(sourceCatalogID: nil,
                                  problemName: problem.name,
                                  problemGrade: problem.grade,
                                  votedGrade: problem.grade,
                                  tries: tries,
                                  sent: false,
                                  boardLayoutId: board.id))
        }
    }

    /// The un-sent attempt logged today for this user problem, if any.
    private func todaysAttempt() -> Ascent? {
        let name = problem.name
        let descriptor = FetchDescriptor<Ascent>(
            predicate: #Predicate { $0.sent == false && $0.problemName == name }
        )
        guard let matches = try? context.fetch(descriptor) else { return nil }
        let cal = Calendar.current
        return matches.first {
            $0.sourceCatalogID == nil && cal.isDate($0.date, inSameDayAs: Date())
        }
    }

    private func deleteProblem() {
        context.delete(problem)
        dismiss()
    }
}
