import SwiftUI

/// A single rounded capsule for logging attempts: minus · count · plus.
/// The minus is disabled (greyed) at zero, and the count sits centered so the
/// control keeps a steady shape as the number changes. Sized to sit alongside a
/// `.controlSize(.large)` button.
struct TryStepper: View {
    /// Current pending try count (0 shows the "Log try" hint).
    let count: Int
    /// Decrement (undo) the last try. Only called when `count > 0`.
    let onRemove: () -> Void
    /// Add a try.
    let onAdd: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            stepButton(systemName: "minus", enabled: count > 0, action: onRemove)

            Text(label)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .frame(maxWidth: .infinity)

            stepButton(systemName: "plus", enabled: true, action: onAdd)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 50)
        .background(.quaternary, in: Capsule())
    }

    private var label: String {
        switch count {
        case 0: return "Log try"
        case 1: return "1 try"
        default: return "\(count) tries"
        }
    }

    private func stepButton(systemName: String, enabled: Bool,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.headline)
                .foregroundStyle(enabled ? Color.primary : Color.secondary.opacity(0.35))
                .frame(width: 48, height: 50)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}
