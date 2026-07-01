import SwiftUI
import SwiftData

/// The Home tab: a "Boards" section (entry to the problem catalog) and a
/// "Logbook" section (grade pyramid + the 3 latest sessions). Connecting to the
/// board happens from the lightbulb on the problem detail screen.
struct HomeView: View {
    @Query(sort: \Ascent.date, order: .reverse) private var ascents: [Ascent]
    @AppStorage(ActiveHoldSets.miniStorageKey) private var activeCSV = ""
    @State private var showingHoldSetEditor = false

    private let setup = MoonBoardSetup.mini2025
    private var activeHoldSets: Set<Int> { ActiveHoldSets.ids(from: activeCSV, in: setup) }

    private var sessions: [LogSession] { LogSession.sessions(from: ascents) }
    private var latestSessions: [LogSession] { Array(sessions.prefix(3)) }

    var body: some View {
        NavigationStack {
            List {
                Section("Boards") {
                    NavigationLink {
                        CatalogListView()
                    } label: {
                        HStack(spacing: 12) {
                            BoardImageView(setup: setup, visibleHoldSetIDs: activeHoldSets)
                                .frame(width: 72)
                                .allowsHitTesting(false)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(setup.name)
                                Text(ActiveHoldSets.subtitle(activeHoldSets, in: setup))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .swipeActions(edge: .trailing) {
                        Button {
                            showingHoldSetEditor = true
                        } label: {
                            Label("Edit hold sets", systemImage: "square.stack.3d.up")
                        }
                        .tint(.accentColor)
                    }
                }

                Section("Logbook") {
                    if ascents.isEmpty {
                        ContentUnavailableView {
                            Label("No ascents yet", systemImage: "book.closed")
                        } description: {
                            Text("Log an ascent from a problem to start your logbook.")
                        }
                    } else {
                        if ascents.contains(where: \.sent) {
                            GradePyramidView(ascents: ascents)
                                .listRowInsets(EdgeInsets(top: 20, leading: 12, bottom: 12, trailing: 12))
                        }

                        ForEach(latestSessions) { session in
                            NavigationLink {
                                LogbookView(anchorDay: session.day)
                            } label: {
                                Text(session.title)
                            }
                        }

                        NavigationLink {
                            LogbookView()
                        } label: {
                            Text("See all").foregroundStyle(Color.accentColor)
                        }
                    }
                }
            }
            .navigationTitle("")
            .sheet(isPresented: $showingHoldSetEditor) {
                HoldSetEditorView(setup: setup)
            }
        }
    }
}
