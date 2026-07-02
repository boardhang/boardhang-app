import SwiftUI
import SwiftData

/// Full scrollable logbook: every ascent grouped into day-sessions, newest first.
/// Filtered by the shared board filter (default: all boards). Tapping an ascent
/// opens its problem (swipeable through the other logged problems on that board);
/// swipe actions edit or delete. Optionally scrolls to a given day.
struct LogbookView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Ascent.date, order: .reverse) private var allAscents: [Ascent]
    @AppStorage("showClimbPreviews") private var showClimbPreviews = true
    @AppStorage(BoardFilter.storageKey) private var boardFilterCSV = ""
    @AppStorage(AddedBoards.storageKey) private var addedCSV = ""

    /// When set, the view scrolls to this day's section on appear.
    var anchorDay: Date?

    @State private var editing: Ascent?

    /// Added boards — the filter is only worth showing when there's more than one.
    private var addedBoards: [Board] { AddedBoards.boards(from: addedCSV) }
    /// Board ids currently shown (drives the empty-state copy).
    private var selectedBoardIDs: Set<Int> { BoardFilter.selected(from: boardFilterCSV) }

    /// Ascents included by the current board filter.
    private var ascents: [Ascent] {
        let selected = BoardFilter.selected(from: boardFilterCSV)
        return allAscents.filter { selected.contains($0.effectiveBoardLayoutId) }
    }

    private var sessions: [LogSession] { LogSession.sessions(from: ascents) }

    /// The board + catalog problem an ascent was logged from, if it still exists.
    private func entry(for ascent: Ascent) -> CatalogIndex.Entry? {
        CatalogIndex.entry(forCatalogID: ascent.sourceCatalogID)
    }

    /// Distinct catalog problems for a board across the (filtered) logbook, in
    /// logbook order — the set you swipe through from that board's detail view.
    private func loggedProblems(for board: Board) -> [CatalogProblem] {
        var seen = Set<String>()
        var result: [CatalogProblem] = []
        for ascent in ascents {
            guard let e = entry(for: ascent), e.board.id == board.id,
                  !seen.contains(e.problem.id) else { continue }
            seen.insert(e.problem.id)
            result.append(e.problem)
        }
        return result
    }

    var body: some View {
        Group {
            if ascents.isEmpty {
                if selectedBoardIDs.isEmpty {
                    ContentUnavailableView {
                        Label("No boards selected", systemImage: "square.grid.3x3")
                    } description: {
                        Text("Tap a board above to see its ascents.")
                    }
                } else {
                    ContentUnavailableView {
                        Label("No ascents yet", systemImage: "book.closed")
                    } description: {
                        Text("Log an ascent from a problem to start your logbook.")
                    }
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
        // Which-board filter lives in a sticky bar under the nav bar (like the
        // catalog), so the current board selection is always visible. Only worth
        // showing when there's more than one board to choose between.
        .safeAreaInset(edge: .top, spacing: 0) {
            if addedBoards.count > 1 { boardFilterBar }
        }
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

    /// Always-visible board filter, sitting just under the nav bar. Reuses the
    /// same `BoardFilterPills` as Home so the two rows look identical.
    private var boardFilterBar: some View {
        BoardFilterPills()
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(.bar)
    }

    /// Tapping a row opens its problem in the swipeable detail pager (all hold sets
    /// shown, regardless of the board's installed sets). Ascents whose source
    /// problem no longer exists are shown as plain (non-tappable).
    @ViewBuilder
    private func row(for ascent: Ascent) -> some View {
        if let e = entry(for: ascent) {
            ZStack(alignment: .leading) {
                AscentRow(ascent: ascent, isBenchmark: e.problem.isBenchmark,
                          method: e.problem.method, setter: e.problem.setter,
                          holds: showClimbPreviews ? e.problem.holdAssignments : nil,
                          setup: e.board.setup)
                NavigationLink {
                    CatalogProblemPager(problems: loggedProblems(for: e.board),
                                        current: e.problem, board: e.board, source: .logbook,
                                        visibleHoldSetIDs: nil)
                } label: { EmptyView() }
                .opacity(0)
            }
        } else {
            AscentRow(ascent: ascent)
        }
    }
}
