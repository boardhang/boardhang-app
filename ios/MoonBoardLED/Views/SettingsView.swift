import SwiftUI

/// The Settings tab: board configuration and tools that used to live in the
/// home screen's overflow menu — LED test/calibration, clear board, and the
/// orientation / beta display toggles.
struct SettingsView: View {
    @EnvironmentObject private var ble: MoonBoardBLEManager
    @EnvironmentObject private var auth: AuthManager
    @AppStorage("appAppearance") private var appearance: AppAppearance = .system
    @AppStorage("autoLightOnSwipe") private var autoLightOnSwipe = false
    @AppStorage("showClimbPreviews") private var showClimbPreviews = true

    @State private var showingConnection = false

    var body: some View {
        NavigationStack {
            Form {
                AccountSection()

                Section("Display") {
                    Picker("Appearance", selection: $appearance) {
                        ForEach(AppAppearance.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    // "Show beta" is hidden for now: no bundled catalog uses
                    // left/match holds, so there's no beta to show. The `showBeta`
                    // setting (default on) still drives BoardImageView — restore
                    // this toggle once problems with real beta ship.
                    Toggle("Show climb previews", isOn: $showClimbPreviews)
                }

                Section {
                    Toggle("Auto-light on swipe", isOn: $autoLightOnSwipe)
                } footer: {
                    Text("When browsing problems, automatically light each one on the board as you swipe to it.")
                }

                Section {
                    // The LED link is global (not per-board). Tapping opens the
                    // scan/connect sheet, which hosts calibration when connected.
                    Button { showingConnection = true } label: {
                        HStack {
                            Text("LED")
                                .foregroundStyle(.primary)
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                HStack(spacing: 6) {
                                    Circle()
                                        .fill(ble.isConnected ? Color.blue : Color.gray)
                                        .frame(width: 8, height: 8)
                                    Text(ble.isConnected ? "Connected" : "Not connected")
                                        .font(.caption)
                                        .foregroundStyle(ble.isConnected ? Color.blue : Color.secondary)
                                }
                                if ble.isConnected, let name = ble.connectedName {
                                    // Explicit gray, not a hierarchical style: inside a
                                    // tinted Button the latter picks up the accent (blue).
                                    Text(name)
                                        .font(.caption2)
                                        .foregroundStyle(Color.secondary)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Board")
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showingConnection) {
                ConnectionView()
            }
        }
    }
}

/// The Account section of Settings. Signed-out shows a sign-in entry; signed-in shows
/// the profile summary with edit / sign out / delete. The middle state (signed in, no
/// profile yet) nudges the user to finish setup. Auth is optional — everything else in
/// the app works signed-out.
private struct AccountSection: View {
    @EnvironmentObject private var auth: AuthManager
    @State private var activeSheet: AccountSheet?
    @State private var confirmingSignOut = false
    @State private var confirmingDelete = false
    @State private var isDeleting = false
    @State private var actionError: String?

    /// One sheet slot for the whole section. Two separate `.sheet(isPresented:)`
    /// modifiers on one view conflict in SwiftUI ("already presenting" → the sheet
    /// dismisses itself the moment it opens); a single `.sheet(item:)` avoids that.
    private enum AccountSheet: Identifiable {
        case signIn, profileSetup
        var id: Self { self }
    }

    var body: some View {
        // No backend configured in this build → no auth entry point at all. The rest
        // of Settings (and the app) stays fully usable.
        if auth.isConfigured || auth.status != .signedOut {
            accountSection
        }
    }

    @ViewBuilder
    private var accountSection: some View {
        Section {
            if auth.isRestoring {
                // Session restore runs async on launch. Until it resolves, don't offer
                // "Sign in" — otherwise a user with a saved session taps it and the sheet
                // slams shut the instant the restored session lands (SignInView's
                // auto-dismiss on a non-signedOut status).
                HStack {
                    Text("Checking sign-in…").foregroundStyle(.secondary)
                    Spacer()
                    ProgressView()
                }
            } else {
                switch auth.status {
                case .signedOut:
                    Button {
                        activeSheet = .signIn
                    } label: {
                        Label("Sign in", systemImage: "person.crop.circle.badge.plus")
                    }

            case .signedInNoProfile:
                Button {
                    activeSheet = .profileSetup
                } label: {
                    Label("Finish setting up your profile", systemImage: "person.crop.circle.badge.exclamationmark")
                }
                Button(role: .destructive) { confirmingSignOut = true } label: {
                    Text("Sign out")
                }

            case .signedInWithProfile:
                NavigationLink {
                    ProfileView()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(auth.profile?.displayName.isEmpty == false
                             ? auth.profile!.displayName
                             : "@\(auth.profile?.handle ?? "")")
                            .font(.body)
                        if auth.profile?.displayName.isEmpty == false {
                            Text("@\(auth.profile?.handle ?? "")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Button(role: .destructive) { confirmingSignOut = true } label: {
                    Text("Sign out")
                }
                Button(role: .destructive) { confirmingDelete = true } label: {
                    if isDeleting {
                        ProgressView()
                    } else {
                        Text("Delete account")
                    }
                }
                .disabled(isDeleting)
                }
            }
        } header: {
            Text("Account")
        } footer: {
            if let actionError {
                Text(actionError).foregroundStyle(.red)
            }
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .signIn: SignInView()
            case .profileSetup: ProfileSetupView()
            }
        }
        .confirmationDialog("Sign out?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await signOut() } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Delete account? This permanently removes your profile and cannot be undone.",
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete account", role: .destructive) { Task { await deleteAccount() } }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func signOut() async {
        actionError = nil
        do { try await auth.signOut() }
        catch { actionError = error.localizedDescription }
    }

    private func deleteAccount() async {
        actionError = nil
        isDeleting = true
        defer { isDeleting = false }
        do { try await auth.deleteAccount() }
        catch { actionError = "Couldn't delete your account. Please try again." }
    }
}
