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
    /// Set when a write's `pushSoon` arrives mid-sync, so the in-flight cycle re-runs
    /// once more and the just-written row isn't stranded until the next trigger (#10).
    private var needsResync = false

    /// Identifies which account the on-device logbook cache belongs to. Guards against a
    /// cross-account leak: on an implicit sign-out (token expiry) the cache isn't cleared,
    /// so if a different user signs in we must wipe it before syncing, or the previous
    /// user's rows would be pushed up under the new user's id (#4). Absent = unowned
    /// pre-sign-in local data (the legitimate first-sign-in seed).
    private let cacheOwnerKey = "logbookCacheLocalOwner"

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

    /// One push+pull cycle. No-op when signed out / unconfigured, while the
    /// reconciliation modal is open, when the cache belongs to another account, or
    /// before this user has reconciled — those states are owned by `handleSignIn`.
    func syncNow() async {
        guard let client, let userID = client.auth.currentUser?.id else { return }
        // Pre-reconciliation, foreign-cache, and open-modal states are handleSignIn's job.
        // Syncing here would push the wrong user's rows or merge before the user chooses.
        guard cacheBelongsToOrIsUnowned(userID) else { return }               // #4
        guard UserDefaults.standard.bool(forKey: reconciledKey(userID)) else { return }
        guard !pendingReconciliation else { return }                          // #3
        guard !isSyncing else { needsResync = true; return }                 // #10 (coalesce)
        isSyncing = true
        defer { isSyncing = false }
        repeat {
            needsResync = false
            do {
                try await push(userID: userID)
                try await pull(userID: userID)
                claimCache(userID)
            } catch {
                // Offline, or auth token expired mid-sync (RLS rejection): leave rows dirty
                // and the cursor unchanged; the next cycle retries. Never surfaced, lost.
                break
            }
        } while needsResync && !pendingReconciliation
    }

    /// Called on launch-when-signed-in and on the sign-in transition. The first time for
    /// a given user on this device it reconciles (seed silently when one side is empty;
    /// raise `pendingReconciliation` when both hold data). Once reconciled, it's just a
    /// normal `syncNow` — so a restored session on relaunch never re-prompts.
    func handleSignIn() async {
        guard let client, let userID = client.auth.currentUser?.id else { return }
        // A different account's cache lingering from an implicit sign-out must be wiped
        // before anything else, or it would be attributed to this user (#4).
        wipeForeignCacheIfNeeded(userID)
        if UserDefaults.standard.bool(forKey: reconciledKey(userID)) {
            await syncNow()
            return
        }
        guard !isSyncing else { return }   // don't run reconciliation concurrently (#8)
        isSyncing = true
        defer { isSyncing = false }
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

    private func markReconciled(_ userID: UUID) {
        UserDefaults.standard.set(true, forKey: reconciledKey(userID))
        claimCache(userID)
    }

    /// Record that the on-device cache now belongs to `userID`.
    private func claimCache(_ userID: UUID) {
        UserDefaults.standard.set(userID.uuidString, forKey: cacheOwnerKey)
    }

    /// True when the cache is unowned (pre-sign-in data) or already this user's.
    private func cacheBelongsToOrIsUnowned(_ userID: UUID) -> Bool {
        let owner = UserDefaults.standard.string(forKey: cacheOwnerKey)
        return owner == nil || owner == userID.uuidString
    }

    /// If the cache belongs to a *different* account, wipe it and force this user to
    /// reconcile from scratch — so none of the previous user's rows leak into this one.
    private func wipeForeignCacheIfNeeded(_ current: UUID) {
        guard let owner = UserDefaults.standard.string(forKey: cacheOwnerKey),
              owner != current.uuidString else { return }
        deleteAllLocalLogbook()
        UserDefaults.standard.removeObject(forKey: cacheOwnerKey)
        UserDefaults.standard.removeObject(forKey: reconciledKey(current))
        resetCursors(userID: current)
        try? context.save()
    }

    // MARK: - Push

    private func push(userID: UUID) async throws {
        guard let client else { return }

        let dirtyProblems = try context.fetch(
            FetchDescriptor<Problem>(predicate: #Predicate { $0.needsSync })
        )
        if !dirtyProblems.isEmpty {
            let rows = dirtyProblems.map { UserProblemSyncRow(problem: $0, userID: userID) }
            let saved: [UserProblemSyncRow] = try await client
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
            let rows = dirtyAscents.map { AscentSyncRow(ascent: $0, userID: userID) }
            let saved: [AscentSyncRow] = try await client
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

        // Per-table cursors (#9): a shared cursor advanced by the ascents max could skip
        // a user_problem written at the same instant between the two SELECTs, forever.

        // user_problems first (ascents may link to them).
        let pCursor = cursorString(table: "user_problems", userID: userID)
        var pNewest = SyncDate.date(pCursor) ?? .distantPast
        let problemRows: [UserProblemSyncRow] = try await client
            .from("user_problems").select()
            .gt("updated_at", value: pCursor)
            .order("updated_at", ascending: true)
            .execute().value
        for row in problemRows {
            applyProblem(row)
            if let ts = SyncDate.date(row.updated_at), ts > pNewest { pNewest = ts }
        }

        let aCursor = cursorString(table: "ascents", userID: userID)
        var aNewest = SyncDate.date(aCursor) ?? .distantPast
        let ascentRows: [AscentSyncRow] = try await client
            .from("ascents").select()
            .gt("updated_at", value: aCursor)
            .order("updated_at", ascending: true)
            .execute().value
        for row in ascentRows {
            applyAscent(row)
            if let ts = SyncDate.date(row.updated_at), ts > aNewest { aNewest = ts }
        }

        try context.save()
        setCursor(SyncDate.string(pNewest), table: "user_problems", userID: userID)
        setCursor(SyncDate.string(aNewest), table: "ascents", userID: userID)
    }

    /// LWW apply: incoming wins iff its `updated_at` is newer than the local row's.
    private func applyProblem(_ row: UserProblemSyncRow) {
        let incoming = SyncDate.date(row.updated_at) ?? .distantPast
        let id = row.id
        // Distinguish a genuine "not found" from a thrown fetch error: on a throw, SKIP
        // the row rather than fall through and insert a duplicate (ids aren't unique at
        // the SwiftData layer, so a dup would defeat converge-by-id) (#6).
        let existing: Problem?
        do {
            existing = try context.fetch(
                FetchDescriptor<Problem>(predicate: #Predicate { $0.id == id })).first
        } catch { return }
        if let existing {
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

    private func applyAscent(_ row: AscentSyncRow) {
        let incoming = SyncDate.date(row.updated_at) ?? .distantPast
        let id = row.id
        let existing: Ascent?
        do {
            existing = try context.fetch(
                FetchDescriptor<Ascent>(predicate: #Predicate { $0.id == id })).first
        } catch { return }   // fetch failed → skip, don't insert a duplicate (#6)
        if let existing {
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

    private func apply(_ row: AscentSyncRow, to ascent: Ascent) {
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
        resetCursors(userID: userID)
        try context.save()
        try await pull(userID: userID)
        markReconciled(userID)
        pendingReconciliation = false
    }

    /// Tombstone every live cloud row for the user in one bulk UPDATE per table — atomic
    /// and a single round-trip, vs a per-row loop that could partial-fail (#11).
    private func tombstoneAllCloud(table: String, userID: UUID) async throws {
        guard let client else { return }
        try await client.from(table)
            .update(["deleted": true])
            .eq("user_id", value: userID)
            .eq("deleted", value: false)
            .execute()
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
        let userID = client?.auth.currentUser?.id
        await syncNow()
        deleteAllLocalLogbook()
        if let userID { clearCursors(userID: userID) }
        UserDefaults.standard.removeObject(forKey: cacheOwnerKey)   // cache no longer owned
        try? context.save()
    }

    /// Delete-account: keep the local logbook but strip sync metadata so it reverts to a
    /// local-only store (the cloud copy is gone; nothing to restore from). R8. Pass the
    /// user id explicitly — the session is already torn down by the time this runs (#15).
    /// The cache owner is deliberately KEPT = this (now-deleted) user, so a *different*
    /// account signing in later wipes the leftover data instead of adopting it (#4).
    func detachFromCloud(userID: UUID) {
        let problems = (try? context.fetch(FetchDescriptor<Problem>())) ?? []
        for p in problems { p.updatedAt = nil; p.needsSync = false }
        let ascents = (try? context.fetch(FetchDescriptor<Ascent>())) ?? []
        for a in ascents { a.updatedAt = nil; a.needsSync = false }
        clearCursors(userID: userID)
        UserDefaults.standard.removeObject(forKey: reconciledKey(userID))
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

    /// Count live cloud rows across BOTH tables (#5) — a user with cloud problems but no
    /// ascents must still be seen as "cloud has data" so reconciliation fires the modal
    /// instead of silently seeding/merging.
    private func cloudRowCount(userID: UUID) async throws -> Int {
        guard let client else { return 0 }
        let ascents = try await client.from("ascents")
            .select("id", head: true, count: .exact)
            .eq("user_id", value: userID).eq("deleted", value: false)
            .execute().count ?? 0
        if ascents > 0 { return ascents }
        return try await client.from("user_problems")
            .select("id", head: true, count: .exact)
            .eq("user_id", value: userID).eq("deleted", value: false)
            .execute().count ?? 0
    }

    // MARK: - Cursor (per-user, per-table high-water mark)

    private static let cursorTables = ["ascents", "user_problems"]

    private func cursorKey(_ table: String, _ userID: UUID) -> String {
        "logbookSyncCursor.\(table).\(userID.uuidString)"
    }

    private func cursorString(table: String, userID: UUID) -> String {
        UserDefaults.standard.string(forKey: cursorKey(table, userID))
            ?? SyncDate.string(.distantPast)
    }

    private func setCursor(_ value: String, table: String, userID: UUID) {
        UserDefaults.standard.set(value, forKey: cursorKey(table, userID))
    }

    /// Reset both cursors to the epoch so the next pull re-fetches everything.
    private func resetCursors(userID: UUID) {
        for t in Self.cursorTables { setCursor(SyncDate.string(.distantPast), table: t, userID: userID) }
    }

    /// Remove both cursors for a user (sign-out / account deletion).
    private func clearCursors(userID: UUID) {
        for t in Self.cursorTables { UserDefaults.standard.removeObject(forKey: cursorKey(t, userID)) }
    }
}
