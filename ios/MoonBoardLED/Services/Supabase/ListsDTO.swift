import Foundation

/// Wire shapes for the collaborative-lists tables (`lists`, `list_members`,
/// `list_problems`) and the `list_member_status` RPC. snake_case property names match
/// the Postgres columns directly (same convention as `LogbookDTO` — no CodingKeys
/// needed), so the PostgREST decoder maps them without a key strategy.
///
/// Unlike the logbook DTOs these are NOT part of the offline sync spine (lists are
/// cloud-only in v1), so timestamps here are decode-only strings we never parse for
/// cursor math — they exist for ordering and display, not last-write-wins.

/// A collaborative list row (read shape).
struct ListRow: Codable, Identifiable, Equatable {
    var id: UUID
    var owner_id: UUID
    var name: String
    var board_layout_id: Int
    var invite_token: UUID
    var created_at: String
    var updated_at: String?
    var deleted: Bool
}

/// A membership row (who is in a list).
struct ListMemberRow: Codable, Equatable {
    var list_id: UUID
    var user_id: UUID
    var joined_at: String
}

/// A problem in a list's shared pile (read shape).
struct ListProblemRow: Codable, Identifiable, Equatable {
    var id: UUID
    var list_id: UUID
    var source_catalog_id: String
    var board_layout_id: Int
    var added_by: UUID?
    var created_at: String
    var updated_at: String?
    var deleted: Bool
}

/// One row of the `list_member_status` RPC: a single member's status for one catalog
/// problem. The RPC returns ONLY these three columns (the privacy contract — no
/// comments/grades/dates ever cross to co-members). Folded client-side into per-member
/// sent/tried sets by `ListsManager` (U5).
struct MemberStatusRow: Codable, Equatable {
    var user_id: UUID
    var source_catalog_id: String
    var sent: Bool
}

/// One row of the `preview_list_by_token` RPC: a not-yet-member's read-only preview of a
/// list they hold an invite link for (name + inviter), used to show a consent prompt
/// before joining.
struct ListPreviewRow: Codable, Equatable {
    var list_id: UUID
    var name: String
    var owner_handle: String
}

// MARK: - Write shapes

/// Insert shape for a new list. id / invite_token / timestamps are server-defaulted;
/// the owner is seated as the first member by a DB trigger (see 0003).
struct ListInsert: Encodable {
    let owner_id: UUID
    let name: String
    let board_layout_id: Int
}

/// Insert shape for adding a catalog problem to a list's pile.
struct ListProblemInsert: Encodable {
    let list_id: UUID
    let source_catalog_id: String
    let board_layout_id: Int
    let added_by: UUID
}
