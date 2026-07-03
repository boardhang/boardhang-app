import SwiftUI
import SwiftData

/// Sheet for logging a new ascent or editing an existing one. Used from the
/// problem detail pages (new) and from the logbook (edit, prefilled).
struct LogAscentSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var sync: LogbookSyncManager

    /// When editing, the ascent being changed. nil = logging a new one.
    private let editing: Ascent?

    /// Snapshot of the problem being logged (only needed when creating).
    private let sourceCatalogID: String?
    /// Stable link to a user-created problem, when logging one (nil for catalog).
    private let userProblemID: UUID?
    private let problemName: String
    private let problemGrade: String
    /// Board this ascent is logged on (only used when creating).
    private let boardLayoutId: Int

    @State private var date: Date
    @State private var votedGrade: String
    @State private var tries: Int
    @State private var stars: Int
    @State private var comment: String
    @State private var sent: Bool

    /// Called after a successful save (not on cancel), so a caller can clear any
    /// pending state it was holding.
    private let onComplete: (() -> Void)?

    /// Log a brand-new ascent for the given problem. `sent` distinguishes a send
    /// from an attempts-only log; `tries` prefills the attempt count.
    init(sourceCatalogID: String?, userProblemID: UUID? = nil,
         problemName: String, problemGrade: String,
         tries: Int = 1, sent: Bool = true, boardLayoutId: Int = 7,
         onComplete: (() -> Void)? = nil) {
        self.editing = nil
        self.sourceCatalogID = sourceCatalogID
        self.userProblemID = userProblemID
        self.problemName = problemName
        self.problemGrade = problemGrade
        self.boardLayoutId = boardLayoutId
        self.onComplete = onComplete
        _date = State(initialValue: Date())
        _votedGrade = State(initialValue: problemGrade)
        _tries = State(initialValue: max(tries, 1))
        _stars = State(initialValue: 0)
        _comment = State(initialValue: "")
        _sent = State(initialValue: sent)
    }

    /// Edit an existing ascent.
    init(editing ascent: Ascent) {
        self.editing = ascent
        self.sourceCatalogID = ascent.sourceCatalogID
        self.userProblemID = ascent.userProblemID
        self.problemName = ascent.problemName
        self.problemGrade = ascent.problemGrade
        self.boardLayoutId = ascent.boardLayoutId
        self.onComplete = nil
        _date = State(initialValue: ascent.date)
        _votedGrade = State(initialValue: ascent.votedGrade)
        _tries = State(initialValue: ascent.tries)
        _stars = State(initialValue: ascent.stars)
        _comment = State(initialValue: ascent.comment)
        _sent = State(initialValue: ascent.sent)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    // The "sent" choice is made by the Log attempt / Log send
                    // buttons when creating; editing can still flip it.
                    if editing != nil {
                        Toggle("Sent", isOn: $sent)
                    }
                    if sent {
                        Picker("Voted grade", selection: $votedGrade) {
                            ForEach(FontGrade.all, id: \.self) { Text($0).tag($0) }
                        }
                    }
                    Stepper(value: $tries, in: 1...99) {
                        HStack {
                            Text("Tries")
                            Spacer()
                            Text(tries == 1 ? "Flash" : "\(tries)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Rating") {
                    StarRatingPicker(stars: $stars)
                }
                Section("Comment") {
                    TextField("Notes (optional)", text: $comment, axis: .vertical)
                        .lineLimit(1...5)
                }
                Section {
                    DatePicker("Date", selection: $date,
                               in: ...Date(),
                               displayedComponents: [.date, .hourAndMinute])
                }
            }
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var navTitle: String {
        if editing != nil { return "Edit Log" }
        return sent ? "Log Send" : "Log Attempt"
    }

    private func save() {
        // A non-send has no meaningful voted grade — keep it equal to the
        // problem's own grade so it never shows a grade-vote arrow.
        let resolvedGrade = sent ? votedGrade : problemGrade
        if let editing {
            editing.date = date
            editing.votedGrade = resolvedGrade
            editing.tries = tries
            editing.stars = stars
            editing.comment = comment
            editing.sent = sent
            editing.markDirty()
        } else {
            let ascent = Ascent(date: date,
                                sourceCatalogID: sourceCatalogID,
                                problemName: problemName,
                                problemGrade: problemGrade,
                                votedGrade: resolvedGrade,
                                tries: tries,
                                stars: stars,
                                comment: comment,
                                sent: sent,
                                boardLayoutId: boardLayoutId,
                                userProblemID: userProblemID)
            ascent.markDirty()
            context.insert(ascent)
        }
        sync.pushSoon()
        onComplete?()
        dismiss()
    }
}

/// Tappable 0–5 star rating. Tapping the currently-set star count clears to 0.
struct StarRatingPicker: View {
    @Binding var stars: Int

    var body: some View {
        HStack(spacing: 8) {
            ForEach(1...5, id: \.self) { n in
                Image(systemName: n <= stars ? "star.fill" : "star")
                    .font(.title2)
                    .foregroundStyle(n <= stars ? .yellow : .secondary)
                    .onTapGesture {
                        stars = (stars == n) ? 0 : n
                    }
            }
            Spacer()
            Text(stars == 0 ? "No rating" : "\(stars)/5")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
