import SwiftUI
import SwiftData

/// Browse the bundled, read-only catalog of official Mini MoonBoard 2025
/// problems. Separate from the user's own problems — view and light only.
struct CatalogListView: View {
    /// Sort orders available in the filter sheet. `default` keeps the catalog's
    /// own (JSON) order.
    private enum SortOrder: String, CaseIterable, Identifiable {
        case `default`    = "Default"
        case highestRated = "Highest rated"
        case easiest      = "Easiest first"
        case hardest      = "Hardest first"

        var id: String { rawValue }
    }

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
    @AppStorage("catalogSortOrder") private var sortOrder: SortOrder = .default
    @AppStorage("showClimbPreviews") private var showClimbPreviews = true
    /// Active hold sets installed on this board (shared with Home + the editor).
    @AppStorage private var activeHoldSetsCSV: String

    /// Catalog is decoded off the main thread (4,889 problems is heavy) so tapping
    /// a board is instant; nil until loaded, which drives the loading state.
    @State private var loadedCatalog: Catalog?

    init(board: Board, angle: Int) {
        self.board = board
        self.angle = angle
        // No catalog decode here — the upper-grade default is a sentinel that's
        // clamped to the real grade list once the catalog loads.
        _lowerGrade = AppStorage(wrappedValue: 0, "catalogLowerGrade_\(board.id)_\(angle)")
        _upperGrade = AppStorage(wrappedValue: 999, "catalogUpperGrade_\(board.id)_\(angle)")
        _activeHoldSetsCSV = AppStorage(wrappedValue: "", board.activeHoldSetsKey)
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
    /// Drives navigation to the problem pager, built lazily on tap.
    @State private var selectedProblem: CatalogProblem?

    /// Incremental rendering: show this many rows, growing by `pageSize` as you
    /// scroll to the end. Reset to one page whenever the filtered set changes.
    private static let pageSize = 30
    @State private var visibleLimit = CatalogListView.pageSize

    /// Everything that changes the filtered result — used to reset pagination.
    private var filterSignature: String {
        "\(search)|\(filtersCSV)|\(methodsCSV)|\(minStars)|\(lowerGrade)|\(upperGrade)|\(sortOrder.rawValue)|\(activeHoldSetsCSV)"
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

    private func sorted(_ problems: [CatalogProblem]) -> [CatalogProblem] {
        switch sortOrder {
        case .default:
            return problems
        case .highestRated:
            return problems.sorted { $0.stars > $1.stars }
        case .easiest:
            return problems.sorted { gradeIndex($0.grade) < gradeIndex($1.grade) }
        case .hardest:
            return problems.sorted { gradeIndex($0.grade) > gradeIndex($1.grade) }
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
                CatalogProblemPager(problems: problems, current: problem,
                                    board: board, visibleHoldSetIDs: renderIDs)
            }
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
                if filtersActive || holdSetSubsetActive { activeFilterBar }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showClimbPreviews.toggle() } label: {
                        Image(systemName: showClimbPreviews ? "square.grid.2x2.fill" : "square.grid.2x2")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingFilters = true } label: {
                        Image(systemName: filtersActive
                              ? "line.3.horizontal.decrease.circle.fill"
                              : "line.3.horizontal.decrease.circle")
                    }
                }
            }
            .sheet(isPresented: $showingFilters) {
                filterSheet
            }
            .sheet(isPresented: $showingHoldSetEditor) {
                HoldSetEditorView(board: board)
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
        // Hold-set config reads as a board setting: tapping opens the editor, its
        // ✕ re-installs all sets (rather than clearing a catalog filter).
        if holdSetSubsetActive {
            items.append(.init(label: ActiveHoldSets.subtitle(activeHoldSets, in: board),
                               tap: { showingHoldSetEditor = true },
                               clear: { activeHoldSetsCSV = "" }))
        }
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
        for filter in CatalogFilter.allCases where selectedFilters.contains(filter) {
            items.append(.init(label: filter.rawValue) { toggleFilter(filter) })
        }
        for method in Self.methodChoices where selectedMethods.contains(method) {
            items.append(.init(label: method) { toggleMethod(method) })
        }
        if sortOrder != .default {
            items.append(.init(label: sortOrder.rawValue) { sortOrder = .default })
        }
        return items
    }

    private var filtersActive: Bool {
        gradeRangeActive || minStars > 0 || !filtersCSV.isEmpty
            || !methodsCSV.isEmpty || sortOrder != .default
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
                Section("Sort") {
                    Picker("Sort by", selection: $sortOrder) {
                        ForEach(SortOrder.allCases) { order in
                            Text(order.rawValue).tag(order)
                        }
                    }
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
                        sortOrder = .default
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
