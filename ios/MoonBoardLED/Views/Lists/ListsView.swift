import SwiftUI

/// The Lists tab: the collaborative lists the signed-in user belongs to, plus a way to
/// create one. Cloud-only (KTD2) — loads on appear + pull-to-refresh. When signed out or
/// the build is unconfigured, shows a prompt instead of an empty list.
struct ListsView: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var lists: ListsManager

    @State private var showingCreate = false
    @State private var loadError: String?

    private var available: Bool { lists.isConfigured && auth.status != .signedOut }

    var body: some View {
        NavigationStack {
            Group {
                if available {
                    index
                } else {
                    ContentUnavailableView {
                        Label("Sign in to use lists", systemImage: "person.2.fill")
                    } description: {
                        Text("Collaborative lists let you and friends see who's sent what, so you can find problems to climb together. Sign in from Settings to start.")
                    }
                }
            }
            .navigationTitle("Lists")
            .toolbar {
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
        }
    }

    @ViewBuilder
    private var index: some View {
        if lists.myLists.isEmpty {
            ContentUnavailableView {
                Label("No lists yet", systemImage: "list.bullet.rectangle")
            } description: {
                Text("Create a list, invite your climbing partners, and browse the catalog together.")
            } actions: {
                Button("Create a list") { showingCreate = true }
            }
            .task { await load() }
        } else {
            List(lists.myLists) { list in
                NavigationLink {
                    ListDetailView(listId: list.id)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(list.name.isEmpty ? "Untitled list" : list.name)
                        Text(Board.with(layoutId: list.board_layout_id).name)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async {
        do { try await lists.loadMyLists() }
        catch { loadError = error.localizedDescription }
    }
}

/// Create-list sheet: name + board. The creator is seated as the first member by a DB
/// trigger, so the new list is immediately usable.
private struct CreateListSheet: View {
    @EnvironmentObject private var lists: ListsManager
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var boardId = Board.mini2025.id
    @State private var isSaving = false
    @State private var error: String?

    private var canCreate: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("e.g. Tuesday session", text: $name)
                }
                Section("Board") {
                    Picker("Board", selection: $boardId) {
                        ForEach(Board.all, id: \.id) { board in
                            Text(board.name).tag(board.id)
                        }
                    }
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
        }
    }

    private func create() {
        isSaving = true
        error = nil
        Task {
            do {
                try await lists.createList(name: name, boardLayoutId: boardId)
                dismiss()
            } catch {
                self.error = error.localizedDescription
                isSaving = false
            }
        }
    }
}
