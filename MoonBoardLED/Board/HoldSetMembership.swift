import Foundation

/// Which hold set each grid position belongs to, loaded from a bundled
/// `<board>HoldSets.json` (produced by `scripts/derive_holdset_membership.py`).
///
/// Used to answer "can I climb this problem with only these hold sets installed?"
/// — a problem is climbable iff every one of its holds is owned by an active set.
struct HoldSetMembership: Decodable {
    /// "col-row" (col 0–10, row 1 = bottom) → hold-set id.
    let membership: [String: Int]

    static let empty = HoldSetMembership(membership: [:])

    private static var cache: [String: HoldSetMembership] = [:]

    /// Load a board's membership by resource name. Empty if not bundled.
    static func load(resource: String) -> HoldSetMembership {
        if let cached = cache[resource] { return cached }
        let value: HoldSetMembership
        if let url = Bundle.main.url(forResource: resource, withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode(HoldSetMembership.self, from: data) {
            value = decoded
        } else {
            value = .empty
        }
        cache[resource] = value
        return value
    }

    /// Hold-set id owning the hold at this position, or nil if no set does.
    func setID(col: Int, row: Int) -> Int? { membership["\(col)-\(row)"] }

    /// True if every hold is owned by one of `activeSetIDs`. An empty membership
    /// map (not bundled) never filters — every problem is climbable.
    func isClimbable(holds: [CatalogHold], activeSetIDs: Set<Int>) -> Bool {
        guard !membership.isEmpty else { return true }
        return holds.allSatisfy { hold in
            guard let id = setID(col: hold.c, row: hold.r) else { return false }
            return activeSetIDs.contains(id)
        }
    }
}

/// Reads/writes a board's active (installed) hold sets, persisted as a "|"-joined
/// id string in `@AppStorage(board.activeHoldSetsKey)`. Only *filterable* hold
/// sets (those owning grid holds) participate; feet-only sets are always-on art.
/// Empty (or all-active) means the board is full — no filtering.
enum ActiveHoldSets {
    /// Parse the stored string into filterable set ids. Empty → all filterable active.
    static func ids(from csv: String, in board: Board) -> Set<Int> {
        let all = Set(board.filterableHoldSets.map(\.id))
        let stored = Set(csv.split(separator: "|").compactMap { Int($0) }).intersection(all)
        return stored.isEmpty ? all : stored
    }

    /// Canonical storage string. All filterable sets active → "" (filter off).
    static func csv(from ids: Set<Int>, in board: Board) -> String {
        if ids.count >= board.filterableHoldSets.count { return "" }
        return ids.sorted().map(String.init).joined(separator: "|")
    }

    static func isAllActive(_ ids: Set<Int>, in board: Board) -> Bool {
        ids.count >= board.filterableHoldSets.count
    }

    /// "All hold sets" when full, else a comma list of active set names in order.
    static func subtitle(_ ids: Set<Int>, in board: Board) -> String {
        if isAllActive(ids, in: board) { return "All hold sets" }
        return board.filterableHoldSets.filter { ids.contains($0.id) }
            .map(\.name).joined(separator: ", ")
    }

    /// Hold-set layers to RENDER for a selection: active filterable sets plus the
    /// always-on (feet) sets, so feet art never disappears.
    static func visible(_ ids: Set<Int>, in board: Board) -> Set<Int> {
        ids.union(board.alwaysOnHoldSetIDs)
    }
}
