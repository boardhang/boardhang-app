import SwiftUI

/// Picker shown from a catalog problem: toggle this problem in/out of your saved lists.
/// Only lists on the *same board* as the problem are offered, so a list stays
/// board-coherent. A filled checkmark marks lists that already contain it; tapping toggles
/// (add or remove). The sheet stays open so you can toggle several lists, then Done.
/// Needs sign-in (lists are cloud); favorites, not this, is the local path.
struct AddToListSheet: View {
    let catalogID: String
    let boardLayoutId: Int

    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var lists: ListsManager
    @Environment(\.dismiss) private var dismiss

    /// list id → live list_problems row id for lists that already contain this problem.
    @State private var membership: [UUID: UUID] = [:]
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
                        row(list)
                    }
                }
            }
            .navigationTitle("Add to list")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await reload() }
            .alert("Couldn't update", isPresented: errorBinding) {
                Button("OK") { error = nil }
            } message: {
                Text(error ?? "")
            }
        }
    }

    private func row(_ list: ListRow) -> some View {
        let isIn = membership[list.id] != nil
        return Button {
            Task { await toggle(list) }
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
                    Image(systemName: isIn ? "checkmark.circle.fill" : "plus.circle")
                        .foregroundStyle(isIn ? Color.accentColor : Color.secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busyListId != nil)
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { error != nil }, set: { if !$0 { error = nil } })
    }

    private func reload() async {
        guard available else { return }
        do {
            try await lists.loadMyLists()
            membership = try await lists.listsContaining(sourceCatalogID: catalogID)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func toggle(_ list: ListRow) async {
        busyListId = list.id
        defer { busyListId = nil }
        do {
            if let rowId = membership[list.id] {
                try await lists.removeProblem(rowId)
            } else {
                try await lists.addProblem(listId: list.id,
                                           sourceCatalogID: catalogID,
                                           boardLayoutId: boardLayoutId)
            }
            // Re-read membership so the checkmark (and the removal row id) stay accurate.
            membership = try await lists.listsContaining(sourceCatalogID: catalogID)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
