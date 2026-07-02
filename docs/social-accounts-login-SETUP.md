# Social accounts — login/profile: manual setup

The login + profile feature (branch `feat/social-accounts-login`) is code-complete but
**will not build or run until you finish the manual steps below** — creating the backend,
adding the SDK, and wiring up config that can't be scripted. Do them in order.

Scope of this milestone: **email magic link + Google sign-in + a `@handle` profile.**
Sign in with Apple, cloud logbook sync, friends, and shared lists are later plans.

---

## 1. Create the Supabase project

1. Sign in at <https://supabase.com> → **New project**. Pick a name/region, set a strong
   database password (save it in your password manager).
2. When it finishes provisioning, go to **Project Settings → API** and copy:
   - **Project URL** — you only need the host, e.g. `abcdefghijklmno.supabase.co`.
   - **anon / public** key (a long `eyJ…` JWT). This is public-safe (RLS-protected).

## 2. Run the database migration

Creates the `profiles` table, RLS policies, the handle format/uniqueness constraint, and
the `delete_user()` account-deletion RPC.

- **Easiest:** open **SQL Editor** in the dashboard, paste the entire contents of
  [`supabase/migrations/0001_profiles.sql`](../supabase/migrations/0001_profiles.sql),
  and **Run**.
- **Or with the CLI:** `supabase link --project-ref <ref>` then `supabase db push`.

## 3. Enable auth providers

**Authentication → Providers:**

- **Email** — enable. Confirm "magic link" style sign-in is on (default). Under
  **Authentication → Email templates**, the default "Magic Link" template is fine.
- **Google** — enable, then paste a Google OAuth **Client ID** and **Client secret**
  (created in step 4). Leave it enabled but unconfigured until you have those.
- **Apple** — leave **disabled** (deferred until paid Apple Developer enrollment).

## 4. Create the Google OAuth client

1. In the [Google Cloud Console](https://console.cloud.google.com) create (or pick) a
   project → **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Configure the **OAuth consent screen** first if prompted (External; add your email as
   a test user while unpublished).
3. Application type: **Web application** (Supabase brokers the OAuth exchange, so it's a
   web client, not iOS).
4. Under **Authorized redirect URIs** add your Supabase callback:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
5. Copy the generated **Client ID** + **Client secret** back into Supabase's Google
   provider (step 3).

## 5. Allow-list the app redirect + enable account linking

**Authentication → URL Configuration:**

- Add to **Redirect URLs**: `com.bertil.moonboardled://auth-callback`
  (this is the app's custom scheme; it must match exactly — see step 8).

**Authentication → (Sign In / Providers settings):**

- Turn **ON** account linking ("Link a new identity to an existing user" / "Allow manual
  linking"), so Google + magic link at the **same verified email** resolve to one user
  and one profile. (Not settable from SQL.)

## 6. Add the `supabase-swift` Swift package (in Xcode)

1. Open `ios/MoonBoardLED.xcodeproj`.
2. **File → Add Package Dependencies…**
3. Package URL: `https://github.com/supabase/supabase-swift`
4. Dependency rule: **Up to Next Major Version**, starting at `2.0.0`.
5. Add it to the **MoonBoardLED** target. When prompted for products, add **`Supabase`**
   (the umbrella product — pulls in Auth, PostgREST, etc.).
6. Build once so SPM resolves it. `Package.resolved` is gitignored, which is fine.

## 7. Fill in the Supabase credentials (xcconfig)

1. Copy the template:
   `cp ios/MoonBoardLED/Supabase.xcconfig.example ios/MoonBoardLED/Supabase.xcconfig`
   (the real `Supabase.xcconfig` is gitignored — it never gets committed).
2. Edit `Supabase.xcconfig` and set:
   - `SUPABASE_HOST` = your project host **without** the scheme, e.g.
     `abcdefghijklmno.supabase.co`
   - `SUPABASE_ANON_KEY` = the `eyJ…` anon key
3. **Wire the xcconfig into the target's build configurations:**
   - Select the **project** (top of the navigator) → **Info** tab → **Configurations**.
   - For **both Debug and Release**, set the **MoonBoardLED** target's configuration file
     to `Supabase.xcconfig`.
4. **Surface the values into Info.plist so the app can read them at runtime.** Select the
   **MoonBoardLED target → Info** tab → under **Custom iOS Target Properties** add two
   rows (type String):
   - Key `SUPABASE_HOST`, value `$(SUPABASE_HOST)`
   - Key `SUPABASE_ANON_KEY`, value `$(SUPABASE_ANON_KEY)`
   (`SupabaseClientProvider` reads these via `Bundle.main` and rebuilds the URL. If
   they're missing the app crashes on first Supabase use with a pointer back here — the
   app is otherwise fully usable signed-out.)

## 8. Register the custom URL scheme

So magic-link / OAuth redirects return to the app.

- **MoonBoardLED target → Info** tab → **URL Types** → **+**:
  - **Identifier:** `com.bertil.moonboardled` (any unique string)
  - **URL Schemes:** `com.bertil.moonboardled`
- This must match `SupabaseConfig.redirectURL`
  (`com.bertil.moonboardled://auth-callback`) and the redirect URL you allow-listed in
  step 5.

## 9. Build & verify

`⌘R` onto a real device (BLE needs hardware; auth works in the Simulator too). Then run
through the plan's verification checklist:

- Sign in via **magic link** and **Google**; confirm a `profiles` row appears
  (Supabase → Table editor → `profiles`) and that a second account can't claim a taken
  handle (case-insensitively).
- Google, then magic link at the **same email** → one account, one profile.
- Quit during profile setup (no handle) → relaunch re-offers setup; app still usable; no
  null-handle row in the DB.
- Kill/relaunch → session restores without re-auth; **Sign out** clears it; **Delete
  account** removes the auth user + `profiles` row.
- Confirm the app still works fully **signed-out** (BLE, catalog, local logbook).

---

## Later (do NOT do now)

- **Sign in with Apple:** requires the paid Apple Developer Program. On enrolling: add
  the Sign-in-with-Apple entitlement + an Apple Services ID, enable the Apple provider in
  Supabase, and implement `AuthManager.signInWithApple()`. ⚠️ **App Store Guideline
  4.8** requires offering Sign in with Apple once you ship Google/email login — add it
  before any TestFlight/App Store release.
- **Environments:** this uses a single Supabase project. Split dev/prod before real users.
