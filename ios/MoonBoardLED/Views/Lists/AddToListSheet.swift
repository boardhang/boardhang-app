import SwiftUI

/// Picker shown from a catalog problem: add this problem to one of your saved lists. Only
/// lists on the *same board* as the problem are offered, so a list stays board-coherent
/// (matching how a list is created for a specific board). Tapping a list adds the problem
/// and dismisses. Needs sign-in (lists are cloud); favorites, not this, is the local path.
struct AddToListSheet: View {
    let catalogID: String
    let boardLayoutId: Int

    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var lists: ListsManager
    @Environment(\.dismiss) private var dismiss

    @State private var busyListId: UUID?
    @State private var error: String?

    private var available: Bool { lists.isConfigured && auth.status != .signedOut }

    /// Lists on the same board as this problem (a list is board-scoped).
    private var candidates: [ListRow] {
        lists.myLists.filter { $0.board_layout_id == boardLayoutId }
    }

    var body: some View {
        NavigationStack {
            Group {
                if !available {
                    ContentUnavailableView {
                        Label("Sign in to use lists", systemImage: "bookmark")
                    } description: {
                        Text("Sign in from Settings to save problems to lists.")
                    }
                } else if candidates.isEmpty {
                    ContentUnavailableView {
                        Label("No lists for this board", systemImage: "bookmark")
                    } description: {
                        Text("Create a list on this board from the Lists tab, then add problems to it.")
                    }
                } else {
                    List(candidates) { list in
                        Button {
                            Task { await add(to: list) }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(list.name.isEmpty ? "Untitled list" : list.name)
                                    Text(Board.with(layoutId: list.board_layout_id).name)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if busyListId == list.id {
                                    ProgressView()
                                } else {
                                    Image(systemName: "plus.circle")
                                        .foregroundStyle(Color.accentColor)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(busyListId != nil)
                    }
                }
            }
            .navigationTitle("Add to list")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task { await loadLists() }
            .alert("Couldn't add", isPresented: errorBinding) {
                Button("OK") { error = nil }
            } message: {
                Text(error ?? "")
            }
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { error != nil }, set: { if !$0 { error = nil } })
    }

    private func loadLists() async {
        guard available else { return }
        do { try await lists.loadMyLists() }
        catch { self.error = error.localizedDescription }
    }

    private func add(to list: ListRow) async {
        busyListId = list.id
        do {
            try await lists.addProblem(listId: list.id,
                                       sourceCatalogID: catalogID,
                                       boardLayoutId: boardLayoutId)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            busyListId = nil
        }
    }
}
