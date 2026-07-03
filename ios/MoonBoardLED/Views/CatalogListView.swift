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
    /// The three status cases (`completed`/`projects`/`notCompleted`) are combined with
    /// OR; `benchmarks` and `favorites` each AND on top. `completed` = sent; `projects`
    /// = tried but not sent; `notCompleted` = anything not sent (projects + never-touched,
    /// i.e. the merged `!sent` bucket — this absorbs the old "Not logged" filter). Old
    /// persisted selections are normalized once by `CatalogFilterMigration`.
    enum CatalogFilter: String, CaseIterable, Identifiable {
        case benchmarks   = "Benchmarks"
        case completed    = "Completed"
        case projects     = "Projects"
        case notCompleted = "Not completed"
        case favorites    = "Favorites"

        var id: String { rawValue }
        /// The status cases form one OR'd group.
        static var statusCases: [CatalogFilter] { [.completed, .projects, .notCompleted] }
    }

    let board: Board
    let angle: Int

    @Query(filter: #Predicate<Ascent> { !$0.tombstoned }) private var ascents: [Ascent]
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
    /// Collaborative-lists hub. Drives the optional group lens (U1): when a list is
    /// active AND its board matches this catalog, the catalog gains per-member sub-chips,
    /// per-person badges, and swipe-to-add. When no list is active the catalog is solo.
    @EnvironmentObject private var lists: ListsManager
    /// The me/us toggle. `true` = "Just me" (solo view) even while a list is active, so
    /// the user can flip back to their own catalog without leaving the list context.
    @State private var showMine = false
    /// Selected per-member group chips (member × status bucket). Empty = no group
    /// narrowing (GroupFilter.passes returns true), so an active lens with no chips is
    /// the full catalog with badges.
    @State private var groupSelection: Set<GroupChip> = []

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

    /// The filtered + sorted result, computed off the main thread (filtering and
    /// sorting ~4,889 problems in `body` froze the screen during the navigation
    /// push). Populated by the compute task below; the list reads this directly.
    @State private var displayed: [CatalogProblem] = []
    /// Whether the first async computation has finished, so we can show a spinner
    /// until the list is actually ready instead of a blocked/blank screen.
    @State private var hasComputed = false

    /// Everything that changes the filtered result — used to reset pagination.
    private var filterSignature: String {
        "\(search)|\(filtersCSV)|\(methodsCSV)|\(minStars)|\(lowerGrade)|\(upperGrade)|\(sortPrimary.rawValue)|\(sortSecondaryRaw)|\(activeHoldSetsCSV)|\(holdFilterCSV)"
    }

    /// Drives the off-main recompute task: the filter inputs plus whether the
    /// catalog has loaded and the ascent/favorite-derived sets that a few filters
    /// key on (their counts change when you log an ascent or toggle a favorite).
    private var computeSignature: String {
        "\(loadedCatalog != nil)|\(filterSignature)|\(sentIDs.count)|\(loggedIDs.count)|\(favoriteIDs.count)|\(groupSignature)"
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

    // MARK: - Group lens (U1)

    /// The active collaborative list IF its board matches this catalog's board — board
    /// scoping (KTD5). Nil when no list is active or the boards differ, which forces the
    /// solo view. This is the single gate the whole lens hangs off.
    private var activeList: ListRow? {
        guard let list = lists.activeList, list.board_layout_id == board.id else { return nil }
        return list
    }

    /// Whether the group lens is currently applied: a board-matched list is active AND
    /// the user hasn't toggled to "Just me".
    private var lensActive: Bool { activeList != nil && !showMine }

    /// Members of the active list (for chips + badges); empty when the lens is off.
    private var groupMembers: [Profile] { lensActive ? lists.members : [] }

    /// Per-member sent/tried status for the active list; empty when the lens is off, so
    /// the filter and badges are pure no-ops in solo mode.
    private var groupStatus: [UUID: MemberStatus] { lensActive ? lists.groupStatus : [:] }

    /// The group selection actually applied (empty when the lens is off).
    private var appliedGroupSelection: Set<GroupChip> { lensActive ? groupSelection : [] }

    /// Recompute token for the group lens — folds selection + a status fingerprint so
    /// toggling chips or refreshing group status re-runs the off-main filter.
    private var groupSignature: String {
        let sel = appliedGroupSelection
            .map { "\($0.memberID.uuidString):\($0.bucket.rawValue)" }
            .sorted()
            .joined(separator: ",")
        let statusFingerprint = groupStatus.values.reduce(0) { $0 + $1.sent.count + $1.tried.count }
        return "\(lensActive)|\(sel)|\(statusFingerprint)"
    }

    /// Per-person badges for a catalog row in lens mode (U2); nil in solo mode so rows
    /// render unchanged. One entry per member, colored by their status for this problem.
    private func groupBadges(for catalogID: String) -> [(handle: String, color: Color)]? {
        guard lensActive else { return nil }
        return groupMembers.map {
            (handle: $0.handle, color: memberStatusColor(groupStatus[$0.id], catalogID: catalogID))
        }
    }

    /// Catalog ids already in the active list's pile (U3), so a swipe-add on an
    /// already-added problem is suppressed.
    private var pileIDs: Set<String> { Set(lists.pile.map(\.source_catalog_id)) }

    /// Snapshot all filter inputs, then filter + sort off the main thread.
    /// Everything here is a value type (or the pre-resolved `membership`
    /// instance), so it's safe to hand to a detached task — see the compute task.
    private func computeDisplayed() async -> [CatalogProblem] {
        let problems = catalog.problems
        let sent = sentIDs
        let logged = loggedIDs
        let favs = favoriteIDs
        let selected = selectedFilters
        let activeSets = activeHoldSets
        let subset = holdSetSubsetActive
        let selectedMethodSet = selectedMethods
        let holdSet = selectedHolds
        let grades = gradeList
        let lo = clampedLower
        let hi = clampedUpper
        let minStarsSnapshot = minStars
        let searchSnapshot = search
        // Resolve the membership instance on the main actor (its loader touches a
        // static cache); the instance's reads are pure and thread-safe.
        let membershipSnapshot = membership
        let keys = [sortPrimary] + (sortSecondary.map { [$0] } ?? [])
        // Group-lens snapshots (empty in solo mode, so the filter is a no-op there).
        let groupSel = appliedGroupSelection
        let groupStat = groupStatus

        return await Task.detached(priority: .userInitiated) {
            Self.filter(problems: problems, grades: grades, lo: lo, hi: hi,
                        minStars: minStarsSnapshot, selectedMethods: selectedMethodSet,
                        subset: subset, membership: membershipSnapshot, activeSets: activeSets,
                        holdSet: holdSet, selected: selected, sent: sent, logged: logged,
                        favs: favs, search: searchSnapshot, keys: keys,
                        groupSelection: groupSel, groupStatus: groupStat)
        }.value
    }

    /// Pure filter + sort over the catalog. Static so it carries no `self` and can
    /// run on a background thread. Grade indexing is hoisted out of the per-problem
    /// loop (rebuilding it per problem made this O(n²)).
    private static func filter(problems: [CatalogProblem], grades: [String],
                               lo: Int, hi: Int, minStars: Int,
                               selectedMethods: Set<String>, subset: Bool,
                               membership: HoldSetMembership, activeSets: Set<Int>,
                               holdSet: Set<String>, selected: Set<CatalogFilter>,
                               sent: Set<String>, logged: Set<String>, favs: Set<String>,
                               search: String, keys: [SortKey],
                               groupSelection: Set<GroupChip>,
                               groupStatus: [UUID: MemberStatus]) -> [CatalogProblem] {
        let gradeIndexByValue = Dictionary(grades.enumerated().map { ($0.element, $0.offset) },
                                           uniquingKeysWith: { a, _ in a })
        let matches = problems.filter { p in
            // Unknown grades (not in this board's list) are always shown.
            let gradeOK = gradeIndexByValue[p.grade].map { $0 >= lo && $0 <= hi } ?? true
            return gradeOK &&
            p.stars >= minStars &&
            (selectedMethods.isEmpty || selectedMethods.contains(p.method ?? "Any marked holds")) &&
            (!subset || membership.isClimbable(holds: p.holds, activeSetIDs: activeSets)) &&
            (holdSet.isEmpty || holdSet.isSubset(of: Set(p.holds.map { "\($0.c)-\($0.r)" }))) &&
            matchesFilters(p, selected: selected, sent: sent, logged: logged, favs: favs) &&
            // Group lens: an empty selection returns true (no-op in solo mode).
            GroupFilter.passes(catalogID: p.id, selection: groupSelection, status: groupStatus) &&
            (search.isEmpty
             || p.name.localizedCaseInsensitiveContains(search)
             || p.setter.localizedCaseInsensitiveContains(search))
        }
        return sort(matches, keys: keys)
    }

    /// Faceted match: the selected status filters are OR'd together, while
    /// Benchmarks and Favorites each apply as an additional AND constraint.
    private static func matchesFilters(_ p: CatalogProblem,
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
            case .completed:    return sent.contains(p.id)
            case .projects:     return logged.contains(p.id) && !sent.contains(p.id)
            case .notCompleted: return !sent.contains(p.id)
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

    private static func sort(_ problems: [CatalogProblem], keys: [SortKey]) -> [CatalogProblem] {
        problems.sorted { a, b in
            for key in keys {
                switch key.order(a, b, gradeIndex: FontGrade.index(of:)) {
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

    /// The group lens control shown at the top of the catalog when a collaborative list
    /// is active on this board (U1): a "Just me / [list]" toggle and, in group mode,
    /// per-member chips under each status bucket. Absent entirely in solo mode.
    @ViewBuilder
    private var groupBarSection: some View {
        if let activeList {
            Section {
                Picker("View", selection: $showMine) {
                    Text("Just me").tag(true)
                    Text(activeList.name.isEmpty ? "The list" : activeList.name).tag(false)
                }
                .pickerStyle(.segmented)

                if lensActive {
                    ForEach(StatusBucket.allCases) { bucket in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(bucket.label)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(groupMembers) { member in
                                        groupChip(member: member, bucket: bucket)
                                    }
                                }
                            }
                        }
                    }
                }
            } header: {
                Text("Group")
            }
        }
    }

    private func groupChip(member: Profile, bucket: StatusBucket) -> some View {
        let gc = GroupChip(memberID: member.id, bucket: bucket)
        let on = groupSelection.contains(gc)
        return Button {
            if on { groupSelection.remove(gc) } else { groupSelection.insert(gc) }
        } label: {
            Text("@\(member.handle)")
                .font(.caption.weight(.medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(on ? Color.accentColor : Color(.systemGray5), in: Capsule())
                .foregroundStyle(on ? .white : .primary)
        }
        .buttonStyle(.plain)
    }

    var body: some View {
            // Read the pre-computed list (filtered/sorted off the main thread) and
            // build the lookup sets ONCE per render — never per row (per-row
            // rebuilds of these made the list O(n²)/laggy).
            let problems = displayed
            let shown = visibleLimit >= problems.count ? problems : Array(problems.prefix(visibleLimit))
            let sent = sentIDs
            let favs = favoriteIDs
            let renderIDs = renderHoldSetIDs
            return Group {
                // Spinner until the catalog has decoded AND the first filter/sort
                // has finished — so tapping a board never lands on a frozen screen.
                if loadedCatalog == nil || !hasComputed {
                    ProgressView {
                        VStack(spacing: 4) {
                            Text("Loading \(board.name) problems")
                                .font(.headline)
                            Text("Getting the list ready — just a moment.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if catalog.problems.isEmpty {
                    ContentUnavailableView {
                        Label("No catalog bundled", systemImage: "tray")
                    } description: {
                        Text("This board's problem catalog hasn't been bundled yet.")
                    }
                } else {
                    List {
                        groupBarSection
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
                                                      visibleHoldSetIDs: renderIDs,
                                                      groupBadges: groupBadges(for: problem.id))
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .onAppear {
                                    // Load the next page when the last visible row shows.
                                    if problem.id == shown.last?.id && shown.count < problems.count {
                                        visibleLimit += Self.pageSize
                                    }
                                }
                                // Group lens: swipe-left to add this problem to the shared
                                // pile (U3). Only present in lens mode and only when the
                                // problem isn't already in the pile; solo rows are unaffected.
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    if lensActive, let list = activeList, !pileIDs.contains(problem.id) {
                                        Button {
                                            Task {
                                                try? await lists.addProblem(
                                                    listId: list.id,
                                                    sourceCatalogID: problem.id,
                                                    boardLayoutId: board.id
                                                )
                                            }
                                        } label: {
                                            Label("Add", systemImage: "plus")
                                        }
                                        .tint(.green)
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
            // Recompute the filtered/sorted list off the main thread whenever the
            // catalog loads or a filter/sort/search changes. `.task(id:)` cancels
            // the prior run, and we drop its result if cancelled so a stale filter
            // can't overwrite a newer one. The old list stays on screen while a
            // recompute is in flight (no spinner flicker after the first load).
            .task(id: computeSignature) {
                guard loadedCatalog != nil else { return }
                let result = await computeDisplayed()
                if Task.isCancelled { return }
                displayed = result
                hasComputed = true
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
