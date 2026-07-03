import Foundation
import SwiftData
import Supabase

/// Offline-first cloud sync for the logbook (ascents + user-created problems).
///
/// Design (docs/plans/2026-07-03-001-feat-cloud-logbook-sync-plan.md):
///   • **Spine:** timestamp high-water mark. Each row carries a server-authoritative
///     `updated_at`; we pull `updated_at > cursor` and push dirty (`needsSync`) rows.
///   • **Conflicts:** uniform last-write-wins on `updated_at`. Deletes are tombstones
///     (`tombstoned`/`deleted`), kept forever, so they win over a stale live row.
///   • **Cadence:** push-on-write + pull-on-foreground (callers trigger `syncNow`).
///   • **Additive to signed-out (R1):** every entry point no-ops without a client or a
///     signed-in user, so the offline/local experience is untouched.
///
/// Runs on the main actor against the container's `mainContext` — the same context the
/// `@Query` views read, so applied changes surface immediately and there is no
/// cross-context merge to reconcile. A personal logbook is small enough for this.
@MainActor
final class LogbookSyncManager: ObservableObject {

    /// Set when a sign-in finds data on BOTH sides and needs the user to choose which
    /// wins (see `LogbookReconciliationView`). nil the rest of the time.
    @Published var pendingReconciliation: Bool = false

    private let container: ModelContainer
    private let client: SupabaseClient?
    private var isSyncing = false

    init(container: ModelContainer, client: SupabaseClient? = SupabaseClientProvider.shared) {
        self.container = container
        self.client = client
    }

    private var context: ModelContext { container.mainContext }

    // MARK: - Public entry points

    /// Fire-and-forget sync after a local write (push-on-write cadence). No-op when
    /// signed out; if offline, the row stays dirty and rides the next foreground pull.
    func pushSoon() {
        Task { await syncNow() }
    }

    /// One push+pull cycle. No-op when signed out / unconfigured. Safe to call often
    /// (foreground, after a write); re-entrancy guarded.
    func syncNow() async {
        guard let client, let userID = client.auth.currentUser?.id else { return }
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            try await push(userID: userID)
            try await pull(userID: userID)
        } catch {
            // Offline, or auth token expired mid-sync (RLS rejection): leave rows dirty
            // and the cursor unchanged; the next cycle retries. Never surfaced, never lost.
        }
    }

    /// Called on launch-when-signed-in and on the sign-in transition. The first time for
    /// a given user on this device it reconciles (seed silently when one side is empty;
    /// raise `pendingReconciliation` when both hold data). Once reconciled, it's just a
    /// normal `syncNow` — so a restored session on relaunch never re-prompts.
    func handleSignIn() async {
        guard let client, let userID = client.auth.currentUser?.id else { return }
        if UserDefaults.standard.bool(forKey: reconciledKey(userID)) {
            await syncNow()
            return
        }
        do {
            let localHasData = try localRowCount() > 0
            let cloudHasData = try await cloudRowCount(userID: userID) > 0
            switch (localHasData, cloudHasData) {
            case (false, _):        // nothing local → just pull whatever the cloud has
                try await pull(userID: userID)
                markReconciled(userID)
            case (true, false):     // local only → seed the cloud, silent
                markAllDirty()
                try await push(userID: userID)
                try await pull(userID: userID)
                markReconciled(userID)
            case (true, true):      // both → user must choose (no merge); flag set on choice
                pendingReconciliation = true
            }
        } catch {
            // Treat as offline; nothing destructive happens, retried next foreground.
        }
    }

    private func reconciledKey(_ userID: UUID) -> String { "logbookReconciled.\(userID.uuidString)" }
    private func markReconciled(_ userID: UUID) { UserDefaults.standard.set(true, forKey: reconciledKey(userID)) }

    // MARK: - Push

    private func push(userID: UUID) async throws {
        guard let client else { return }

        let dirtyProblems = try context.fetch(
            FetchDescriptor<Problem>(predicate: #Predicate { $0.needsSync })
        )
        if !dirtyProblems.isEmpty {
            let rows = dirtyProblems.map { UserProblemRow(problem: $0, userID: userID) }
            let saved: [UserProblemRow] = try await client
                .from("user_problems").upsert(rows, returning: .representation).execute().value
            let byID = Dictionary(saved.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            for problem in dirtyProblems {
                problem.updatedAt = SyncDate.date(byID[problem.id]?.updated_at) ?? Date()
                problem.needsSync = false
            }
        }

        // Problems before ascents: the ascent FK references user_problems.
        let dirtyAscents = try context.fetch(
            FetchDescriptor<Ascent>(predicate: #Predicate { $0.needsSync })
        )
        if !dirtyAscents.isEmpty {
            let rows = dirtyAscents.map { AscentRow(ascent: $0, userID: userID) }
            let saved: [AscentRow] = try await client
                .from("ascents").upsert(rows, returning: .representation).execute().value
            let byID = Dictionary(saved.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            for ascent in dirtyAscents {
                ascent.updatedAt = SyncDate.date(byID[ascent.id]?.updated_at) ?? Date()
                ascent.needsSync = false
            }
        }

        try context.save()
    }

    // MARK: - Pull

    private func pull(userID: UUID) async throws {
        guard let client else { return }
        let cursor = cursorString(userID: userID)
        var newest = SyncDate.date(cursor) ?? .distantPast

        // user_problems first (ascents may link to them).
        let problemRows: [UserProblemRow] = try await client
            .from("user_problems").select()
            .gt("updated_at", value: cursor)
            .order("updated_at", ascending: true)
            .execute().value
        for row in problemRows {
            applyProblem(row)
            if let ts = SyncDate.date(row.updated_at), ts > newest { newest = ts }
        }

        let ascentRows: [AscentRow] = try await client
            .from("ascents").select()
            .gt("updated_at", value: cursor)
            .order("updated_at", ascending: true)
            .execute().value
        for row in ascentRows {
            applyAscent(row)
            if let ts = SyncDate.date(row.updated_at), ts > newest { newest = ts }
        }

        try context.save()
        setCursor(SyncDate.string(newest), userID: userID)
    }

    /// LWW apply: incoming wins iff its `updated_at` is newer than the local row's.
    private func applyProblem(_ row: UserProblemRow) {
        let incoming = SyncDate.date(row.updated_at) ?? .distantPast
        let id = row.id
        let existing = try? context.fetch(
            FetchDescriptor<Problem>(predicate: #Predicate { $0.id == id })
        ).first
        if let existing = existing ?? nil {
            if incoming > (existing.updatedAt ?? .distantPast) {
                existing.name = row.name
                existing.grade = row.grade
                existing.holds = row.holds
                existing.tombstoned = row.deleted
                existing.updatedAt = incoming
                existing.needsSync = false
            }
        } else if !row.deleted {
            let p = Problem(name: row.name, grade: row.grade, holds: row.holds,
                            createdAt: SyncDate.date(row.created_at) ?? Date())
            p.id = row.id
            p.updatedAt = incoming
            context.insert(p)
        }
        // A tombstone for a row we never had: nothing to insert; cursor still advances.
    }

    private func applyAscent(_ row: AscentRow) {
        let incoming = SyncDate.date(row.updated_at) ?? .distantPast
        let id = row.id
        let existing = try? context.fetch(
            FetchDescriptor<Ascent>(predicate: #Predicate { $0.id == id })
        ).first
        if let existing = existing ?? nil {
            if incoming > (existing.updatedAt ?? .distantPast) {
                apply(row, to: existing)
                existing.updatedAt = incoming
                existing.needsSync = false
            }
        } else if !row.deleted {
            let a = Ascent(date: SyncDate.date(row.date) ?? Date(),
                           sourceCatalogID: row.source_catalog_id,
                           problemName: row.problem_name,
                           problemGrade: row.problem_grade,
                           votedGrade: row.voted_grade,
                           tries: row.tries, stars: row.stars, comment: row.comment,
                           sent: row.sent, boardLayoutId: row.board_layout_id,
                           userProblemID: row.user_problem_id, id: row.id)
            a.updatedAt = incoming
            context.insert(a)
        }
    }

    private func apply(_ row: AscentRow, to ascent: Ascent) {
        ascent.date = SyncDate.date(row.date) ?? ascent.date
        ascent.sourceCatalogID = row.source_catalog_id
        ascent.userProblemID = row.user_problem_id
        ascent.problemName = row.problem_name
        ascent.problemGrade = row.problem_grade
        ascent.votedGrade = row.voted_grade
        ascent.tries = row.tries
        ascent.stars = row.stars
        ascent.comment = row.comment
        ascent.sent = row.sent
        ascent.boardLayoutId = row.board_layout_id
        ascent.tombstoned = row.deleted
    }

    // MARK: - Reconciliation (U5) — binary wholesale overwrite, no merge

    /// "Use this device": local wins. Tombstone every existing cloud row (so other
    /// devices converge down), then push local as authoritative.
    func overwriteCloudWithLocal() async throws {
        guard let client, let userID = client.auth.currentUser?.id else { return }
        // Tombstone all cloud rows by pulling their ids and marking deleted.
        try await tombstoneAllCloud(table: "ascents", userID: userID)
        try await tombstoneAllCloud(table: "user_problems", userID: userID)
        markAllDirty()
        try await push(userID: userID)
        markReconciled(userID)
        pendingReconciliation = false
    }

    /// "Use the cloud": cloud wins. Drop local synced rows, reset the cursor, full pull.
    func overwriteLocalWithCloud() async throws {
        guard let client, let userID = client.auth.currentUser?.id else { return }
        deleteAllLocalLogbook()
        setCursor(SyncDate.string(.distantPast), userID: userID)
        try context.save()
        try await pull(userID: userID)
        markReconciled(userID)
        pendingReconciliation = false
    }

    private func tombstoneAllCloud(table: String, userID: UUID) async throws {
        guard let client else { return }
        struct IDRow: Codable { var id: UUID }
        let ids: [IDRow] = try await client.from(table).select("id")
            .eq("user_id", value: userID).eq("deleted", value: false).execute().value
        for row in ids {
            try await client.from(table)
                .update(["deleted": true])
                .eq("id", value: row.id).execute()
        }
    }

    // MARK: - Lifecycle (U6)

    var hasUnsyncedChanges: Bool {
        let p = (try? context.fetchCount(
            FetchDescriptor<Problem>(predicate: #Predicate { $0.needsSync }))) ?? 0
        let a = (try? context.fetchCount(
            FetchDescriptor<Ascent>(predicate: #Predicate { $0.needsSync }))) ?? 0
        return p + a > 0
    }

    /// Sign-out: push what we can (if online), then drop the local cached logbook. The
    /// cloud copy is safe; it re-downloads on next sign-in. Caller guards the offline +
    /// unsynced case with a warning before invoking (R7).
    func clearLocalSyncedCacheAfterFlush() async {
        await syncNow()
        deleteAllLocalLogbook()
        clearCursorForCurrentUser()
        try? context.save()
    }

    /// Delete-account: keep the local logbook but strip sync metadata so it reverts to a
    /// local-only store (the cloud copy is gone; nothing to restore from). R8.
    func detachFromCloud() {
        let problems = (try? context.fetch(FetchDescriptor<Problem>())) ?? []
        for p in problems { p.updatedAt = nil; p.needsSync = false }
        let ascents = (try? context.fetch(FetchDescriptor<Ascent>())) ?? []
        for a in ascents { a.updatedAt = nil; a.needsSync = false }
        clearCursorForCurrentUser()
        try? context.save()
    }

    // MARK: - Helpers

    private func markAllDirty() {
        let problems = (try? context.fetch(FetchDescriptor<Problem>())) ?? []
        for p in problems { p.needsSync = true }
        let ascents = (try? context.fetch(FetchDescriptor<Ascent>())) ?? []
        for a in ascents { a.needsSync = true }
        try? context.save()
    }

    /// Removes every local logbook row (used by both overwrite-with-cloud and sign-out
    /// clear). Hard local delete is fine here — these paths are explicitly discarding the
    /// on-device cache, not propagating a user delete.
    private func deleteAllLocalLogbook() {
        try? context.delete(model: Ascent.self)
        try? context.delete(model: Problem.self)
    }

    private func localRowCount() throws -> Int {
        let a = try context.fetchCount(
            FetchDescriptor<Ascent>(predicate: #Predicate { !$0.tombstoned }))
        let p = try context.fetchCount(
            FetchDescriptor<Problem>(predicate: #Predicate { !$0.tombstoned }))
        return a + p
    }

    private func cloudRowCount(userID: UUID) async throws -> Int {
        guard let client else { return 0 }
        let res = try await client.from("ascents")
            .select("id", head: true, count: .exact)
            .eq("user_id", value: userID).eq("deleted", value: false)
            .execute()
        return res.count ?? 0
    }

    // MARK: - Cursor (per-user high-water mark)

    private func cursorKey(_ userID: UUID) -> String { "logbookSyncCursor.\(userID.uuidString)" }

    private func cursorString(userID: UUID) -> String {
        UserDefaults.standard.string(forKey: cursorKey(userID))
            ?? SyncDate.string(.distantPast)
    }

    private func setCursor(_ value: String, userID: UUID) {
        UserDefaults.standard.set(value, forKey: cursorKey(userID))
    }

    private func clearCursorForCurrentUser() {
        guard let userID = client?.auth.currentUser?.id else { return }
        UserDefaults.standard.removeObject(forKey: cursorKey(userID))
    }
}
