import SwiftUI

/// How many tries an ascent took, grouped into buckets. Shared across the
/// logbook badges and the grade-pyramid chart so colors/labels stay consistent.
enum TryBucket: String, CaseIterable, Identifiable {
    case flash  = "Flash"
    case second = "2nd"
    case third  = "3rd"
    case more   = "4+ tries"

    var id: String { rawValue }

    static func from(_ tries: Int) -> TryBucket {
        switch tries {
        case ...1: return .flash
        case 2:    return .second
        case 3:    return .third
        default:   return .more
        }
    }

    /// Full-color palette used by the grade-pyramid chart. (The logbook badge
    /// uses its own reduced styling — see `TryBadge`.)
    var color: Color {
        switch self {
        case .flash:  return .yellow
        case .second: return .blue
        case .third:  return .green
        case .more:   return .red
        }
    }
}

/// A small pill showing the try-bucket (Flash / 2nd / 3rd / 4+ tries). Reusable
/// anywhere an ascent's effort needs to be shown.
struct TryBadge: View {
    let bucket: TryBucket
    /// Exact attempt count, shown for the 4+ bucket (e.g. "7 tries").
    private let exactTries: Int?

    init(bucket: TryBucket) {
        self.bucket = bucket
        self.exactTries = nil
    }

    init(tries: Int) {
        self.bucket = .from(tries)
        self.exactTries = tries
    }

    private var label: String {
        if bucket == .more, let exactTries { return "\(exactTries) tries" }
        return bucket.rawValue
    }

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(badgeFill, in: Capsule())
            .foregroundStyle(badgeText)
    }

    // Flash is the only colored badge; the rest are a single neutral gray so the
    // logbook isn't a rainbow. (The chart still uses `bucket.color` shades.)
    private var badgeFill: Color {
        bucket == .flash ? Color.yellow.opacity(0.22) : Color(.systemGray5)
    }

    private var badgeText: Color {
        bucket == .flash ? .orange : .secondary
    }
}
