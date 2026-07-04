import Foundation
import Supabase

/// The collaborative-lists hub, injected app-wide as a `@StateObject` alongside
/// `AuthManager` / `LogbookSyncManager`. Mirrors `AuthManager`'s shape: it owns the
/// Supabase calls for lists so the rest of the app never talks to the SDK directly,
/// and it stays inert (`isConfigured == false`) when the app is built without backend
/// config — the Lists surface then simply doesn't appear.
///
/// **Cloud-only in v1 (KTD2):** lists, members, pile, and group status are read-through
/// from Supabase (fetch on open + pull-to-refresh); there is deliberately no SwiftData
/// mirror and no offline sync spine. The user's own logbook stays local-first as before;
/// only this social layer requires connectivity.
@MainActor
final class ListsManager: ObservableObject {

    /// The lists the current user belongs to (owner or member), newest first.
    @Published private(set) var myLists: [ListRow] = []

    /// Set after a successful share-link join so the Lists tab can push straight to the
    /// joined list. The UI clears it once consumed.
    @Published var pendingOpenListId: UUID?

    /// A share-link invite awaiting the user's consent. Set when a `join?token=` deep link
    /// resolves to a real list; the UI shows a confirmation (join exposes your sent/tried
    /// sets) and only joins on accept. Nil = no pending invite.
    @Published var pendingInvite: ListInvitePreview?

    /// The list whose group lens the main catalog is showing, if any. Set by "Browse
    /// together"; session-scoped (not persisted), mirroring the active-board selection.
    /// When nil, the catalog is in solo mode. The catalog additionally board-scopes this
    /// (the lens only applies while the catalog is on the list's board).
    @Published var activeListId: UUID?

    /// The active list resolved from `myLists`, or nil.
    var activeList: ListRow? {
        guard let id = activeListId else { return nil }
        return myLists.first { $0.id == id } ?? (currentList?.id == id ? currentList : nil)
    }

    /// Loaded detail for the currently-open list.
    @Published private(set) var currentList: ListRow?
    @Published private(set) var members: [Profile] = []
    @Published private(set) var pile: [ListProblemRow] = []

    /// The current list's group status, keyed by member id: each member's set of sent
    /// and tried catalog ids (that board). Powers the per-person badges and the group
    /// filter (U8). Refreshed on list-open and pull-to-refresh (refresh-first, no
    /// realtime). Empty until `refreshGroupStatus` runs.
    @Published private(set) var groupStatus: [UUID: MemberStatus] = [:]

    var isConfigured: Bool { client != nil }

    /// The signed-in user's id, or nil when signed out / unconfigured. Used by the UI to
    /// show owner-only actions (RLS is the real enforcement).
    var myUserID: UUID? { client?.auth.currentUser?.id }

    /// nil when the app is built without Supabase config — see SupabaseClientProvider.
    private let client = SupabaseClientProvider.shared

    // MARK: - Lists

    /// Loads the lists the signed-in user can see. RLS already restricts `lists` to rows
    /// the caller owns or is a member of, so a plain select returns exactly those.
    func loadMyLists() async throws {
        let client = try requireClient()
        myLists = try await client
            .from("lists")
            .select()
            .eq("deleted", value: false)
            .order("updated_at", ascending: false)
            .execute()
            .value
    }

    /// Creates a list and returns it. A DB trigger seats the creator as the first member
    /// (0003), so the caller immediately satisfies the membership-scoped policies.
    @discardableResult
    func createList(name: String, boardLayoutId: Int) async throws -> ListRow {
        let client = try requireClient()
        let userID = try currentUserID()
        let payload = ListInsert(
            owner_id: userID,
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            board_layout_id: boardLayoutId
        )
        let row: ListRow = try await client
            .from("lists")
            .insert(payload)
            .select()
            .single()
            .execute()
            .value
        try await loadMyLists()
        return row
    }

    /// Soft-deletes a list (owner only; RLS enforces). Members see it disappear on their
    /// next refresh (loadMyLists filters `deleted`).
    /// Deletes a list (owner only; RLS enforces). Hard delete rather than a soft
    /// `deleted` flag: the FK cascade sweeps `list_members` and `list_problems`, which
    /// also revokes every former member's read path (a soft-deleted list still satisfied
    /// `is_list_member`, so members could keep reading each other's status via the RPC).
    /// Lists are cloud-only, so there's no tombstone-pull requirement forcing them to
    /// linger.
    func deleteList(_ listId: UUID) async throws {
        let client = try requireClient()
        try await client
            .from("lists")
            .delete()
            .eq("id", value: listId)
            .execute()
        try await loadMyLists()
    }

    /// Renames a list (owner only; the existing "Owners update their lists" policy in 0003
    /// permits it). Refreshes `myLists` (and `currentList` if it's the open list) so the
    /// index and detail reflect the new name immediately.
    func renameList(_ listId: UUID, name: String) async throws {
        let client = try requireClient()
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let row: ListRow = try await client
            .from("lists")
            .update(["name": trimmed])
            .eq("id", value: listId)
            .select()
            .single()
            .execute()
            .value
        if currentList?.id == listId { currentList = row }
        try await loadMyLists()
    }

    // MARK: - Detail (members + pile)

    /// Loads a list's roster (as profiles) and its live problem pile into published
    /// state. Members and profiles are fetched separately because there is no direct FK
    /// between `list_members` and `profiles` for PostgREST to embed across.
    func loadDetail(_ listId: UUID) async throws {
        let client = try requireClient()

        currentList = myLists.first { $0.id == listId }

        let memberRows: [ListMemberRow] = try await client
            .from("list_members")
            .select()
            .eq("list_id", value: listId)
            .execute()
            .value

        let ids = memberRows.map(\.user_id)
        members = ids.isEmpty ? [] : try await client
            .from("profiles")
            .select()
            .in("id", values: ids)
            .execute()
            .value

        try await reloadPile(listId)
    }

    /// Re-fetches just the live pile for a list into published state (cheaper than a full
    /// `loadDetail`). Used after an add so pile-derived UI (badges, swipe-suppression)
    /// reflects the change.
    func reloadPile(_ listId: UUID) async throws {
        let client = try requireClient()
        pile = try await client
            .from("list_problems")
            .select()
            .eq("list_id", value: listId)
            .eq("deleted", value: false)
            .order("created_at", ascending: true)
            .execute()
            .value
    }

    // MARK: - Pile edits (all members equal)

    /// Adds a catalog problem to a list's pile. The DB unique index keeps it to one live
    /// row per (list, catalog id), so a duplicate add is rejected server-side.
    func addProblem(listId: UUID, sourceCatalogID: String, boardLayoutId: Int) async throws {
        let client = try requireClient()
        let userID = try currentUserID()
        let payload = ListProblemInsert(
            list_id: listId,
            source_catalog_id: sourceCatalogID,
            board_layout_id: boardLayoutId,
            added_by: userID
        )
        try await client.from("list_problems").insert(payload).execute()
        // Refresh the pile so pileIDs (swipe-add suppression) and badges reflect the add.
        if currentList?.id == listId { try await reloadPile(listId) }
    }

    /// Removes a problem from the pile (soft-delete, so re-adding stays clean).
    func removeProblem(_ listProblemId: UUID) async throws {
        let client = try requireClient()
        try await client
            .from("list_problems")
            .update(["deleted": true])
            .eq("id", value: listProblemId)
            .execute()
    }

    // MARK: - Join (consent-gated)

    /// Resolves a share-link token to a read-only preview (list name + inviter) and stashes
    /// it as `pendingInvite` for the confirmation prompt — WITHOUT joining. An unknown or
    /// expired token resolves to nothing and is silently ignored (a bad link is a no-op).
    func previewInvite(token: UUID) async {
        guard let client else { return }
        do {
            let rows: [ListPreviewRow] = try await client
                .rpc("preview_list_by_token", params: ["p_token": token])
                .execute()
                .value
            if let row = rows.first {
                pendingInvite = ListInvitePreview(
                    token: token,
                    listId: row.list_id,
                    name: row.name,
                    ownerHandle: row.owner_handle
                )
            }
        } catch {
            // Bad/expired link — nothing to prompt.
        }
    }

    /// Accepts the pending invite: joins the list (the consent step), then navigates to it.
    func acceptPendingInvite() async {
        guard let invite = pendingInvite else { return }
        pendingInvite = nil
        if let id = try? await join(token: invite.token) {
            pendingOpenListId = id
        }
    }

    /// Declines the pending invite — no membership, no exposure.
    func cancelPendingInvite() {
        pendingInvite = nil
    }

    /// Trades a share-link invite token for membership via the join RPC (which inserts
    /// the caller as a member — a not-yet-member can't do that directly under RLS).
    /// Idempotent server-side. Returns the joined list's id. Callers should route through
    /// `previewInvite` + `acceptPendingInvite` so the user consents first.
    @discardableResult
    func join(token: UUID) async throws -> UUID {
        let client = try requireClient()
        let listId: UUID = try await client
            .rpc("join_list_by_token", params: ["p_token": token])
            .execute()
            .value
        try await loadMyLists()
        return listId
    }

    // MARK: - Group status

    /// Fetches every member's send/try status for the list via the minimal-projection
    /// RPC and folds it into per-member sets. The RPC is membership-gated and returns
    /// ONLY (user_id, source_catalog_id, sent) — no other logbook field crosses. tried =
    /// every catalog id the member has a row for; sent = those with sent == true.
    func refreshGroupStatus(listId: UUID) async throws {
        let client = try requireClient()
        let rows: [MemberStatusRow] = try await client
            .rpc("list_member_status", params: ["p_list_id": listId])
            .execute()
            .value
        groupStatus = ListsManager.fold(rows)
    }

    /// Pure fold of RPC rows into per-member (sent, tried) sets. Static + pure so it's
    /// unit-checkable without a live client.
    static func fold(_ rows: [MemberStatusRow]) -> [UUID: MemberStatus] {
        var out: [UUID: MemberStatus] = [:]
        for row in rows {
            var status = out[row.user_id] ?? MemberStatus()
            status.tried.insert(row.source_catalog_id)
            if row.sent { status.sent.insert(row.source_catalog_id) }
            out[row.user_id] = status
        }
        return out
    }

    /// Resets all cached state. Call on sign-out / account switch so one account's lists
    /// and group status never render under another (mirrors the sync layer's
    /// cross-account guard — even cloud-only state must not leak across a session).
    func clear() {
        myLists = []
        currentList = nil
        members = []
        pile = []
        groupStatus = [:]
        pendingOpenListId = nil
        pendingInvite = nil
        activeListId = nil
    }

    // MARK: - Membership

    /// Leaves a list (deletes the caller's own membership; RLS allows only `user_id =
    /// auth.uid()`). Revokes both the caller's exposure and their read access.
    func leaveList(_ listId: UUID) async throws {
        let client = try requireClient()
        let userID = try currentUserID()
        try await client
            .from("list_members")
            .delete()
            .eq("list_id", value: listId)
            .eq("user_id", value: userID)
            .execute()
        try await loadMyLists()
    }

    // MARK: - Internal

    private func requireClient() throws -> SupabaseClient {
        guard let client else { throw ListsError.notConfigured }
        return client
    }

    private func currentUserID() throws -> UUID {
        guard let id = client?.auth.currentUser?.id else { throw ListsError.notSignedIn }
        return id
    }
}

/// A pending share-link invite awaiting consent: enough to show a meaningful prompt
/// (which list, who invited you) plus the token to join with on accept.
struct ListInvitePreview: Identifiable, Equatable {
    let token: UUID
    let listId: UUID
    let name: String
    let ownerHandle: String
    var id: UUID { listId }
}

/// One member's folded status for a list: which catalog problems they've sent and which
/// they've tried (that board). `sent` is a subset of `tried`.
struct MemberStatus: Equatable {
    var sent: Set<String> = []
    var tried: Set<String> = []
}

enum ListsError: LocalizedError {
    case notConfigured
    case notSignedIn

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Lists aren't set up in this build — see docs/social-accounts-login-SETUP.md."
        case .notSignedIn:
            return "You need to be signed in to use lists."
        }
    }
}
