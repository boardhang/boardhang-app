import Foundation
import SwiftData

/// One-time local backfill for the cloud-logbook-sync schema change (R-M1).
///
/// Adding `Problem.id: UUID` to an existing store is the one risky migration in this
/// milestone: SwiftData's lightweight migration may hand every pre-existing `Problem`
/// the *same* default id. This pass repairs that (guarantees distinct ids) and links
/// legacy user-problem ascents to their problem via the new `userProblemID`, so the
/// first sign-in seeds a correct, fully-linked logbook to the cloud.
///
/// Idempotent and guarded by a UserDefaults flag — runs at most once. Call it at
/// launch, before any sync, from a context bound to the app's shared container.
///
/// ⚠️ MUST be verified in Xcode against a populated store before shipping (the plan's
/// blocking migration-safety gate). This code is correct by construction but the
/// exact lightweight-migration behavior it compensates for is only observable on-device.
enum LogbookMigration {

    private static let doneKey = "logbookSyncMigrationV1Done"

    @MainActor
    static func runIfNeeded(_ context: ModelContext) {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: doneKey) else { return }

        do {
            let problems = try context.fetch(FetchDescriptor<Problem>())

            // 1. Guarantee distinct ids. If lightweight migration collapsed them to a
            //    shared default, reassign duplicates a fresh UUID (keep the first seen).
            var seen = Set<UUID>()
            for problem in problems {
                if seen.contains(problem.id) {
                    problem.id = UUID()
                }
                seen.insert(problem.id)
            }

            // 2. Backfill the ascent→user-problem link for legacy rows. A user-problem
            //    ascent has sourceCatalogID == nil and matched its problem only by name;
            //    link it to the now-stable Problem.id. Best-effort by name (the only key
            //    legacy rows have); new ascents set the link directly at log time.
            let byName = Dictionary(problems.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
            let ascents = try context.fetch(FetchDescriptor<Ascent>())
            for ascent in ascents where ascent.sourceCatalogID == nil && ascent.userProblemID == nil {
                if let problem = byName[ascent.problemName] {
                    ascent.userProblemID = problem.id
                }
            }

            try context.save()
            defaults.set(true, forKey: doneKey)
        } catch {
            // Leave the flag unset so we retry next launch rather than shipping a
            // half-migrated store. Log rather than assert — `assertionFailure` traps in
            // DEBUG builds, which would crash the one path meant to degrade gracefully.
            print("[LogbookMigration] failed, will retry next launch: \(error)")
        }
    }
}
