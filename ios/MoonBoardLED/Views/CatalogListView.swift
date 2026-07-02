import SwiftUI
import SwiftData
import UIKit

/// Browse the bundled, read-only catalog of official Mini MoonBoard 2025
/// problems. Separate from the user's own problems — view and light only.
struct CatalogListView: View {
    /// A single sort dimension. The same four keys populate both the primary and
    /// the optional secondary "then by" row; each grade direction is its own key.
    private enum SortKey: String, CaseIterable, Identifiable {
        case easiest      = "Easiest first"
        case hardest      = "Hardest first"
        case highestRated = "Highest rated"
        case mostRepeats  = "Most repeats"

        var id: String { rawValue }

        /// Underlying field, so the secondary row can hide whichever key(s) share
        /// the primary's dimension (no "Highest rated, then Highest rated", and no
        /// pairing Easiest with Hardest).
        enum Dimension { case grade, rating, repeats }
        var dimension: Dimension {
            switch self {
            case .easiest, .hardest: return .grade
            case .highestRated:      return .rating
            case .mostRepeats:       return .repeats
            }
        }

        /// Order two problems on this key (direction baked in).
        func order(_ a: CatalogProblem, _ b: CatalogProblem,
                   gradeIndex: (String) -> Int) -> ComparisonResult {
            switch self {
            case .easiest:      return Self.cmp(gradeIndex(a.grade), gradeIndex(b.grade))
            case .hardest:      return Self.cmp(gradeIndex(b.grade), gradeIndex(a.grade))
            case .highestRated: return Self.cmp(b.stars, a.stars)
            case .mostRepeats:  return Self.cmp(b.repeats, a.repeats)
            }
        }

        private static func cmp<T: Comparable>(_ a: T, _ b: T) -> ComparisonResult {
            a < b ? .orderedAscending : (a > b ? .orderedDescending : .orderedSame)
        }
    }

    /// Baseline sort (first launch / Reset): easiest first, most-repeated within a
    /// grade — replaces the old opaque "Default" with a meaningful order.
    private static let baselinePrimary: SortKey = .easiest
    private static let baselineSecondary: SortKey? = .mostRepeats

    /// Multi-select status/attribute filters shown in the "Filters" section.
    /// The three status cases (`myAscents`/`notCompleted`/`notLogged`) are
    /// combined with OR; `benchmarks` and `favorites` each AND on top.
    enum CatalogFilter: String, CaseIterable, Identifiable {
        case benchmarks   = "Benchmarks"
        case myAscents    = "My ascents"
        case notCompleted = "Not completed"
        case notLogged    = "Not logged"
        case favorites    = "Favorites"

        var id: String { rawValue }
        /// The status cases form one OR'd group.
        static var statusCases: [CatalogFilter] { [.myAscents, .notCompleted, .notLogged] }
    }

    let board: Board
    let angle: Int

    @Query private var ascents: [Ascent]
    @Query private var favorites: [FavoriteProblem]
    // Filters persist across visits (and launches) so they don't reset every
    // time the catalog is re-opened from Home. Search is intentionally transient.
    @State private var search = ""
    // Grade range is per board+angle (grade lists differ), so its keys are dynamic.
    @AppStorage private var lowerGrade: Int
    @AppStorage private var upperGrade: Int
    @AppStorage("catalogMinStars") private var minStars = 0
    /// Selected filters, "|"-joined raw values (see `CatalogFilter`).
    @AppStorage("catalogFilters") private var filtersCSV = ""
    /// Selected method filters, "|"-joined. Empty = any. "Standard" means
    /// problems with no special method; other entries are exact method labels.
    @AppStorage("catalogMethods") private var methodsCSV = ""
    /// Two-level sort. Primary is always set; secondary is an optional tiebreaker
    /// stored as a raw value ("" = None).
    @AppStorage("catalogSortPrimary") private var sortPrimary: SortKey = .easiest
    @AppStorage("catalogSortSecondary") private var sortSecondaryRaw = SortKey.mostRepeats.rawValue
    @AppStorage("showClimbPreviews") private var showClimbPreviews = true
    /// Active hold sets installed on this board (shared with Home + the editor).
    @AppStorage private var activeHoldSetsCSV: String
    /// Selected holds filter — "|"-joined "col-row" positions every shown problem
    /// must include. Empty = off. Per board (holds are physical, angle-independent).
    @AppStorage private var holdFilterCSV: String

    /// Catalog is decoded off the main thread (4,889 problems is heavy) so tapping
    /// a board is instant; nil until loaded, which drives the loading state.
    @State private var loadedCatalog: Catalog?
    /// "|"-joined ids of recently viewed problems for this board+angle (most
    /// recent first), driving the "Recently viewed" section. Empty = none yet.
    @AppStorage private var recentProblemsCSV: String
    /// Whether the "Recently viewed" section shows its full history or just the
    /// most recent one.
    @State private var recentExpanded = false
    /// Lets a board tap (from Home) pop this catalog back to its list.
    @Environment(TabRouter.self) private var router

    init(board: Board, angle: Int) {
        self.board = board
        self.angle = angle
        // No catalog decode here — the upper-grade default is a sentinel that's
        // clamped to the real grade list once the catalog loads.
        _lowerGrade = AppStorage(wrappedValue: 0, "catalogLowerGrade_\(board.id)_\(angle)")
        _upperGrade = AppStorage(wrappedValue: 999, "catalogUpperGrade_\(board.id)_\(angle)")
        _activeHoldSetsCSV = AppStorage(wrappedValue: "", board.activeHoldSetsKey)
        _holdFilterCSV = AppStorage(wrappedValue: "", HoldFilter.storageKey(for: board))
        _recentProblemsCSV = AppStorage(wrappedValue: "", "catalogRecentProblems_\(board.id)_\(angle)")
    }

    /// Stored recently-viewed problems (most recent first), resolved against the
    /// loaded catalog and preserving order. Empty when nothing's stored or none of
    /// the ids are in this board+angle's catalog.
    private var recentProblems: [CatalogProblem] {
        let ids = recentProblemsCSV.split(separator: "|").map(String.init)
        guard !ids.isEmpty else { return [] }
        let wanted = Set(ids)
        var byID: [String: CatalogProblem] = [:]
        for p in catalog.problems where wanted.contains(p.id) { byID[p.id] = p }
        return ids.compactMap { byID[$0] }
    }

    private var catalog: Catalog { loadedCatalog ?? .empty }
    /// The picker's grade range: the contiguous span of the canonical scale the
    /// loaded catalog actually uses.
    private var gradeList: [String] {
        let present = Set(catalog.problems.map(\.grade))
        let idxs = present.compactMap { FontGrade.all.firstIndex(of: $0) }
        guard let lo = idxs.min(), let hi = idxs.max() else { return FontGrade.all }
        return Array(FontGrade.all[lo...hi])
    }
    private var gradeMaxIndex: Int { max(gradeList.count - 1, 0) }
    private var clampedUpper: Int { min(upperGrade, gradeMaxIndex) }
    private var clampedLower: Int { min(max(lowerGrade, 0), clampedUpper) }
    private var lowerBinding: Binding<Int> { Binding(get: { clampedLower }, set: { lowerGrade = $0 }) }
    private var upperBinding: Binding<Int> { Binding(get: { clampedUpper }, set: { upperGrade = $0 }) }

    private var membership: HoldSetMembership { board.membership }
    private var activeHoldSets: Set<Int> { ActiveHoldSets.ids(from: activeHoldSetsCSV, in: board) }

    /// Selected holds filter as a set of "col-row" positions.
    private var selectedHolds: Set<String> { HoldFilter.selected(from: holdFilterCSV) }
    private var holdFilterActive: Bool { !holdFilterCSV.isEmpty }
    /// Two-way binding the hold picker edits; writing persists the CSV.
    private var holdSelectionBinding: Binding<Set<String>> {
        Binding(get: { selectedHolds },
                set: { holdFilterCSV = HoldFilter.csv(from: $0) })
    }
    /// True when only some hold sets are installed, so the catalog is filtered.
    private var holdSetSubsetActive: Bool { !ActiveHoldSets.isAllActive(activeHoldSets, in: board) }
    /// Hold-set layers to render (active + always-on feet).
    private var renderHoldSetIDs: Set<Int> { ActiveHoldSets.visible(activeHoldSets, in: board) }

    /// Method filter choices shown in the filter sheet ("Any marked holds" = no
    /// special method).
    private static let methodChoices = ["Any marked holds", "No kickboard", "Footless", "Footless + kickboard"]

    private var selectedMethods: Set<String> {
        Set(methodsCSV.split(separator: "|").map(String.init))
    }

    private func toggleMethod(_ method: String) {
        var set = selectedMethods
        if set.contains(method) { set.remove(method) } else { set.insert(method) }
        methodsCSV = set.joined(separator: "|")
    }

    private var selectedFilters: Set<CatalogFilter> {
        Set(filtersCSV.split(separator: "|").compactMap { CatalogFilter(rawValue: String($0)) })
    }

    private func toggleFilter(_ filter: CatalogFilter) {
        var set = selectedFilters
        if set.contains(filter) { set.remove(filter) } else { set.insert(filter) }
        filtersCSV = set.map(\.rawValue).joined(separator: "|")
    }

    @State private var showingFilters = false
    @State private var showingHoldSetEditor = false
    @State private var showingHoldPicker = false
    @State private var showingRecent = false
    /// Whether the filter FAB is fanned open into its radial quick-filter menu.
    @State private var filtersExpanded = false
    /// Height of the on-screen keyboard, so the FABs can lift clear of the search
    /// bar (which rises with the keyboard) instead of hiding behind its ✕ button.
    @State private var keyboardHeight: CGFloat = 0
    /// Problem chosen in the recent sheet, opened after the sheet dismisses.
    @State private var pendingRecent: CatalogProblem?
    /// Drives navigation to the problem pager, built lazily on tap.
    @State private var selectedProblem: CatalogProblem?

    /// Incremental rendering: show this many rows, growing by `pageSize` as you
    /// scroll to the end. Reset to one page whenever the filtered set changes.
    private static let pageSize = 30
    @State private var visibleLimit = CatalogListView.pageSize

    /// Everything that changes the filtered result — used to reset pagination.
    private var filterSignature: String {
        "\(search)|\(filtersCSV)|\(methodsCSV)|\(minStars)|\(lowerGrade)|\(upperGrade)|\(sortPrimary.rawValue)|\(sortSecondaryRaw)|\(activeHoldSetsCSV)|\(holdFilterCSV)"
    }

    /// Catalog ids the user has actually sent (≥1 ascent with `sent == true`).
    private var sentIDs: Set<String> {
        Set(ascents.filter(\.sent).compactMap(\.sourceCatalogID))
    }

    /// Catalog ids with any logged ascent (send or attempt).
    private var loggedIDs: Set<String> {
        Set(ascents.compactMap(\.sourceCatalogID))
    }

    private var favoriteIDs: Set<String> {
        Set(favorites.map(\.catalogID))
    }

    /// Whether the grade range is anything other than the full span.
    private var gradeRangeActive: Bool {
        clampedLower > 0 || clampedUpper < gradeMaxIndex
    }

    private var filtered: [CatalogProblem] {
        let sent = sentIDs
        let logged = loggedIDs
        let favs = favoriteIDs
        let selected = selectedFilters
        let activeSets = activeHoldSets
        let subset = holdSetSubsetActive
        let selectedMethodSet = selectedMethods
        let holdSet = selectedHolds
        // Hoist grade-range state OUT of the per-problem loop. Each of these is
        // built from `gradeList`, which scans all ~4,889 grades — recomputing it
        // per problem made filtering O(n²) (hundreds of ms release, seconds in
        // debug, on every render/keystroke). Compute once, index by grade here.
        let grades = gradeList
        let gradeIndexByValue = Dictionary(grades.enumerated().map { ($0.element, $0.offset) },
                                           uniquingKeysWith: { a, _ in a })
        let lo = clampedLower
        let hi = clampedUpper
        let matches = catalog.problems.filter { p in
            // Unknown grades (not in this board's list) are always shown.
            let gradeOK = gradeIndexByValue[p.grade].map { $0 >= lo && $0 <= hi } ?? true
            return gradeOK &&
            p.stars >= minStars &&
            (selectedMethodSet.isEmpty || selectedMethodSet.contains(p.method ?? "Any marked holds")) &&
            (!subset || membership.isClimbable(holds: p.holds, activeSetIDs: activeSets)) &&
            (holdSet.isEmpty || holdSet.isSubset(of: Set(p.holds.map { "\($0.c)-\($0.r)" }))) &&
            matchesFilters(p, selected: selected, sent: sent, logged: logged, favs: favs) &&
            (search.isEmpty
             || p.name.localizedCaseInsensitiveContains(search)
             || p.setter.localizedCaseInsensitiveContains(search))
        }
        return sorted(matches)
    }

    /// Faceted match: the selected status filters are OR'd together, while
    /// Benchmarks and Favorites each apply as an additional AND constraint.
    private func matchesFilters(_ p: CatalogProblem,
                                selected: Set<CatalogFilter>,
                                sent: Set<String>,
                                logged: Set<String>,
                                favs: Set<String>) -> Bool {
        if selected.contains(.benchmarks) && !p.isBenchmark { return false }
        if selected.contains(.favorites) && !favs.contains(p.id) { return false }

        let statusSelected = selected.intersection(Set(CatalogFilter.statusCases))
        guard !statusSelected.isEmpty else { return true }
        return statusSelected.contains { status in
            switch status {
            case .myAscents:    return sent.contains(p.id)
            case .notCompleted: return logged.contains(p.id) && !sent.contains(p.id)
            case .notLogged:    return !logged.contains(p.id)
            default:            return false
            }
        }
    }

    /// Optional secondary key ("" raw = None).
    private var sortSecondary: SortKey? { SortKey(rawValue: sortSecondaryRaw) }
    /// Secondary options: every key whose dimension differs from the primary's.
    private var secondaryOptions: [SortKey] {
        SortKey.allCases.filter { $0.dimension != sortPrimary.dimension }
    }
    /// True when the sort is untouched from the baseline, so it isn't surfaced as
    /// an active-filter chip or reflected in the filled FAB.
    private var sortIsBaseline: Bool {
        sortPrimary == Self.baselinePrimary && sortSecondary == Self.baselineSecondary
    }
    /// Chip label, e.g. "Most repeats – Hardest first"; just the primary when no
    /// secondary is set.
    private var sortChipLabel: String {
        if let s = sortSecondary { return "\(sortPrimary.rawValue) – \(s.rawValue)" }
        return sortPrimary.rawValue
    }
    private func selectPrimary(_ key: SortKey) {
        sortPrimary = key
        // Drop a secondary that now duplicates the primary's dimension.
        if let s = sortSecondary, s.dimension == key.dimension { sortSecondaryRaw = "" }
    }
    /// Single-select-with-deselect: tapping the active secondary clears it.
    private func toggleSecondary(_ key: SortKey) {
        sortSecondaryRaw = sortSecondary == key ? "" : key.rawValue
    }
    private func resetSort() {
        sortPrimary = Self.baselinePrimary
        sortSecondaryRaw = Self.baselineSecondary?.rawValue ?? ""
    }

    private func sorted(_ problems: [CatalogProblem]) -> [CatalogProblem] {
        let keys = [sortPrimary] + (sortSecondary.map { [$0] } ?? [])
        return problems.sorted { a, b in
            for key in keys {
                switch key.order(a, b, gradeIndex: gradeIndex) {
                case .orderedAscending:  return true
                case .orderedDescending: return false
                case .orderedSame:       continue
                }
            }
            // Deterministic final tiebreak — Swift's sort isn't stable, so equal-key
            // problems would otherwise shuffle between renders. Name order is
            // arbitrary but stable (never offered as a user-facing sort).
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    /// Position of a grade on the canonical scale; unknown grades sort to the end.
    private func gradeIndex(_ grade: String) -> Int {
        FontGrade.index(of: grade)
    }

    var body: some View {
            // Compute the filtered/sorted list and lookup sets ONCE per render —
            // never per row (per-row rebuilds of these made the list O(n²)/laggy).
            let problems = filtered
            let shown = visibleLimit >= problems.count ? problems : Array(problems.prefix(visibleLimit))
            let sent = sentIDs
            let favs = favoriteIDs
            let renderIDs = renderHoldSetIDs
            return Group {
                if loadedCatalog == nil {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if catalog.problems.isEmpty {
                    ContentUnavailableView {
                        Label("No catalog bundled", systemImage: "tray")
                    } description: {
                        Text("This board's problem catalog hasn't been bundled yet.")
                    }
                } else {
                    List {
                        // Problems recently viewed for this board+angle, pinned above
                        // the list so you can jump back in. Ignores filters. Shows
                        // the most recent by default; the rest expand on demand.
                        let recents = recentProblems
                        if !recents.isEmpty {
                            Section {
                                ForEach(recentExpanded ? recents : Array(recents.prefix(2))) { recent in
                                    Button {
                                        selectedProblem = recent
                                    } label: {
                                        CatalogProblemRow(problem: recent,
                                                          isSent: sent.contains(recent.id),
                                                          isFavorite: favs.contains(recent.id),
                                                          showPreview: showClimbPreviews,
                                                          setup: board.setup,
                                                          visibleHoldSetIDs: renderIDs)
                                            .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                }
                                if recents.count > 2 {
                                    Button {
                                        withAnimation { recentExpanded.toggle() }
                                    } label: {
                                        Label(recentExpanded ? "Show less" : "Show \(recents.count - 2) more",
                                              systemImage: recentExpanded ? "chevron.up" : "chevron.down")
                                            .font(.subheadline)
                                    }
                                }
                            } header: {
                                HStack {
                                    Text("Recently viewed")
                                    Spacer()
                                    Button("Clear") {
                                        recentProblemsCSV = ""
                                        recentExpanded = false
                                    }
                                    .font(.caption.weight(.semibold))
                                    .textCase(nil)
                                    .foregroundStyle(Color.accentColor)
                                }
                            }
                        }
                        Section {
                            ForEach(shown) { problem in
                                Button {
                                    selectedProblem = problem
                                } label: {
                                    CatalogProblemRow(problem: problem,
                                                      isSent: sent.contains(problem.id),
                                                      isFavorite: favs.contains(problem.id),
                                                      showPreview: showClimbPreviews,
                                                      setup: board.setup,
                                                      visibleHoldSetIDs: renderIDs)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .onAppear {
                                    // Load the next page when the last visible row shows.
                                    if problem.id == shown.last?.id && shown.count < problems.count {
                                        visibleLimit += Self.pageSize
                                    }
                                }
                            }
                        } header: {
                            Text("\(problems.count) of \(catalog.count) problems")
                        }
                    }
                    .scrollDismissesKeyboard(.interactively)
                }
            }
            // Native search: on iOS 26 a search-role tab grows the bottom pill bar
            // into this field; elsewhere it's a standard search bar. Binds the same
            // `search` string the list filters on.
            .searchable(text: $search, prompt: "Name or setter")
            .navigationDestination(item: $selectedProblem) { problem in
                // The recently-viewed problem may be filtered out of `problems`;
                // page across the full catalog in that case so it still opens.
                let list = problems.contains(where: { $0.id == problem.id })
                    ? problems : catalog.problems
                CatalogProblemPager(problems: list, current: problem,
                                    board: board, source: .catalog(angle: angle),
                                    visibleHoldSetIDs: renderIDs,
                                    selectedHolds: selectedHolds)
            }
            // A board tap on Home pops us back to the list (see TabRouter).
            .onChange(of: router.listResetToken) { _, _ in selectedProblem = nil }
            .onChange(of: filterSignature) { _, _ in visibleLimit = Self.pageSize }
            .task {
                guard loadedCatalog == nil else { return }
                let resource = board.catalogResource(angle: angle)
                loadedCatalog = await Task.detached(priority: .userInitiated) {
                    Catalog.load(resource: resource)
                }.value
            }
            .navigationTitle(board.name)
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .top, spacing: 0) {
                if filtersActive { activeFilterBar }
            }
            // The climb-preview toggle lives in the nav bar; filters live in a
            // floating button (below) rather than the toolbar.
            // Alignment matters: without it the overlay centers, and the FAB
            // only *looks* anchored while the expanded scrim stretches the
            // ZStack full-screen — collapsed, it floats mid-screen.
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showClimbPreviews.toggle() } label: {
                        Image(systemName: showClimbPreviews ? "square.grid.2x2.fill" : "square.grid.2x2")
                    }
                    .accessibilityLabel(showClimbPreviews ? "Hide climb previews" : "Show climb previews")
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if loadedCatalog != nil && !catalog.problems.isEmpty {
                    filterMenuOverlay
                }
            }
            .sheet(isPresented: $showingRecent, onDismiss: {
                if let p = pendingRecent { pendingRecent = nil; selectedProblem = p }
            }) {
                recentSheet
            }
            .sheet(isPresented: $showingFilters) {
                filterSheet
            }
            .sheet(isPresented: $showingHoldSetEditor) {
                HoldSetEditorView(board: board)
            }
            // Editing the board's active hold sets can strip a hold set out from
            // under a selection — prune any now-orphaned positions so the filter
            // can't match on holds that are no longer installed.
            .onChange(of: activeHoldSetsCSV) { _, _ in
                let pruned = HoldFilter.pruned(selectedHolds,
                                               membership: membership,
                                               activeSetIDs: activeHoldSets)
                if pruned != selectedHolds { holdFilterCSV = HoldFilter.csv(from: pruned) }
            }
    }

    /// Always-visible summary of the active filters, sitting just under the nav
    /// bar. Each chip's ✕ clears that one filter; the leading icon opens the
    /// full filter sheet. Chips scroll if they overflow.
    private var activeFilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Button { showingFilters = true } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle.fill")
                        .foregroundStyle(Color.accentColor)
                }
                .buttonStyle(.plain)
                ForEach(activeFilters) { filter in
                    HStack(spacing: 4) {
                        if let tap = filter.tap {
                            Button(action: tap) {
                                Text(filter.label).font(.caption.weight(.medium))
                            }
                            .buttonStyle(.plain)
                        } else {
                            Text(filter.label)
                                .font(.caption.weight(.medium))
                        }
                        Button(action: filter.clear) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color.accentColor.opacity(0.15), in: Capsule())
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(.bar)
    }

    private struct ActiveFilter: Identifiable {
        let label: String
        /// Optional action when the chip's label is tapped (nil = not tappable).
        var tap: (() -> Void)? = nil
        let clear: () -> Void
        var id: String { label }
    }

    /// Active filters with a per-chip clear action, shown in `activeFilterBar`.
    private var activeFilters: [ActiveFilter] {
        var items: [ActiveFilter] = []
        // Installed hold sets are a board-level setting (changed via Edit), not a
        // catalog filter — so they're deliberately not surfaced as a chip here.
        if gradeRangeActive {
            let label = clampedLower == clampedUpper
                ? gradeList[clampedLower]
                : "\(gradeList[clampedLower])–\(gradeList[clampedUpper])"
            items.append(.init(label: label) {
                lowerGrade = 0
                upperGrade = gradeMaxIndex
            })
        }
        if minStars > 0 {
            items.append(.init(label: "≥ \(minStars)★") { minStars = 0 })
        }
        if holdFilterActive {
            let n = selectedHolds.count
            items.append(.init(label: n == 1 ? "1 hold" : "\(n) holds",
                               tap: { showingHoldPicker = true }) { holdFilterCSV = "" })
        }
        for filter in CatalogFilter.allCases where selectedFilters.contains(filter) {
            items.append(.init(label: filter.rawValue) { toggleFilter(filter) })
        }
        for method in Self.methodChoices where selectedMethods.contains(method) {
            items.append(.init(label: method) { toggleMethod(method) })
        }
        if !sortIsBaseline {
            items.append(.init(label: sortChipLabel) { resetSort() })
        }
        return items
    }

    private var filtersActive: Bool {
        gradeRangeActive || minStars > 0 || !filtersCSV.isEmpty
            || !methodsCSV.isEmpty || !sortIsBaseline || holdFilterActive
    }

    private static let fabSpring = Animation.spring(response: 0.35, dampingFraction: 0.78)

    /// Full-screen overlay hosting the filter FAB and its radial quick-filter
    /// menu. Long-pressing the FAB fans the status/attribute filters out in a
    /// bow; tapping opens the full filter sheet. An invisible full-screen layer
    /// dismisses the bow on an outside tap (no visible dimming).
    private var filterMenuOverlay: some View {
        ZStack(alignment: .bottomTrailing) {
            if filtersExpanded {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(Self.fabSpring) { filtersExpanded = false } }
            }

            // Filter chips stacked above the FAB, trailing edges tracing a bow
            // that bulges left at the middle.
            let filters = CatalogFilter.allCases
            ForEach(Array(filters.enumerated()), id: \.element) { index, filter in
                filterChip(filter)
                    .offset(chipOffset(index: index, total: filters.count))
                    .scaleEffect(filtersExpanded ? 1 : 0.2, anchor: .bottomTrailing)
                    .opacity(filtersExpanded ? 1 : 0)
                    .animation(Self.fabSpring.delay(filtersExpanded ? Double(index) * 0.03 : 0),
                               value: filtersExpanded)
                    .allowsHitTesting(filtersExpanded)
            }

            VStack(spacing: 12) {
                if !recentProblems.isEmpty && !filtersExpanded { recentFAB }
                fabButton
            }
        }
        .padding(.trailing, 18)
        // SwiftUI's keyboard avoidance already lifts this overlay to just above the
        // keyboard — which lands it right beside the search bar (and its ✕ clear
        // button) that rides up with the keyboard. Add the search bar's height on
        // top so the FABs clear it, keeping a steady gap above the search bar.
        .padding(.bottom, 18 + (keyboardHeight > 0 ? 60 : 0))
        .animation(.easeOut(duration: 0.25), value: keyboardHeight)
        .onReceive(NotificationCenter.default.publisher(
            for: UIResponder.keyboardWillShowNotification)) { note in
            let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
            keyboardHeight = frame?.height ?? 0
        }
        .onReceive(NotificationCenter.default.publisher(
            for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardHeight = 0
        }
    }

    /// Offset of the chip at `index` from the FAB: a vertical column climbing
    /// from just above the FAB (last index) to the top (index 0), with each
    /// chip's trailing edge pushed left along a half-sine so the column bows
    /// out at the middle. `.zero` when collapsed so it tucks back into the FAB.
    private func chipOffset(index: Int, total: Int) -> CGSize {
        guard filtersExpanded else { return .zero }
        let clearance: CGFloat = 66   // gap between the FAB top and the lowest chip
        let step: CGFloat = 46        // vertical rhythm between chips
        let bulge: CGFloat = 54       // leftward reach of the bow at its midpoint
        let frac = total > 1 ? Double(index) / Double(total - 1) : 0
        let lift = clearance + step * CGFloat(total - 1 - index)
        return CGSize(width: -bulge * sin(.pi * frac), height: -lift)
    }

    private func filterChip(_ filter: CatalogFilter) -> some View {
        let on = selectedFilters.contains(filter)
        return Button {
            toggleFilter(filter)
        } label: {
            Text(filter.rawValue)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(on ? Color.white : Color.primary)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(on ? AnyShapeStyle(Color.accentColor)
                               : AnyShapeStyle(.regularMaterial),
                            in: Capsule())
                .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
        .fixedSize()
    }

    /// The filter FAB itself: long-press fans the quick-filter bow open
    /// (morphing to ✕), and tap opens the full filter sheet — unless the bow is
    /// open, in which case tap just closes it.
    private var fabButton: some View {
        let icon = filtersExpanded ? "xmark"
            : (filtersActive ? "line.3.horizontal.decrease.circle.fill"
                             : "line.3.horizontal.decrease.circle")
        return Image(systemName: icon)
            .font(.title2.weight(.semibold))
            .foregroundStyle(filtersExpanded || !filtersActive ? Color.accentColor : Color.white)
            .frame(width: 52, height: 52)
            .background(filtersActive && !filtersExpanded ? AnyShapeStyle(Color.accentColor)
                                                          : AnyShapeStyle(.regularMaterial),
                        in: Circle())
            .shadow(color: .black.opacity(0.2), radius: 6, y: 3)
            .contentShape(Circle())
            .onTapGesture {
                if filtersExpanded {
                    withAnimation(Self.fabSpring) { filtersExpanded = false }
                } else {
                    showingFilters = true
                }
            }
            .onLongPressGesture(minimumDuration: 0.15) {
                withAnimation(Self.fabSpring) { filtersExpanded = true }
            }
            // Haptic tick when the bow opens, so the long press feels instant.
            .sensoryFeedback(.impact(weight: .heavy, intensity: 1.0), trigger: filtersExpanded) { _, expanded in
                expanded
            }
            .accessibilityLabel("Filters")
    }

    /// Floating button to open the "Recently viewed" list from anywhere in the
    /// scroll, so you don't have to scroll back to the top.
    private var recentFAB: some View {
        Button { showingRecent = true } label: {
            Image(systemName: "clock.arrow.circlepath")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 52, height: 52)
                .background(.regularMaterial, in: Circle())
                .shadow(color: .black.opacity(0.2), radius: 6, y: 3)
        }
        .accessibilityLabel("Recently viewed")
    }

    /// Sheet listing the recently viewed problems; tapping one opens it once the
    /// sheet has dismissed (deferred via onDismiss so the push isn't dropped).
    private var recentSheet: some View {
        NavigationStack {
            List {
                ForEach(recentProblems) { p in
                    Button {
                        pendingRecent = p
                        showingRecent = false
                    } label: {
                        CatalogProblemRow(problem: p,
                                          isSent: sentIDs.contains(p.id),
                                          isFavorite: favoriteIDs.contains(p.id),
                                          showPreview: showClimbPreviews,
                                          setup: board.setup,
                                          visibleHoldSetIDs: renderHoldSetIDs)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Recently viewed")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear") { recentProblemsCSV = ""; showingRecent = false }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { showingRecent = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// Horizontal inset matching a grouped-list row's default content margin, so
    /// the edge-to-edge sort rows still align with the sheet's other rows at rest.
    private let rowInset: CGFloat = 20

    /// A sort-selection pill used in the filter sheet's "Sort by" / "Then by"
    /// rows: accent-filled when selected, neutral otherwise.
    @ViewBuilder
    private func sortPill(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(on ? Color.white : Color.primary)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(on ? AnyShapeStyle(Color.accentColor)
                               : AnyShapeStyle(Color(.secondarySystemFill)),
                            in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private var filterSheet: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("Grade range")
                        Spacer()
                        Text(clampedLower == clampedUpper
                             ? gradeList[clampedLower]
                             : "\(gradeList[clampedLower])–\(gradeList[clampedUpper])")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    GradeRangeSlider(lower: lowerBinding,
                                     upper: upperBinding,
                                     grades: gradeList)
                        .padding(.vertical, 8)
                } footer: {
                    Text("Drag either handle to set the minimum and maximum grade.")
                }
                Section {
                    Button { showingHoldPicker = true } label: {
                        HStack {
                            Text("Holds")
                            Spacer()
                            Text(selectedHolds.isEmpty ? "Any"
                                 : selectedHolds.count == 1 ? "1 selected"
                                 : "\(selectedHolds.count) selected")
                                .foregroundStyle(.secondary)
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .foregroundStyle(.primary)
                } footer: {
                    Text("Tap holds on the board to show only problems that use them.")
                }
                Section("Sort by") {
                    // Zero the row's horizontal insets so the pill rows can scroll
                    // edge-to-edge (clipping at the card edge, not the padding line);
                    // the content re-adds the inset so it still lines up at rest.
                    VStack(alignment: .leading, spacing: 12) {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(SortKey.allCases) { key in
                                    sortPill(key.rawValue, on: sortPrimary == key) {
                                        selectPrimary(key)
                                    }
                                }
                            }
                            .padding(.horizontal, rowInset)
                        }
                        Divider().padding(.horizontal, rowInset)
                        // Optional tiebreaker. Tapping the selected pill again
                        // clears it (no key = the old "None").
                        Text("Then by")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, rowInset)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(secondaryOptions) { key in
                                    sortPill(key.rawValue, on: sortSecondary == key) {
                                        toggleSecondary(key)
                                    }
                                }
                            }
                            .padding(.horizontal, rowInset)
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 11, leading: 0, bottom: 11, trailing: 0))
                }
                Section("Filters") {
                    ForEach(CatalogFilter.allCases) { filter in
                        Button { toggleFilter(filter) } label: {
                            HStack {
                                Text(filter.rawValue)
                                Spacer()
                                if selectedFilters.contains(filter) {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
                Section {
                    Picker("Minimum rating", selection: $minStars) {
                        Text("Any").tag(0)
                        ForEach(1...5, id: \.self) { n in
                            Text("\(n)★ and up").tag(n)
                        }
                    }
                }
                Section("Method") {
                    ForEach(Self.methodChoices, id: \.self) { method in
                        Button { toggleMethod(method) } label: {
                            HStack {
                                Text(method)
                                Spacer()
                                if selectedMethods.contains(method) {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
                Section {
                    Button("Reset filters") {
                        lowerGrade = 0
                        upperGrade = gradeMaxIndex
                        minStars = 0
                        filtersCSV = ""
                        methodsCSV = ""
                        resetSort()
                        holdFilterCSV = ""
                    }
                    .disabled(!filtersActive)
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { showingFilters = false }
                }
            }
            // Anchored inside the filter sheet (a cover from the root would first
            // dismiss this one). A full-screen cover — not a stacked sheet — gives
            // the board edge-to-edge room and avoids the double-card look.
            .fullScreenCover(isPresented: $showingHoldPicker) {
                HoldFilterPickerView(board: board,
                                     visibleHoldSetIDs: renderHoldSetIDs,
                                     activeSetIDs: activeHoldSets,
                                     selection: holdSelectionBinding)
            }
        }
        .presentationDetents([.medium])
    }
}

/// A two-thumb slider for selecting an inclusive `[lower, upper]` band over a
/// fixed, ordered list of discrete values (here, font grades). The thumbs
/// snap to value indices and can't cross each other.
private struct GradeRangeSlider: View {
    @Binding var lower: Int
    @Binding var upper: Int
    let grades: [String]

    private let thumbSize: CGFloat = 28
    private let trackHeight: CGFloat = 4

    var body: some View {
        GeometryReader { geo in
            let count = max(grades.count, 1)
            let usable = max(geo.size.width - thumbSize, 1)
            let step = count > 1 ? usable / CGFloat(count - 1) : 0
            let lowerX = CGFloat(lower) * step
            let upperX = CGFloat(upper) * step

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color(.systemGray4))
                    .frame(height: trackHeight)
                    .padding(.horizontal, thumbSize / 2)

                Capsule()
                    .fill(Color.accentColor)
                    .frame(width: max(upperX - lowerX, 0), height: trackHeight)
                    .offset(x: lowerX + thumbSize / 2)

                thumb
                    .offset(x: lowerX)
                    .gesture(DragGesture().onChanged { value in
                        let idx = Int((value.location.x - thumbSize / 2) / step + 0.5)
                        lower = min(max(0, idx), upper)
                    })

                thumb
                    .offset(x: upperX)
                    .gesture(DragGesture().onChanged { value in
                        let idx = Int((value.location.x - thumbSize / 2) / step + 0.5)
                        upper = max(min(count - 1, idx), lower)
                    })
            }
        }
        .frame(height: thumbSize)
    }

    private var thumb: some View {
        Circle()
            .fill(.white)
            .overlay(Circle().strokeBorder(Color.accentColor, lineWidth: 2))
            .frame(width: thumbSize, height: thumbSize)
            .shadow(color: .black.opacity(0.15), radius: 2, y: 1)
    }
}
