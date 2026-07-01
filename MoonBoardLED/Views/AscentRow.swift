import SwiftUI

/// One logged ascent in the logbook. Uses the shared `ProblemRow` layout so it
/// matches the catalog list, populated with the climber's logged data: rating ·
/// method · tries, the setter, the comment, and a voted-grade pill (▲/▼ when it
/// differs from the consensus grade).
struct AscentRow: View {
    let ascent: Ascent
    var isBenchmark: Bool = false
    var method: String? = nil
    var setter: String? = nil
    var holds: [HoldAssignment]? = nil
    /// Board art for the thumbnail (defaults to Mini).
    var setup: MoonBoardSetup = .mini2025

    var body: some View {
        ProblemRow(
            name: ascent.problemName,
            isBenchmark: isBenchmark,
            isSent: ascent.sent,
            holds: holds,
            setup: setup,
            meta: metaLine,
            subtitle: setter.map { "by \($0)" },
            comment: ascent.comment
        ) {
            gradePill
        }
    }

    /// Rating · method · tries, dot-separated.
    private var metaLine: Text {
        var parts: [Text] = [ratingText]
        if let method {
            parts.append(Text(method).foregroundColor(.indigo))
        }
        parts.append(Text(ascent.tries == 1 ? "Flash" : "\(ascent.tries) tries")
            .foregroundColor(.secondary))
        return .dotJoined(parts)
    }

    /// Five stars filled to the rating, or "Not rated".
    private var ratingText: Text {
        guard ascent.stars > 0 else {
            return Text("Not rated").foregroundColor(.secondary)
        }
        return (1...5).reduce(Text("")) { acc, i in
            acc + Text(Image(systemName: i <= ascent.stars ? "star.fill" : "star"))
                .foregroundColor(i <= ascent.stars ? .secondary : Color(.tertiaryLabel))
        }
    }

    private var gradePill: some View {
        HStack(spacing: 6) {
            // The problem's actual (consensus) grade — always shown.
            GradePill(grade: ascent.problemGrade)

            // The climber's vote, shown only when it differs from the actual grade.
            if ascent.gradeVoteDirection != 0 {
                HStack(spacing: 2) {
                    Image(systemName: ascent.gradeVoteDirection > 0 ? "arrow.up" : "arrow.down")
                        .font(.caption2)
                    Text(ascent.votedGrade)
                }
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(voteColor.opacity(0.15), in: Capsule())
                .foregroundStyle(voteColor)
            }
        }
    }

    private var voteColor: Color {
        ascent.gradeVoteDirection > 0 ? .red : .green
    }
}
