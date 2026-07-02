import Foundation
import SwiftData

/// One logged ascent ("tick") of a problem. Deliberately self-contained: it keeps
/// a denormalized snapshot of the problem (name, grade, source id) so the logbook
/// survives even if the source problem is later edited or deleted. Each tick is a
/// separate event — repeats of the same problem are first-class.
@Model
final class Ascent {
    var id: UUID
    /// When the ascent happened. Determines which session (calendar day) it lands in.
    var date: Date

    /// Stable id of the catalog problem this came from, if any. nil for user-created
    /// `Problem`s (which can be deleted, hence the denormalized snapshot below).
    var sourceCatalogID: String?

    /// Snapshot of the problem at log time.
    var problemName: String
    /// The problem's official/original grade at log time.
    var problemGrade: String

    /// The grade the climber voted. Defaults to `problemGrade`.
    var votedGrade: String
    /// Number of attempts. 1 == flash. Minimum 1.
    var tries: Int
    /// 0...5. 0 means "no rating".
    var stars: Int
    var comment: String
    /// Whether the problem was actually sent (topped). `false` means attempts
    /// only — these appear in the logbook but are excluded from the grade
    /// pyramid and don't mark the problem as completed. Defaults `true` so any
    /// existing tick keeps counting as a send.
    var sent: Bool = true

    /// Which board this ascent was logged on (a `MoonBoardSetup`/`Board` layout id).
    /// Defaults to 7 (Mini MoonBoard 2025) so existing ticks — all logged before
    /// multi-board support — back-fill to the Mini via lightweight migration.
    var boardLayoutId: Int = 7

    init(date: Date = Date(),
         sourceCatalogID: String? = nil,
         problemName: String,
         problemGrade: String,
         votedGrade: String,
         tries: Int = 1,
         stars: Int = 0,
         comment: String = "",
         sent: Bool = true,
         boardLayoutId: Int = 7) {
        self.id = UUID()
        self.date = date
        self.sourceCatalogID = sourceCatalogID
        self.problemName = problemName
        self.problemGrade = problemGrade
        self.votedGrade = votedGrade
        self.tries = tries
        self.stars = stars
        self.comment = comment
        self.sent = sent
        self.boardLayoutId = boardLayoutId
    }

    /// How the voted grade compares to the official grade: +1 harder, -1 softer, 0 same/unknown.
    var gradeVoteDirection: Int {
        guard let voted = FontGrade.all.firstIndex(of: votedGrade),
              let official = FontGrade.all.firstIndex(of: problemGrade) else { return 0 }
        if voted > official { return 1 }
        if voted < official { return -1 }
        return 0
    }
}

/// A favorited catalog problem, keyed by its stable catalog id. Stored on its
/// own (catalog problems are read-only bundled data, so the "favorite" bit lives
/// here rather than on the problem).
@Model
final class FavoriteProblem {
    @Attribute(.unique) var catalogID: String

    init(catalogID: String) {
        self.catalogID = catalogID
    }
}

/// A session is not stored — it's the set of ascents that share a calendar day,
/// derived on the fly. This groups ascents into sessions, newest first.
struct LogSession: Identifiable {
    let day: Date          // start of day
    let ascents: [Ascent]  // newest first within the day

    var id: Date { day }

    /// e.g. "Tue 24 Jun — 5 problems"
    var title: String {
        "\(LogSession.dateFormatter.string(from: day)) — \(ascents.count) problem\(ascents.count == 1 ? "" : "s")"
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return f
    }()

    /// Group a flat list of ascents into day-sessions, newest day first and
    /// newest ascent first within each day.
    static func sessions(from ascents: [Ascent]) -> [LogSession] {
        let cal = Calendar.current
        let groups = Dictionary(grouping: ascents) { cal.startOfDay(for: $0.date) }
        return groups
            .map { day, items in
                LogSession(day: day, ascents: items.sorted { $0.date > $1.date })
            }
            .sorted { $0.day > $1.day }
    }
}
