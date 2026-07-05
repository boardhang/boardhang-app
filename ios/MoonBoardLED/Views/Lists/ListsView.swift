import SwiftUI
import SwiftData

/// The Lists tab: a pinned Favorites entry plus your saved lists and a way to create one.
/// Favorites is local (always available); the saved lists are cloud-backed (reuse the same
/// account as the logbook) and load on appear + pull-to-refresh. When signed out or the
/// build is unconfigured, the lists section is replaced by a sign-in prompt — Favorites
/// stays put.
///
/// Phase 1 (Saved Lists) is personal only: create / rename / delete and open a list. The
/// collaborative surface (members, sharing, group status) is a later layer.
struct ListsView: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var lists: ListsManager
    @Query private var favorites: [FavoriteProblem]
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default
    @AppStorage(AddedBoards.storageKey) private var addedCSV = ""

    @State private var showingCreate = false
    @State private var renaming: ListRow?
    @State private var renameText = ""
    @State private var loadError: String?

    private var available: Bool { lists.isConfigured && auth.status != .signedOut }

    /// Only offer the board switcher when there's more than one board to switch between —
    /// with 0–1 boards the "Lists" title stays put (no phantom board header, no switcher).
    private var canSwitchBoards: Bool { AddedBoards.boards(from: addedCSV).count > 1 }

    /// Your lists for the active board only. Lists on other boards still exist in the cloud —
    /// they're hidden until that board is active again.
    private var boardLists: [ListRow] {
        lists.myLists.filter { $0.board_layout_id == activeBoardId }
    }

    var body: some View {
        NavigationStack {
            List {
                Section { favoritesCard }
                if available {
                    listSection
                } else {
                    signInPrompt
                }
            }
            .navigationTitle("Lists")
            // Inline only when the switcher occupies the principal slot; otherwise keep the
            // default large "Lists" title (mixing a principal item with a large title collides).
            .navigationBarTitleDisplayMode(canSwitchBoards ? .inline : .large)
            .toolbar {
                if canSwitchBoards {
                    ToolbarItem(placement: .principal) {
                        BoardSwitcher()
                    }
                }
                if available {
                    ToolbarItem(placement: .primaryAction) {
                        Button { showingCreate = true } label: {
                            Image(systemName: "plus")
                        }
                        .accessibilityLabel("New list")
                    }
                }
            }
            .sheet(isPresented: $showingCreate) { CreateListSheet() }
            .alert("Rename list", isPresented: renamingBinding) {
                TextField("Name", text: $renameText)
                Button("Save") { commitRename() }
                Button("Cancel", role: .cancel) { renaming = nil }
            }
            .alert("Something went wrong", isPresented: errorBinding) {
                Button("OK") { loadError = nil }
            } message: {
                Text(loadError ?? "")
            }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    /// Pinned Favorites row: a live view over local FavoriteProblem, auto-populated by the
    /// catalog's heart button. Present in every state (favorites aren't gated on auth).
    private var favoritesCard: some View {
        NavigationLink {
            FavoritesView()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "heart.fill")
                    .foregroundStyle(.pink)
                    .frame(width: 28, height: 28)
                    .background(Color.pink.opacity(0.15), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Favorites")
                    Text(favoriteCountLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    /// Favorites on the active board only — matches the board-scoped `FavoritesView` this
    /// card opens. Favorites store just a catalog id, so the board is derived via `CatalogIndex`.
    private var activeBoardFavoriteCount: Int {
        favorites
            .compactMap { CatalogIndex.entry(forCatalogID: $0.catalogID) }
            .filter { $0.board.id == activeBoardId }
            .count
    }

    private var favoriteCountLabel: String {
        switch activeBoardFavoriteCount {
        case 0:  return "No favorites yet"
        case 1:  return "1 problem"
        case let n: return "\(n) problems"
        }
    }

    @ViewBuilder
    private var listSection: some View {
        if boardLists.isEmpty {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No lists yet").font(.headline)
                    Text("Create a list to start saving problems — projects, ticklists, warmups.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Create a list") { showingCreate = true }
                        .padding(.top, 2)
                }
                .padding(.vertical, 4)
            }
        } else {
            Section("Your lists") {
                ForEach(boardLists) { list in
                    NavigationLink {
                        ListDetailView(listId: list.id)
                    } label: {
                        row(list)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            Task { await delete(list.id) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button {
                            startRename(list)
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        .tint(.indigo)
                    }
                }
            }
        }
    }

    private var signInPrompt: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("Sign in to use lists", systemImage: "bookmark")
                    .font(.headline)
                Text("Saved Lists sync to your account so you can build collections of problems across your devices. Sign in from Settings to start.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
    }

    private func row(_ list: ListRow) -> some View {
        // No per-row board label: every list here is the active board, stated once in the
        // page header.
        Text(list.name.isEmpty ? "Untitled list" : list.name)
    }

    // MARK: - Rename plumbing

    private var renamingBinding: Binding<Bool> {
        Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { loadError != nil }, set: { if !$0 { loadError = nil } })
    }

    private func startRename(_ list: ListRow) {
        renameText = list.name
        renaming = list
    }

    private func commitRename() {
        guard let list = renaming else { return }
        renaming = nil
        let name = renameText
        Task {
            do { try await lists.renameList(list.id, name: name) }
            catch { loadError = error.localizedDescription }
        }
    }

    // MARK: - Actions

    private func load() async {
        guard available else { return }
        do { try await lists.loadMyLists() }
        catch { loadError = error.localizedDescription }
    }

    private func delete(_ listId: UUID) async {
        do { try await lists.deleteList(listId) }
        catch { loadError = error.localizedDescription }
    }
}

/// Create-list sheet: name only. The new list is always created on the *active* board (the
/// one the Lists tab is scoped to) — there's no board picker, so lists never mix boards. To
/// make a list for another board, switch the active board on the Home tab first. The creator
/// is seated as the first member by a DB trigger, so the new list is immediately usable. The
/// name field offers quick-fill suggestion pills.
private struct CreateListSheet: View {
    @EnvironmentObject private var lists: ListsManager
    @Environment(\.dismiss) private var dismiss
    @AppStorage(ActiveBoard.storageKey) private var activeBoardId = ActiveBoard.default

    @State private var name = ""
    @State private var isSaving = false
    @State private var error: String?
    @State private var showingDatePicker = false
    @State private var pickedDate = Date.now
    /// Cached formatted date-pill label — recomputed only when `pickedDate` changes, not on
    /// every Name keystroke (the pill row is rebuilt whenever the sheet body re-evaluates).
    @State private var dateText = ""

    /// Quick-fill name ideas (the date is a separate pill that opens a calendar).
    private var textSuggestions: [String] {
        ["Projects", "To-do", "Warmups", "Flashed"]
    }

    private func dateLabel(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    private var canCreate: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("e.g. Projects", text: $name)
                    suggestionPills
                }
                if let error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
            }
            .navigationTitle("New list")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }.disabled(!canCreate)
                }
            }
            .onAppear {
                dateText = dateLabel(pickedDate)
            }
            .onChange(of: pickedDate) { _, newValue in
                dateText = dateLabel(newValue)
            }
            .sheet(isPresented: $showingDatePicker) {
                datePickerSheet
            }
        }
    }

    private var suggestionPills: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Suggestions")
                .font(.caption)
                .foregroundStyle(.secondary)
            pillRow
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
    }

    private var pillRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // Date pill — opens a calendar to pick any day.
                Button { showingDatePicker = true } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "calendar")
                        Text(dateText)
                    }
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color(.systemGray5), in: Capsule())
                    .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)

                ForEach(textSuggestions, id: \.self) { suggestion in
                    Button {
                        name = suggestion
                    } label: {
                        Text(suggestion)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color(.systemGray5), in: Capsule())
                            .foregroundStyle(.primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private var datePickerSheet: some View {
        NavigationStack {
            DatePicker("Date", selection: $pickedDate, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .padding()
                .navigationTitle("Pick a date")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showingDatePicker = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Use date") {
                            name = dateLabel(pickedDate)
                            showingDatePicker = false
                        }
                    }
                }
        }
        .presentationDetents([.medium, .large])
    }

    private func create() {
        isSaving = true
        error = nil
        Task {
            do {
                try await lists.createList(name: name, boardLayoutId: activeBoardId)
                dismiss()
            } catch {
                self.error = error.localizedDescription
                isSaving = false
            }
        }
    }
}
