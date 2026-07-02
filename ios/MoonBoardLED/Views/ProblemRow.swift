import SwiftUI

/// Shared list-row layout used by both the catalog list and the logbook so they
/// look identical. Lines: title (+ benchmark / sent), a dot-separated meta line,
/// a subtitle ("by …"), and an optional comment below everything. A trailing
/// view (the grade pill) sits on the right.
struct ProblemRow<Trailing: View>: View {
    let name: String
    var isBenchmark: Bool = false
    var isSent: Bool = false
    var isFavorite: Bool = false
    /// When set, a small non-interactive board thumbnail is shown on the left.
    var holds: [HoldAssignment]? = nil
    /// Which board's art to render the thumbnail with.
    var setup: MoonBoardSetup = .mini2025
    /// Hold sets to show in the thumbnail (nil = all). The catalog passes the
    /// board's active sets; the logbook leaves it nil so it always shows every set.
    var visibleHoldSetIDs: Set<Int>? = nil
    var meta: Text? = nil
    var subtitle: String? = nil
    var comment: String? = nil
    @ViewBuilder var trailing: Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                if let holds {
                    BoardImageView(setup: setup, visibleHoldSetIDs: visibleHoldSetIDs,
                                   holds: holds, showBeta: false)
                        .frame(width: 72)
                        .allowsHitTesting(false)
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(name.uppercased()).font(.headline)
                        HStack(spacing: 3) {
                            if isBenchmark {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.caption).foregroundStyle(.orange)
                            }
                            if isSent {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.caption).foregroundStyle(.green)
                            }
                            if isFavorite {
                                Image(systemName: "heart.fill")
                                    .font(.caption).foregroundStyle(.pink)
                            }
                        }
                    }
                    if let meta {
                        meta.font(.caption2)
                    }
                    if let subtitle {
                        Text(subtitle).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                trailing
            }
            if let comment, !comment.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "quote.opening")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(comment)
                        .font(.caption)
                        .italic()
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}

extension Text {
    /// Joins text segments with a " · " separator (skipping empty inputs).
    static func dotJoined(_ parts: [Text]) -> Text {
        let dot = Text(" · ").foregroundColor(.secondary)
        guard let first = parts.first else { return Text("") }
        return parts.dropFirst().reduce(first) { $0 + dot + $1 }
    }
}
