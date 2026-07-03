import SwiftUI
import SwiftData

/// Create or edit a problem. Tapping a hold cycles off→start→move→end→off, and—if
/// connected—pushes a debounced live preview to the physical board on every change.
struct ProblemEditView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var ble: MoonBoardBLEManager
    @EnvironmentObject private var sync: LogbookSyncManager
    @AppStorage(Board.mini2025.flippedKey) private var flipped = false
    @AppStorage("showBeta") private var showBeta = true

    /// nil = creating a new problem; otherwise editing this one.
    var existing: Problem?

    @State private var name: String
    @State private var grade: String
    @State private var holds: [HoldAssignment]
    /// Active "brush": nil = Auto (smart defaults + cycle); otherwise paint this type.
    @State private var brush: HoldType? = nil

    init(existing: Problem? = nil) {
        self.existing = existing
        _name = State(initialValue: existing?.name ?? "")
        _grade = State(initialValue: existing?.grade ?? FontGrade.default)
        _holds = State(initialValue: existing?.holds ?? [])
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Form {
                    Section {
                        TextField("Name", text: $name)
                        Picker("Grade", selection: $grade) {
                            ForEach(FontGrade.all, id: \.self) { Text($0).tag($0) }
                        }
                    }
                    Section {
                        Toggle("Show beta", isOn: $showBeta)
                    } footer: {
                        Text("On: all hold types (start, left, right, match, end). Off: only green / blue / red — left, right and match all show as blue.")
                    }
                    Section("Type") {
                        palette
                    }
                }
                .frame(maxHeight: 300)

                BoardImageView(setup: .mini2025, holds: holds, showBeta: showBeta, onTap: tapHold)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
            }
            .navigationTitle(existing == nil ? "New Problem" : "Edit Problem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { ble.clear(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(!canSave)
                }
            }
            .onAppear(perform: pushPreview)
            .onChange(of: showBeta) { _, on in
                if !on, let b = brush, b == .left || b == .match { brush = nil }
                pushPreview()
            }
        }
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !holds.isEmpty
    }

    /// With beta off, only the three primary roles are paintable.
    private var availableBrushTypes: [HoldType] {
        showBeta ? HoldType.allCases : [.start, .right, .end]
    }

    /// Brush selector: "Auto" plus one chip per hold type. The selected brush
    /// determines what a tap paints; Auto uses smart defaults and cycling.
    private var palette: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    brushChip(nil, label: "Auto", color: .secondary)
                    ForEach(availableBrushTypes) { type in
                        brushChip(type, label: type.label, color: type.color)
                    }
                }
                .padding(.vertical, 2)
            }
            HStack {
                Text(brush == nil
                     ? "Auto: first 2 = start, rest = right, top row = end."
                     : "Tap holds to paint \(brush!.label.lowercased()); tap again to remove.")
                    .font(.caption2).foregroundStyle(.secondary)
                Spacer()
                if ble.isConnected {
                    Label("Live", systemImage: "dot.radiowaves.left.and.right")
                        .font(.caption2).foregroundStyle(.green)
                }
            }
        }
    }

    private func brushChip(_ type: HoldType?, label: String, color: Color) -> some View {
        let selected = brush == type
        return Button {
            brush = type
        } label: {
            HStack(spacing: 6) {
                if let type {
                    Circle().fill(type.color).frame(width: 12, height: 12)
                } else {
                    Image(systemName: "wand.and.stars").font(.caption2)
                }
                Text(label).font(.caption.weight(selected ? .bold : .regular))
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(
                Capsule().fill(selected ? color.opacity(0.25) : Color.gray.opacity(0.12))
            )
            .overlay(
                Capsule().strokeBorder(selected ? color : .clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
    }

    private func tapHold(_ col: Int, _ row: Int) {
        let isTopRow = row == BoardGeometry.rows
        let idx = holds.firstIndex(where: { $0.col == col && $0.row == row })

        if let brush {
            // Paint mode: green is never allowed on the top row.
            let painted: HoldType = (brush == .start && isTopRow) ? .end : brush
            if let idx {
                // Tapping the same type removes it; a different type repaints it.
                if holds[idx].type == painted { holds.remove(at: idx) }
                else { holds[idx].type = painted }
            } else {
                holds.append(HoldAssignment(col: col, row: row, type: painted))
            }
        } else if let idx {
            // Auto mode, already selected: cycle the role, removing at end of cycle.
            if let nextType = cycledType(after: holds[idx].type, isTopRow: isTopRow, showBeta: showBeta) {
                holds[idx].type = nextType
            } else {
                holds.remove(at: idx)
            }
        } else {
            // Auto mode, newly selected: smart default.
            holds.append(HoldAssignment(col: col, row: row, type: defaultType(forRow: row)))
        }
        pushPreview()
    }

    /// Auto-mode cycle when re-tapping a selected hold. Walks the ordered roles, then
    /// removes the hold. Beta on includes Left/Match; beta off is green/blue/red only.
    /// The top row never includes Start (green).
    private func cycledType(after current: HoldType, isTopRow: Bool, showBeta: Bool) -> HoldType? {
        let order: [HoldType]
        if isTopRow {
            // No Start on the top row; End (red) is the default/first.
            order = showBeta ? [.end, .right, .left, .match] : [.end, .right]
        } else {
            order = showBeta ? [.start, .right, .left, .match, .end] : [.start, .right, .end]
        }

        guard let i = order.firstIndex(of: current) else { return order.first }
        let next = order.index(after: i)
        return next < order.endIndex ? order[next] : nil   // past the end = remove
    }

    /// Auto-mode default role when a hold is first selected:
    /// - top row → End (red)
    /// - first two (non-top-row) holds → Start (green)
    /// - everything else → Right (blue)
    private func defaultType(forRow row: Int) -> HoldType {
        if row == BoardGeometry.rows { return .end }            // top row = finish
        let starts = holds.filter { $0.type == .start }.count
        return starts < 2 ? .start : .right
    }

    private func pushPreview() {
        guard ble.isConnected else { return }
        ble.sendDebounced(holds: holds, rows: BoardGeometry.rows, flipped: flipped, showBeta: showBeta)
    }

    private func save() {
        if let existing {
            existing.name = name.trimmingCharacters(in: .whitespaces)
            existing.grade = grade
            existing.holds = holds
            existing.markDirty()
        } else {
            let p = Problem(name: name.trimmingCharacters(in: .whitespaces), grade: grade, holds: holds)
            p.markDirty()
            context.insert(p)
        }
        sync.pushSoon()
        dismiss()
    }
}
