import SwiftUI

/// A single saved list. Phase 1 (foundation) shows the list's name + board and offers
/// rename / delete; the problem pile (add / remove / open) arrives in the next PR. The
/// list is resolved from the manager's already-loaded `myLists`, so no extra fetch is
/// needed to render this skeleton.
struct ListDetailView: View {
    let listId: UUID

    @EnvironmentObject private var lists: ListsManager
    @Environment(\.dismiss) private var dismiss

    @State private var renaming = false
    @State private var renameText = ""
    @State private var actionError: String?

    private var list: ListRow? {
        lists.currentList?.id == listId ? lists.currentList : lists.myLists.first { $0.id == listId }
    }

    private var board: Board { Board.with(layoutId: list?.board_layout_id ?? Board.mini2025.id) }

    var body: some View {
        List {
            Section("Board") {
                Text(board.name).foregroundStyle(.secondary)
            }
            Section("Problems") {
                Text("No problems yet. Adding problems from the catalog comes next.")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(list.map { $0.name.isEmpty ? "List" : $0.name } ?? "List")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        renameText = list?.name ?? ""
                        renaming = true
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }
                    Button(role: .destructive) {
                        Task { await delete() }
                    } label: {
                        Label("Delete list", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .alert("Rename list", isPresented: $renaming) {
            TextField("Name", text: $renameText)
            Button("Save") { Task { await rename() } }
            Button("Cancel", role: .cancel) { }
        }
        .alert("Something went wrong", isPresented: errorBinding) {
            Button("OK") { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })
    }

    private func rename() async {
        do { try await lists.renameList(listId, name: renameText) }
        catch { actionError = error.localizedDescription }
    }

    private func delete() async {
        do { try await lists.deleteList(listId); dismiss() }
        catch { actionError = error.localizedDescription }
    }
}
