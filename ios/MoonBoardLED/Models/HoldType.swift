import SwiftUI

/// The official MoonBoard hold roles. Each maps to a protocol letter the
/// ArduinoMoonBoardLED firmware understands and a display color matching the
/// color the firmware lights on the strip.
///
/// Firmware colors: S=green, L=violet, R=blue, M=pink, E=red.
enum HoldType: String, Codable, CaseIterable, Identifiable {
    case start
    case left
    case right
    case match
    case end

    var id: String { rawValue }

    /// Letter sent in the BLE message (e.g. the "S" in "S0").
    var protocolLetter: String {
        switch self {
        case .start: return "S"
        case .left:  return "L"
        case .right: return "R"
        case .match: return "M"
        case .end:   return "E"
        }
    }

    /// On-screen color, chosen to mirror the firmware's LED colors.
    var color: Color {
        switch self {
        case .start: return .green
        case .left:  return .purple
        case .right: return .blue
        case .match: return .pink
        case .end:   return .red
        }
    }

    var label: String {
        switch self {
        case .start: return "Start"
        case .left:  return "Left"
        case .right: return "Right"
        case .match: return "Match"
        case .end:   return "End"
        }
    }

    /// How this hold should appear/light given the "Show beta" setting.
    /// Beta off collapses the move roles (left/right/match) into a single blue,
    /// so only green (start), blue (move), and red (end) are shown.
    func displayed(showBeta: Bool) -> HoldType {
        if showBeta { return self }
        switch self {
        case .start, .end: return self
        default:           return .right
        }
    }
}

/// A single placed hold: its grid position and role.
struct HoldAssignment: Codable, Hashable, Identifiable {
    var col: Int   // 0...10  (A...K, left → right)
    var row: Int   // 1...12  (1 = bottom)
    var type: HoldType

    var id: String { "\(col)-\(row)" }
}
