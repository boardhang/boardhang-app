import SwiftUI
import SwiftData

/// Home screen: the saved problem list, connection status, and entry points to
/// create a problem, manage the BLE connection, and run the LED test.
struct ProblemListView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var ble: MoonBoardBLEManager
    @Query(sort: \Problem.createdAt, order: .reverse) private var problems: [Problem]

    @State private var showingEditor = false
    @State private var showingConnection = false
    @State private var showingTest = false
    @State private var showingCatalog = false

    var body: some View {
        NavigationStack {
            Group {
                if problems.isEmpty {
                    ContentUnavailableView {
                        Label("No problems yet", systemImage: "circle.grid.cross")
                    } description: {
                        Text("Tap + to create your first problem.")
                    }
                } else {
                    List {
                        ForEach(problems) { problem in
                            NavigationLink(destination: ProblemDetailView(problem: problem)) {
                                row(for: problem)
                            }
                        }
                        .onDelete(perform: delete)
                    }
                }
            }
            .navigationTitle("Problems")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showingConnection = true } label: {
                        Label(ble.state.label, systemImage: ble.isConnected ? "dot.radiowaves.left.and.right" : "antenna.radiowaves.left.and.right.slash")
                            .labelStyle(.titleAndIcon)
                            .font(.caption)
                            .foregroundStyle(ble.isConnected ? .green : .secondary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showingEditor = true } label: { Label("New Problem", systemImage: "plus") }
                        Button { showingCatalog = true } label: { Label("Official Problems", systemImage: "books.vertical") }
                        Button { showingTest = true } label: { Label("LED Test / Calibration", systemImage: "lightbulb") }
                        Button { ble.clear() } label: { Label("Clear Board", systemImage: "lightbulb.slash") }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingEditor) {
                ProblemEditView()
            }
            .sheet(isPresented: $showingConnection) {
                ConnectionView()
            }
            .sheet(isPresented: $showingTest) {
                LEDTestView()
            }
            .sheet(isPresented: $showingCatalog) {
                CatalogListView(board: .mini2025, angle: Board.mini2025.defaultAngle)
            }
        }
    }

    private func row(for problem: Problem) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(problem.name.uppercased()).font(.headline)
                Text("\(problem.holds.count) holds").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(problem.grade)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(Color.accentColor.opacity(0.15), in: Capsule())
        }
    }

    private func delete(_ offsets: IndexSet) {
        for i in offsets { context.delete(problems[i]) }
    }
}
