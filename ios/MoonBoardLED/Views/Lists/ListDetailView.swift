import SwiftUI

/// A single saved list: its name/board and its saved problems. Add problems from the
/// catalog (the pager's "add to list" button); remove them here (swipe); tap one to open
/// it in the standard problem pager. Rename / delete live in the toolbar menu.
struct ListDetailView: View {
    let listId: UUID

    @EnvironmentObject private var lists: ListsManager
    @Environment(\.dismiss) private var dismiss

    @State private var renaming = false
    @State private var renameText = ""
    @State private var actionError: String?
    @State private var selected: CatalogProblem?
    @State private var showingBrowse = false

    private var list: ListRow? {
        lists.currentList?.id == listId ? lists.currentList : lists.myLists.first { $0.id == listId }
    }

    private var board: Board { Board.with(layoutId: list?.board_layout_id ?? Board.mini2025.id) }

    /// This list's saved problems. Filter `lists.pile` by `list_id` so a previously-open
    /// list's pile can't flash here before `reloadPile` lands.
    private var items: [ListProblemRow] { lists.pile.filter { $0.list_id == listId } }

    /// The pile resolved to catalog problems (in pile order), for the pager's swipe set.
    private var resolvedPile: [CatalogProblem] {
        items.compactMap { CatalogIndex.entry(forCatalogID: $0.source_catalog_id)?.problem }
    }

    var body: some View {
        List {
            Section {
                // A full-screen cover (its own NavigationStack) rather than a push: the
                // catalog declares its own navigationDestination for CatalogProblem, which
                // would collide with this view's pile destination in the same stack.
                Button {
                    showingBrowse = true
                } label: {
                    HStack {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Browse problems")
                                Text(board.name)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "magnifyingglass")
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Section("Problems") {
                if items.isEmpty {
                    Text("No problems yet. Add problems from the catalog with the bookmark button.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(items) { item in
                        problemRow(item)
                    }
                }
            }
        }
        .navigationTitle(list.map { $0.name.isEmpty ? "List" : $0.name } ?? "List")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $selected) { problem in
            CatalogProblemPager(problems: resolvedPile, current: problem,
                                board: board, source: .catalog(angle: board.defaultAngle),
                                addToListId: listId)
        }
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
        .refreshable { await load() }
        .task { await load() }
        .fullScreenCover(isPresented: $showingBrowse, onDismiss: { Task { await load() } }) {
            NavigationStack {
                CatalogListView(board: board, angle: board.defaultAngle, addToListId: listId)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") { showingBrowse = false }
                        }
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

    @ViewBuilder
    private func problemRow(_ item: ListProblemRow) -> some View {
        Group {
            if let problem = CatalogIndex.entry(forCatalogID: item.source_catalog_id)?.problem {
                Button {
                    selected = problem
                } label: {
                    CatalogProblemRow(problem: problem, showPreview: true, setup: board.setup)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                // Catalog id no longer resolves (e.g. a board that isn't bundled).
                Text(item.source_catalog_id).foregroundStyle(.secondary)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                Task { await remove(item) }
            } label: {
                Label("Remove", systemImage: "trash")
            }
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })
    }

    // MARK: - Actions

    private func load() async {
        do { try await lists.reloadPile(listId) }
        catch { actionError = error.localizedDescription }
    }

    private func remove(_ item: ListProblemRow) async {
        do {
            try await lists.removeProblem(item.id)
            try await lists.reloadPile(listId)
        } catch {
            actionError = error.localizedDescription
        }
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
