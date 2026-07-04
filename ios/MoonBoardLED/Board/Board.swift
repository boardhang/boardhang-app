import Foundation

/// A board the app supports end-to-end: its art/geometry (`MoonBoardSetup`), the
/// bundled problem catalog(s), hold-set membership, LED row count, and the
/// per-board `@AppStorage` keys for its settings. This is what parameterizes the
/// catalog, editor, lighting and calibration so they work for any board.
struct Board: Identifiable, Hashable {
    let setup: MoonBoardSetup
    /// Wall angles with a bundled catalog (e.g. [40] or [40, 25]).
    let angles: [Int]
    /// Bundled catalog resource base name.
    let catalogPrefix: String
    /// Bundled hold-set membership resource name.
    let membershipResource: String

    var id: Int { setup.id }
    var name: String { setup.name }
    /// Compact name for chips/pills (e.g. "Mini 2025").
    var shortName: String { setup.shortName }
    /// LED row count for this board (Mini 12, full 18).
    var rows: Int { setup.geometry.rowTop }
    var hasAngleChoice: Bool { angles.count > 1 }
    var defaultAngle: Int { angles.first ?? 40 }

    /// Catalog resource for an angle. Single-angle boards ignore the suffix.
    func catalogResource(angle: Int) -> String {
        hasAngleChoice ? "\(catalogPrefix)_\(angle)" : catalogPrefix
    }

    func catalog(angle: Int) -> Catalog { Catalog.load(resource: catalogResource(angle: angle)) }

    // MARK: Per-board settings keys
    var activeHoldSetsKey: String { "activeHoldSets_\(id)" }
    var flippedKey: String { "flipped_\(id)" }
    var angleKey: String { "angle_\(id)" }

    // MARK: Hold-set membership
    var membership: HoldSetMembership { HoldSetMembership.load(resource: membershipResource) }

    /// Hold sets that own ≥1 numbered grid hold — the ones the filter/editor use.
    var filterableHoldSets: [MoonBoardHoldSet] {
        let owned = Set(membership.membership.values)
        return setup.holdSets.filter { owned.contains($0.id) }
    }

    /// Sets that own no grid holds (e.g. Screw-on Feet) — always rendered as art,
    /// never part of the filter.
    var alwaysOnHoldSetIDs: Set<Int> {
        let owned = Set(membership.membership.values)
        return Set(setup.holdSets.map(\.id)).subtracting(owned)
    }

    /// The picker's grade range: the contiguous span of the canonical Font scale
    /// that this board's catalog (at `angle`) actually uses.
    func gradeList(angle: Int) -> [String] {
        let present = Set(catalog(angle: angle).problems.map(\.grade))
        let idxs = present.compactMap { FontGrade.all.firstIndex(of: $0) }
        guard let lo = idxs.min(), let hi = idxs.max() else { return FontGrade.all }
        return Array(FontGrade.all[lo...hi])
    }

    static func == (a: Board, b: Board) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    // MARK: Registry
    static let mini2025 = Board(
        setup: .mini2025, angles: [40],
        catalogPrefix: "MiniMoonBoard2025Catalog",
        membershipResource: "MiniMoonBoard2025HoldSets")

    static let masters2019 = Board(
        setup: MoonBoardSetup.with(id: 5)!, angles: [40, 25],
        catalogPrefix: "MoonBoardMasters2019Catalog",
        membershipResource: "MoonBoardMasters2019HoldSets")

    static let moonboard2024 = Board(
        setup: MoonBoardSetup.with(id: 3)!, angles: [40, 25],
        catalogPrefix: "MoonBoard2024Catalog",
        membershipResource: "MoonBoard2024HoldSets")

    static let moonboard2016 = Board(
        setup: MoonBoardSetup.with(id: 2)!, angles: [40, 25],
        catalogPrefix: "MoonBoard2016Catalog",
        membershipResource: "MoonBoard2016HoldSets")

    static let masters2017 = Board(
        setup: MoonBoardSetup.with(id: 4)!, angles: [40, 25],
        catalogPrefix: "MoonBoardMasters2017Catalog",
        membershipResource: "MoonBoardMasters2017HoldSets")

    /// Every board the app supports, in registry order. This is the catalog of
    /// what *can* be added — the boards a user actually owns are tracked separately
    /// by `AddedBoards`.
    static let all: [Board] = [mini2025, masters2019, moonboard2024, masters2017, moonboard2016]

    static func with(layoutId: Int) -> Board { all.first { $0.id == layoutId } ?? mini2025 }
}

/// The boards the user has added to their app, persisted as a "|"-joined list of
/// layout ids in `@AppStorage(AddedBoards.storageKey)`. Empty = none added yet (the
/// first-launch onboarding state). Order is insertion order: appended on add, so
/// the last id is the most-recently-added board (used when reassigning the active
/// board after a delete). Ids that no longer map to a supported board are ignored.
enum AddedBoards {
    static let storageKey = "addedBoards"

    /// Added board ids, in insertion order, de-duplicated and filtered to boards the
    /// app still supports.
    static func ids(from csv: String) -> [Int] {
        let supported = Set(Board.all.map(\.id))
        var seen = Set<Int>()
        return csv.split(separator: "|").compactMap { Int($0) }
            .filter { supported.contains($0) && seen.insert($0).inserted }
    }

    /// The added boards, in insertion order.
    static func boards(from csv: String) -> [Board] {
        ids(from: csv).map(Board.with(layoutId:))
    }

    /// Supported boards not yet added, in registry order — the pick-list for the
    /// add flow. Empty means every board has been added.
    static func available(from csv: String) -> [Board] {
        let added = Set(ids(from: csv))
        return Board.all.filter { !added.contains($0.id) }
    }

    static func csv(from ids: [Int]) -> String {
        ids.map(String.init).joined(separator: "|")
    }

    /// Move a board to the front of the most-recently-used order, adding it if it
    /// isn't present. Called when a board is added or activated, so the front of the
    /// list is always the most recently used board.
    static func promoting(_ id: Int, in csv: String) -> String {
        var list = ids(from: csv).filter { $0 != id }
        list.insert(id, at: 0)
        return self.csv(from: list)
    }

    /// The added-boards CSV as currently persisted (app-global state).
    static var currentCSV: String {
        UserDefaults.standard.string(forKey: storageKey) ?? ""
    }
}

/// Resolves a logged ascent's `sourceCatalogID` back to its board + problem, across every
/// synced board/angle slab, so the logbook (and future collaborative lists) can render and
/// navigate an ascent regardless of which board it came from.
///
/// Built off the main thread from the synced disk cache and cached until invalidated. The
/// build decodes every synced slab (thousands of problems), so lookups are deliberately
/// **non-blocking**: `entry` returns whatever is cached and kicks a background rebuild on a
/// miss — it never decodes inline on the calling thread. Until the first build lands (and
/// briefly after each `invalidate`) a lookup returns nil, and callers fall back to the
/// ascent's denormalized name/grade snapshot. When the build finishes,
/// `CatalogIndexReadiness` nudges observing views (Home, Logbook) to re-render.
///
/// The catalog is server-distributed and synced lazily per board, so an id only resolves once
/// its slab has synced — `CatalogSyncManager` calls `invalidate()` after each pull to fold in
/// freshly synced ids.
enum CatalogIndex {
    struct Entry { let board: Board; let problem: CatalogProblem }

    private static var cache: [String: Entry]?
    /// A build is running on a background task; new triggers coalesce into it.
    private static var building = false
    /// An `invalidate` arrived mid-build, so the in-flight result is already stale and the
    /// build re-runs once against the fresher slabs before publishing.
    private static var staleWhileBuilding = false
    private static let lock = NSLock()

    /// Drop the cached index and rebuild it (off the main thread) from the current disk
    /// slabs. Called after a catalog sync so freshly synced ids start resolving.
    static func invalidate() {
        lock.lock()
        cache = nil
        if building { staleWhileBuilding = true }
        lock.unlock()
        warm()
    }

    /// Non-blocking lookup. Returns the resolved entry when the index is built, otherwise nil
    /// (callers fall back to the ascent's snapshot) — and kicks a background build on a miss.
    static func entry(forCatalogID id: String?) -> Entry? {
        guard let id else { return nil }
        lock.lock()
        let cached = cache
        lock.unlock()
        if let cached { return cached[id] }
        warm()
        return nil
    }

    /// Build the id→entry map off the main thread if it isn't cached and no build is already
    /// running. Idempotent and safe to call from anywhere (a warm cache returns immediately).
    static func warm() {
        lock.lock()
        guard cache == nil, !building else { lock.unlock(); return }
        building = true
        staleWhileBuilding = false
        lock.unlock()
        Task.detached(priority: .utility) { build() }
    }

    private static func build() {
        var idx: [String: Entry] = [:]
        for board in Board.all {
            for angle in board.angles {
                for p in board.catalog(angle: angle).problems where idx[p.id] == nil {
                    idx[p.id] = Entry(board: board, problem: p)
                }
            }
        }
        lock.lock()
        // An invalidate landed while we were decoding — rebuild against the fresher slabs
        // rather than publishing a stale index.
        if staleWhileBuilding {
            staleWhileBuilding = false
            lock.unlock()
            build()
            return
        }
        cache = idx
        building = false
        lock.unlock()
        Task { await CatalogIndexReadiness.shared.markReady() }
    }
}

/// Observable readiness signal for `CatalogIndex`. Because the index builds off the main
/// thread, populating its cache doesn't itself refresh SwiftUI; views that resolve ascents
/// through the index (Home, Logbook) read `generation` so they re-render once a build lands.
@MainActor @Observable
final class CatalogIndexReadiness {
    static let shared = CatalogIndexReadiness()
    private init() {}

    /// Bumped each time the index finishes (re)building.
    private(set) var generation = 0

    func markReady() { generation &+= 1 }
}

extension Ascent {
    /// The board this ascent belongs to for filtering. When the ascent came from a
    /// catalog problem, its board is resolved from that problem — authoritative even
    /// if the stored `boardLayoutId` is stale (e.g. attempts logged before the board
    /// id was threaded through defaulted to the Mini's id). Falls back to the stored
    /// `boardLayoutId` for user-created problems, which have no catalog id.
    var effectiveBoardLayoutId: Int {
        CatalogIndex.entry(forCatalogID: sourceCatalogID)?.board.id ?? boardLayoutId
    }
}
