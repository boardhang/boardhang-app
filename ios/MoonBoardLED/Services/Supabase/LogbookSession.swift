import Foundation
import Supabase

/// Tiny bridge so views can mark logbook rows dirty and read the current user id
/// without importing the Supabase SDK themselves. Keeps the SDK dependency inside the
/// Services/Supabase layer.
enum LogbookSession {
    /// The signed-in user's id, or nil when signed out / unconfigured. Used to derive
    /// deterministic attempt ids (so the id is stable per user).
    static var userID: UUID? { SupabaseClientProvider.shared?.auth.currentUser?.id }
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
