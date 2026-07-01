import SwiftUI
import SwiftData

/// Full scrollable logbook: every ascent grouped into day-sessions, newest first.
/// Section headers are the friendly session title ("Tue 24 Jun — 5 problems").
/// Tapping an ascent opens its problem (swipeable through the other logged
/// problems); swipe actions edit or delete. Optionally scrolls to a given day.
struct LogbookView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Ascent.date, order: .reverse) private var ascents: [Ascent]
    @AppStorage("showClimbPreviews") private var showClimbPreviews = true

    private let catalog = Catalog.shared

    /// When set, the view scrolls to this day's section on appear.
    var anchorDay: Date?

    @State private var editing: Ascent?

    private var sessions: [LogSession] { LogSession.sessions(from: ascents) }

    /// The catalog problem an ascent was logged from, if it still exists.
    private func catalogProblem(for ascent: Ascent) -> CatalogProblem? {
        guard let id = ascent.sourceCatalogID else { return nil }
        return catalog.problems.first { $0.id == id }
    }

    /// Distinct catalog problems across the whole logbook, in logbook order —
    /// the set you can swipe through from the detail view.
    private var loggedProblems: [CatalogProblem] {
        var seen = Set<String>()
        var result: [CatalogProblem] = []
        for ascent in ascents {
            guard let p = catalogProblem(for: ascent), !seen.contains(p.id) else { continue }
            seen.insert(p.id)
            result.append(p)
        }
        return result
    }

    var body: some View {
        Group {
            if ascents.isEmpty {
                ContentUnavailableView {
                    Label("No ascents yet", systemImage: "book.closed")
                } description: {
                    Text("Log an ascent from a problem to start your logbook.")
                }
            } else {
                ScrollViewReader { proxy in
                    List {
                        ForEach(sessions) { session in
                            Section {
                                ForEach(session.ascents) { ascent in
                                    row(for: ascent)
                                        .swipeActions(edge: .trailing) {
                                            Button(role: .destructive) {
                                                context.delete(ascent)
                                            } label: {
                                                Label("Delete", systemImage: "trash")
                                            }
                                            Button {
                                                editing = ascent
                                            } label: {
                                                Label("Edit", systemImage: "pencil")
                                            }
                                            .tint(.blue)
                                        }
                                }
                            } header: {
                                Text(session.title)
                            }
                            .id(session.day)
                        }
                    }
                    .onAppear {
                        if let anchorDay {
                            withAnimation { proxy.scrollTo(anchorDay, anchor: .top) }
                        }
                    }
                }
            }
        }
        .navigationTitle("Logbook")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showClimbPreviews.toggle() } label: {
                    Image(systemName: showClimbPreviews ? "square.grid.2x2.fill" : "square.grid.2x2")
                }
            }
        }
        .sheet(item: $editing) { ascent in
            LogAscentSheet(editing: ascent)
        }
    }

    /// Tapping a row opens its problem in the swipeable detail pager. Ascents
    /// whose source problem no longer exists are shown as plain (non-tappable).
    @ViewBuilder
    private func row(for ascent: Ascent) -> some View {
        if let problem = catalogProblem(for: ascent) {
            ZStack(alignment: .leading) {
                AscentRow(ascent: ascent, isBenchmark: problem.isBenchmark,
                          method: problem.method, setter: problem.setter,
                          holds: showClimbPreviews ? problem.holdAssignments : nil)
                NavigationLink {
                    CatalogProblemPager(problems: loggedProblems, current: problem)
                } label: { EmptyView() }
                .opacity(0)
            }
        } else {
            AscentRow(ascent: ascent)
        }
    }
}
