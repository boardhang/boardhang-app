import Foundation
import CryptoKit

/// Deterministic identity for **unsent same-day attempt** ascent rows.
///
/// The same-day attempt counter (`sent == false`) is a mergeable aggregate, not an
/// immutable event: tapping the try stepper across a session produces one row per
/// (problem, day) whose `tries` is incremented. Under cloud sync that row can be
/// created independently on two devices — so instead of a random UUID we derive its
/// id from its natural key. Both devices compute the *same* id for the same
/// (user, problem, day), so there is structurally only ever one row (locally and in
/// the cloud) and nothing to reconcile after the fact. `tries` then resolves by
/// last-write-wins (best-effort — acceptable, attempts never feed the pyramid).
///
/// Sends (`sent == true`) keep a random UUID — repeats of the same problem are
/// first-class and must not collapse.
///
/// The id is a UUID **version 5** (namespaced, SHA-1) so it is stable, collision-free
/// in practice, and identical across devices and OS versions.
enum AscentSyncID {

    /// App-specific namespace UUID (fixed constant — do not change; changing it would
    /// fork every device's deterministic ids).
    private static let namespace = UUID(uuidString: "6F9B4C2A-1E7D-5A83-9C40-B0E2D1F3A6C7")!

    /// Deterministic id for the unsent attempt row of `problemIdentity` on `day`.
    ///
    /// **Deliberately excludes the user id.** The row is already user-scoped by the
    /// `user_id` column, RLS, and the server's partial unique index — so the id only
    /// needs to be stable per (problem, day). Folding the user id in would fork the id
    /// across the signed-out (`"local"`)→signed-in boundary: the same problem/day would
    /// get two ids sharing one natural-key slot, colliding on the partial unique index
    /// and wedging the whole ascent push batch (23505). Keeping it user-independent
    /// makes the pre-sign-in attempt and the signed-in attempt the *same* row.
    ///
    /// - Parameters:
    ///   - problemIdentity: the stable problem key — `sourceCatalogID` for catalog
    ///     problems or the user `Problem.id` string for user problems. **Never** the
    ///     editable `problemName` (would fork the row on rename).
    ///   - day: the ascent's date; bucketed to a **UTC** calendar day to match the
    ///     server's partial unique index (R-M5).
    static func attemptID(problemIdentity: String, day: Date) -> UUID {
        let dayKey = utcDayFormatter.string(from: day)
        let name = "\(problemIdentity)|\(dayKey)|unsent"
        return uuidV5(namespace: namespace, name: name)
    }

    /// The UTC calendar day an ascent's date falls in — the bucket the deterministic id
    /// and the server index both use. Views should match same-day attempts on THIS, not
    /// `Calendar.current`, so a single device stays consistent with the sync key (#12).
    static func utcDay(of date: Date) -> String { utcDayFormatter.string(from: date) }

    // MARK: - UUIDv5 (RFC 4122 §4.3)

    private static func uuidV5(namespace: UUID, name: String) -> UUID {
        var hasher = Insecure.SHA1()
        withUnsafeBytes(of: namespace.uuid) { hasher.update(bufferPointer: $0) }
        hasher.update(data: Data(name.utf8))
        let digest = Array(hasher.finalize())   // 20 bytes; use the first 16

        var bytes = Array(digest.prefix(16))
        bytes[6] = (bytes[6] & 0x0F) | 0x50      // version 5
        bytes[8] = (bytes[8] & 0x3F) | 0x80      // RFC 4122 variant

        let u = (bytes[0], bytes[1], bytes[2], bytes[3],
                 bytes[4], bytes[5], bytes[6], bytes[7],
                 bytes[8], bytes[9], bytes[10], bytes[11],
                 bytes[12], bytes[13], bytes[14], bytes[15])
        return UUID(uuid: u)
    }

    private static let utcDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
