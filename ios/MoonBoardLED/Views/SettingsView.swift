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

    @State private var activeSheet: SettingsSheet?
    /// The sheet currently on screen, recorded when it's presented (not when it's
    /// dismissed) so the dismiss handler can tell *which* sheet just closed.
    @State private var presentedSheet: SettingsSheet?

    var body: some View {
        NavigationStack {
            Form {
                AccountSection(activeSheet: $activeSheet)

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
                    Button { activeSheet = .connection } label: {
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
            // Single presentation slot for everything raised from this tab's
            // NavigationStack. Two `.sheet` modifiers sharing one presenting
            // controller contend for its one presentation slot and lose the race on
            // first activation ("already presenting" → the sheet dismisses itself the
            // instant it opens — once per launch, and again after logout rebuilds this
            // subtree). Routing connection, sign-in, and profile-setup through a single
            // modifier removes the second presenter entirely.
            //
            // The new-account hand-off (sign-in → profile setup) runs in `onDismiss`,
            // i.e. only *after* the sign-in sheet has fully torn down — presenting the
            // next sheet while the previous one is still up is that same "already
            // presenting" race. `presentedSheet` records what was on screen so
            // dismissing profile setup itself ("Not now") doesn't reopen it.
            .sheet(item: $activeSheet, onDismiss: chainAfterDismiss) { sheet in
                switch sheet {
                case .connection: ConnectionView()
                case .signIn: SignInView()
                case .profileSetup: ProfileSetupView()
                }
            }
            .onChange(of: activeSheet) { _, newValue in
                if let newValue { presentedSheet = newValue }
            }
        }
    }

    /// After the sign-in sheet closes on a brand-new account (no profile yet), hand off
    /// to profile setup. Gated on the *sign-in* sheet having been the one dismissed, so
    /// a returning user (who lands in `.signedInWithProfile`) just closes the sheet, and
    /// "Not now" on profile setup doesn't immediately reopen it.
    private func chainAfterDismiss() {
        guard presentedSheet == .signIn, auth.status == .signedInNoProfile else { return }
        activeSheet = .profileSetup
    }
}

/// The one sheet a Settings screen can present at a time. Owned by `SettingsView`
/// so the connection, sign-in, and profile-setup flows never stack two `.sheet`
/// modifiers on the same NavigationStack.
enum SettingsSheet: Identifiable {
    case connection, signIn, profileSetup
    var id: Self { self }
}

/// The Account section of Settings. Signed-out shows a sign-in entry; signed-in shows
/// the profile summary with edit / sign out / delete. The middle state (signed in, no
/// profile yet) nudges the user to finish setup. Auth is optional — everything else in
/// the app works signed-out.
private struct AccountSection: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var sync: LogbookSyncManager
    /// The Settings-wide sheet slot, owned by `SettingsView`. The account buttons
    /// set it; a single `.sheet(item:)` up there does the presenting.
    @Binding var activeSheet: SettingsSheet?
    @State private var confirmingSignOut = false
    @State private var confirmingUnsyncedSignOut = false
    @State private var confirmingDelete = false
    @State private var isDeleting = false
    @State private var actionError: String?

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
        .confirmationDialog("Sign out?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await signOut() } }
            Button("Cancel", role: .cancel) {}
        }
        // Sign-out clears this device's cached logbook; guard the offline + unsynced
        // case so a logged ascent that never reached the cloud isn't silently dropped.
        .confirmationDialog(
            "Some logbook changes haven't synced yet and will be lost. Sign out anyway?",
            isPresented: $confirmingUnsyncedSignOut,
            titleVisibility: .visible
        ) {
            Button("Sign out and discard", role: .destructive) { Task { await performSignOut() } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Delete account? This permanently removes your account and cloud logbook. Your logbook stays on this device.",
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete account", role: .destructive) { Task { await deleteAccount() } }
            Button("Cancel", role: .cancel) {}
        }
    }

    /// Sign-out (R7): push anything unsynced first. If it can't (offline), warn before
    /// clearing the local cache; otherwise clear and sign out. Cloud copy is untouched.
    private func signOut() async {
        actionError = nil
        if sync.hasUnsyncedChanges {
            await sync.syncNow()               // best-effort push
            if sync.hasUnsyncedChanges {       // still dirty → offline; ask before discarding
                confirmingUnsyncedSignOut = true
                return
            }
        }
        await performSignOut()
    }

    private func performSignOut() async {
        await sync.clearLocalSyncedCacheAfterFlush()
        do { try await auth.signOut() }
        catch { actionError = error.localizedDescription }
    }

    /// Delete-account (R8): removes the cloud copy + identity but KEEPS the local
    /// logbook (reverts to signed-out, local-only). No unsynced-loss warning needed —
    /// `detachFromCloud` preserves every local row, including unsynced ones.
    private func deleteAccount() async {
        actionError = nil
        isDeleting = true
        defer { isDeleting = false }
        // Capture the user id BEFORE deletion — the session is gone afterward, so
        // detachFromCloud can't read it itself (#15).
        let userID = LogbookSession.userID
        do {
            try await auth.deleteAccount()
            if let userID { sync.detachFromCloud(userID: userID) }
        }
        catch { actionError = "Couldn't delete your account. Please try again." }
    }
}
