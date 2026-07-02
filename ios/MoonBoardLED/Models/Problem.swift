import Foundation
import SwiftData

/// A saved boulder problem: a named set of holds with a Font grade.
@Model
final class Problem {
    var name: String
    var grade: String
    var createdAt: Date

    /// Stored as a Codable value array. SwiftData persists this as part of the model.
    var holds: [HoldAssignment]

    init(name: String, grade: String, holds: [HoldAssignment], createdAt: Date = Date()) {
        self.name = name
        self.grade = grade
        self.holds = holds
        self.createdAt = createdAt
    }

    var startCount: Int { holds.filter { $0.type == .start }.count }
    var endCount: Int { holds.filter { $0.type == .end }.count }
}

/// Font (Fontainebleau) grades, in ascending order. This is the *canonical* scale
/// used for ordering, grade-vote comparison, and the pyramid. Individual boards
/// derive their own picker range (a contiguous span of this list) from the grades
/// their catalog actually contains — see `Board.gradeList`.
enum FontGrade {
    static let all: [String] = [
        "5+", "5B", "5C",
        "6A", "6A+", "6B", "6B+", "6C", "6C+",
        "7A", "7A+", "7B", "7B+", "7C", "7C+",
        "8A", "8A+", "8B", "8B+",
    ]
    static let `default` = "6A+"

    /// Position on the canonical scale; unknown grades sort to the end.
    static func index(of grade: String) -> Int {
        all.firstIndex(of: grade) ?? all.count
    }
}
