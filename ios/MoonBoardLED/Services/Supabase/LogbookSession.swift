import Foundation
import SwiftData
import Supabase

/// Tiny bridge so views can mark logbook rows dirty and read the current user id
/// without importing the Supabase SDK themselves. Keeps the SDK dependency inside the
/// Services/Supabase layer.
enum LogbookSession {
    /// The signed-in user's id, or nil when signed out / unconfigured.
    static var userID: UUID? { SupabaseClientProvider.shared?.auth.currentUser?.id }

    /// The attempt row for a deterministic id, regardless of tombstone state — so a
    /// re-logged same-day attempt reuses/revives the one row instead of inserting a
    /// second row with the same id.
    static func attemptRow(id: UUID, in context: ModelContext) -> Ascent? {
        let descriptor = FetchDescriptor<Ascent>(predicate: #Predicate { $0.id == id })
        return (try? context.fetch(descriptor))?.first
    }

    /// Merge `tries` into an existing attempt row: increment a live row, or revive a
    /// tombstoned one (delete-then-relog on the same UTC day).
    static func revive(_ ascent: Ascent, tries: Int, date: Date) {
        if ascent.tombstoned {
            ascent.tombstoned = false
            ascent.tries = tries
            ascent.date = date
        } else {
            ascent.tries += tries
        }
        ascent.markDirty()
    }
}

extension Ascent {
    /// Mark this row changed so the next sync pushes it. `updatedAt` is set to the local
    /// clock as an optimistic value; the server overwrites it with its own on push.
    func markDirty() {
        updatedAt = Date()
        needsSync = true
    }
}

extension Problem {
    func markDirty() {
        updatedAt = Date()
        needsSync = true
    }
}
