import Foundation

/// Wire shapes for the cloud logbook tables (`ascents`, `user_problems`), mirroring
/// the SwiftData models. snake_case `CodingKeys` match the Postgres columns (same
/// convention as `ProfileUpsert` in AuthManager).
///
/// Dates travel as ISO-8601 **strings** rather than `Date`, so we don't depend on the
/// PostgREST decoder's date strategy — `SyncDate` parses/formats them tolerantly.
/// `updated_at` is server-authoritative: we send it on insert-seed but always read the
/// server's value back (via `returning: .representation`) to advance the pull cursor.

struct AscentSyncRow: Codable {
    var id: UUID
    var user_id: UUID
    var date: String
    var source_catalog_id: String?
    var user_problem_id: UUID?
    var problem_name: String
    var problem_grade: String
    var voted_grade: String
    var tries: Int
    var stars: Int
    var comment: String
    var sent: Bool
    var board_layout_id: Int
    var updated_at: String?
    var deleted: Bool

    init(ascent: Ascent, userID: UUID) {
        self.id = ascent.id
        self.user_id = userID
        self.date = SyncDate.string(ascent.date)
        self.source_catalog_id = ascent.sourceCatalogID
        self.user_problem_id = ascent.userProblemID
        self.problem_name = ascent.problemName
        self.problem_grade = ascent.problemGrade
        self.voted_grade = ascent.votedGrade
        self.tries = ascent.tries
        self.stars = ascent.stars
        self.comment = ascent.comment
        self.sent = ascent.sent
        self.board_layout_id = ascent.boardLayoutId
        self.updated_at = ascent.updatedAt.map(SyncDate.string)
        self.deleted = ascent.tombstoned
    }
}

struct UserProblemSyncRow: Codable {
    var id: UUID
    var user_id: UUID
    var name: String
    var grade: String
    var holds: [HoldAssignment]
    var created_at: String
    var updated_at: String?
    var deleted: Bool

    init(problem: Problem, userID: UUID) {
        self.id = problem.id
        self.user_id = userID
        self.name = problem.name
        self.grade = problem.grade
        self.holds = problem.holds
        self.created_at = SyncDate.string(problem.createdAt)
        self.updated_at = problem.updatedAt.map(SyncDate.string)
        self.deleted = problem.tombstoned
    }
}

/// Tolerant ISO-8601 <-> Date conversion for wire timestamps. Postgres `timestamptz`
/// serializes with fractional seconds and a `+00:00` offset; parse with and without
/// fractional seconds so we don't drop rows on a formatting quirk.
enum SyncDate {
    static func string(_ date: Date) -> String {
        withFractional.string(from: date)
    }

    static func date(_ string: String?) -> Date? {
        guard let string else { return nil }
        // Postgres timestamptz serializes with up to 6 fractional digits
        // (e.g. ...30.123456+00:00). ISO8601DateFormatter with .withFractionalSeconds
        // ONLY accepts exactly 3, so it fails on real server values — which would pin
        // the pull cursor and make LWW never apply remote rows. Normalize the fractional
        // part to 3 digits (pad or truncate), then parse; fall back to no-fraction.
        let normalized = SyncDate.normalizeFraction(string)
        return withFractional.date(from: normalized) ?? withoutFractional.date(from: string)
    }

    /// Rewrite the fractional-seconds group to exactly 3 digits so
    /// `ISO8601DateFormatter(.withFractionalSeconds)` accepts it, preserving the offset.
    private static func normalizeFraction(_ s: String) -> String {
        guard let dot = s.firstIndex(of: ".") else { return s }
        let afterDot = s.index(after: dot)
        // Collect the run of fractional digits.
        var i = afterDot
        while i < s.endIndex, s[i].isNumber { i = s.index(after: i) }
        let digits = s[afterDot..<i]
        guard !digits.isEmpty else { return s }
        let three = digits.count >= 3
            ? String(digits.prefix(3))
            : digits + String(repeating: "0", count: 3 - digits.count)
        return String(s[s.startIndex..<afterDot]) + three + String(s[i...])
    }

    private static let withFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let withoutFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
