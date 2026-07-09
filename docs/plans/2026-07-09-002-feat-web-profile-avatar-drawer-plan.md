---
title: "feat: Profile redesign — navbar avatar, right-side account drawer, edit profile with avatar upload, member avatars in rosters"
date: 2026-07-09
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: grill-me
depth: standard
tier: safety-critical
---

# feat: Profile redesign — navbar avatar, right-side account drawer, edit profile with avatar upload, member avatars in rosters

## Summary

Turn the signed-in account control from a text `@handle` button + bottom sheet into an
**avatar button + right-side drawer** with an **inline edit-profile view**, and wire
**real avatar images** end-to-end for the first time (upload, storage, render — including
other members' avatars in session rosters).

Today `profiles.avatar_url` exists in the DB and the `Profile` type but is dead: nothing
writes it, no storage bucket exists, and every avatar in the app is initials-only. This
plan adds the `avatars` Supabase Storage bucket (safety-critical migration), a
client-side image pipeline, and the UI to manage and display avatars.

Scope is the **signed-in-with-profile** experience plus member-avatar rendering. Signed-out
and profile-setup states are untouched. The handle stays read-only.

> **Tier: safety-critical.** This plan touches `supabase/migrations/**` (new bucket + RLS).
> Per `AGENTS.md`, run at `effort: max`, plan test-first, review mandatory. The migration and
> its RLS policies are verified against a throwaway Postgres before any UI is wired
> (memory `supabase-migration-local-testing`).

---

## Problem Frame

The account menu (`web/src/auth/AccountMenu.tsx`) renders `@{profile.handle}` as a ghost
`Button` in the top-**right** header (`web/src/shell/AppLayout.tsx:155`), and clicking it
opens a shadcn **Drawer** anchored to the bottom (`swipeDirection="down"`) with Sign out +
a two-step Delete account confirm. There is no avatar and no way to edit the profile.

Two gaps:

1. **Presentation.** The user wants an avatar (not a text handle) as the account affordance,
   a side drawer instead of a bottom sheet, and a place to edit their display name and photo.
2. **Capability.** Avatars have always been deferred — `avatar_url` is reserved but unused
   (`supabase/migrations/0001_profiles.sql`, comment "column reserved; avatar upload is
   deferred"). `saveProfile` never writes it, there's no storage bucket, and `MemberAvatar`
   renders initials only. Delivering the edit-profile ask means finally building the whole
   avatar path.

The design below was fully resolved in a grill-me session; the resolved decisions are
captured as KTDs so this plan does not re-litigate them.

---

## Product Contract

### Requirements

- **R1** — When signed in with a profile, the top-right account control is an **avatar
  button** (not text). It shows the user's avatar image if set, else an initials fallback
  derived from `displayName` (falling back to `handle`). Accessible label = `displayName ||
  @handle`.
- **R2** — Clicking the avatar opens a **right-side drawer** (slides in from the right edge),
  replacing the current bottom sheet.
- **R3** — The drawer's default (**menu**) view shows a profile header (avatar + display name
  + read-only `@handle`), then **Edit profile**, **Sign out**, and the existing **two-step
  inline Delete account** confirm (behavior unchanged).
- **R4** — **Edit profile** swaps the drawer content inline (no navigation, no nested drawer)
  to an **edit** view with: an avatar picker, a **Remove photo** action when an avatar is set,
  a **display name** field, and **Save** / **Cancel**.
- **R5** — Display name is **required** (non-empty after trim) and capped at **50 characters**.
  Save is blocked with an inline message when empty. The edit form **pre-fills the field with the
  current display name, or the handle when it's empty**, so a user with a legacy empty
  `display_name` is never blocked on a photo-only edit. The handle is **read-only** everywhere in
  this flow.
- **R6** — Choosing a photo **stages** it client-side only: the image is decoded, center-cropped
  to a square, downscaled to ~512px, and re-encoded to **WebP** for a local preview. Nothing is
  uploaded until Save. **Cancel discards the staged image with zero side effects.**
- **R7** — On **Save**, the flow (a) uploads the staged WebP to the `avatars` bucket at a unique
  path, (b) persists the new `avatar_url` **and** display name via the profile-write path, then
  (c) best-effort deletes the previously-stored object. **Remove photo** on Save sets
  `avatar_url = null` and best-effort deletes the object.
- **R8** — A user can only ever write, overwrite, or delete objects under their **own**
  `{user_id}/` prefix in the bucket; reads are public. This is enforced by Storage RLS,
  server-side, independent of the client.
- **R9** — Other members' avatars render as **real images** where members appear — session
  roster surfaces (`SessionBar`, `SessionPill`, `MemberStatusRow`) — falling back to initials
  when a member has no avatar or the image fails to load.
- **R10** — Signed-out and signed-in-without-profile states are **unchanged** (sign-in button,
  profile-setup flow untouched).
- **R11** — Unreadable/undecodable image selections fail gracefully with an inline
  "couldn't read that image, try another" message; no upload is attempted.

### Acceptance examples

- **AE1** — Signed-in user with no avatar sees a circular initials button top-right; clicking it
  slides a drawer in from the right showing their name, `@handle`, Edit / Sign out / Delete.
- **AE2** — Edit → pick a 9 MB HEIC from an iPhone gallery → preview appears instantly (staged) →
  Save → avatar shows in navbar, drawer, and the user's roster chip; a second later the old
  object is gone from the bucket.
- **AE3** — Edit → change display name to empty → Save is blocked with an inline error.
- **AE4** — Edit → pick a new photo → Cancel → avatar unchanged, nothing uploaded, no bucket
  object created.
- **AE5** — Edit → Remove photo → Save → navbar/drawer/roster revert to initials; bucket object
  deleted.
- **AE6** — A second signed-in user (attacker) attempts to upload/delete under the first user's
  `{uid}/` prefix → rejected by RLS (proven in the migration test).
- **AE7** — A session with three members, two of whom have avatars, renders two images and one
  initials fallback in `SessionBar`.

### Product scope / boundaries

- **In:** navbar avatar, right-side drawer, inline edit view, display-name editing, avatar
  upload/replace/remove, `avatars` bucket + RLS, member-avatar image rendering in rosters.
- **Out (explicit):** editing the handle; cropper UI with drag/zoom (center-crop only — **accepted
  tradeoff:** an off-center subject can be cropped awkwardly; a reposition affordance or
  upper-bias/face-aware crop is a follow-up if avatar-quality complaints surface); multiple photos /
  galleries; animated avatars; avatar in non-roster surfaces not currently using `MemberAvatar`;
  signed-out/setup restyling; moderation of uploaded images (see Q5).

---

## Planning Contract

### Key Technical Decisions

- **KTD1 — Public `avatars` bucket, owner-only write.** A single public bucket named `avatars`;
  `avatar_url` stores a plain public CDN URL usable directly in `<AvatarImage src>` everywhere,
  no signed-URL plumbing. Storage RLS scopes insert/update/delete to
  `(storage.foldername(name))[1] = auth.uid()::text`. The bucket is `public`, so objects serve
  unauthenticated at `/storage/v1/object/public/avatars/...` (what `<img>` needs); the
  `storage.objects` **SELECT policy is scoped `to authenticated`** (matching `0008`), **not fully
  public**, so anonymous callers cannot `list()`/enumerate every user's `{uid}` folder and face
  photo. Contrast with the private `logbook-imports` bucket (personal data) — an avatar is
  intentionally viewable, but enumeration is not granted.
- **KTD2 — Unique filename per upload + delete-old.** Objects are written at
  `{user_id}/{uuid}.webp`. A changed URL sidesteps all CDN/browser cache staleness (the usual
  "my new avatar didn't save" bug); the previous object is deleted best-effort **after** the new
  URL is persisted, so a mid-flight failure never leaves the user avatar-less. Orphan accounting is
  asymmetric: the delete step only reclaims the *previous* object, so an upload-succeeds /
  persist-fails path strands the just-uploaded object — the Save handler must best-effort delete the
  **new** object on persist failure to compensate (see U4). Any stray orphan is harmless (public,
  tiny) and is further bounded by the account-deletion sweep (U1); periodic cleanup stays deferred
  (Q1).
- **KTD3 — Client-side canvas pipeline, no cropper, no new dependency.** On select, decode via an
  `Image`/`createImageBitmap`, draw center-cropped to a square `<canvas>` at ~512px, and
  `canvas.toBlob(..., 'image/webp')`. Output is ~50–150 KB. `accept="image/*"`; iOS *usually*
  converts HEIC to JPEG on `<input type=file>` selection, but that is a Safari default, **not a
  guarantee** — in-app webviews, Chrome/Firefox-on-iOS, and some share-sheet paths can hand over raw
  HEIC that browsers can't decode. So decode is best-effort: on failure emit an **actionable** R11
  message (suggest re-saving the photo as JPEG), and verify the real iOS browser/webview matrix
  during U2 (Q3) — treat AE2 as pass only once confirmed on-device. Also, `canvas.toBlob` *silently
  returns PNG* when the requested type is unsupported rather than throwing, so U2 must assert
  `blob.type === 'image/webp'` (else fall back / surface R11) and U3 must derive the upload
  `contentType` from the actual blob, not hardcode `image/webp`. Bucket `allowed_mime_types` is
  `['image/webp']` because that is what the pipeline emits (the allowlist governs the stored object,
  never the user's source file).
- **KTD4 — Staged upload, commit-on-Save.** File selection produces an in-memory WebP `Blob` +
  object-URL preview and touches nothing remote. Save orchestrates upload → persist → delete-old.
  Cancel revokes the object URL and drops the blob. This makes Cancel truly free and keeps the
  network work in one place.
- **KTD5 — Extend the single profile-write path.** `saveProfile` (`AuthProvider.tsx`, "the ONLY
  place a profiles row is created") gains an avatar argument:
  `saveProfile(handle, displayName, avatarUrl?: string | null)`. When the third arg is provided
  (including `null`) it is written to the upsert; when omitted the column is left untouched. The
  edit form always passes an explicit value. Handle is passed through unchanged (read-only).
  Because `profiles` is world-readable and `avatar_url` renders as `<AvatarImage src>` in *other*
  members' browsers, an unvalidated value is a tracking-pixel/SSRF-lite vector (a user could point
  it at an attacker URL and harvest viewers' IP/User-Agent). U1 therefore adds a DB **CHECK/trigger**
  constraining `avatar_url` to `null` or the project's `/storage/v1/object/public/avatars/` prefix,
  so a stored URL can only point into the owner-scoped bucket; `saveProfile` validates client-side
  too. (A restrictive `img-src` CSP on the app origin is a complementary defense.)
- **KTD6 — Reuse the existing Drawer primitive as a side drawer.** No new component. The installed
  `web/src/components/ui/drawer.tsx` already supports `swipeDirection="right"` with full styling
  (24rem desktop / 75% mobile, right-edge anchoring, rightward swipe-to-close). The account drawer
  switches from `swipeDirection="down"` to `"right"`.
- **KTD7 — Inline `mode` state, not routing or nested drawers.** A `mode: 'menu' | 'edit'` state in
  `AccountMenu` swaps the drawer body. Cheapest to build/test; Cancel flips back to `menu`. Closing
  the drawer resets to `menu`.
- **KTD8 — Widen the roster query, not a new data source.** `loadRoster` already batch-fetches
  profiles by id (the batch-profile-fetch convention noted in the `sessionsStore.ts` code comment);
  it just doesn't select `avatar_url`. Add
  the column to the select and thread `avatarUrl` through `SessionMember` and `MemberAvatar`. No
  join change, no realtime.
- **KTD9 — shadcn/base-ui components only** per `web/CLAUDE.md`: reuse `Avatar`/`AvatarImage`/
  `AvatarFallback`, `Drawer*`, `Button`, `Input`, `Label`. Inputs follow the `text-base md:text-sm`
  idiom to avoid iOS zoom-on-focus (memory `web-input-font-size-idiom`). `AvatarImage` →
  `AvatarFallback` already handles image-load failure, so no bespoke broken-image handling.

### Assumptions

- `canvas.toBlob(..., 'image/webp')` is available in the app's supported browsers (current
  Safari/Chrome/Firefox) as of 2026, but the failure mode is **silent** (unsupported type → PNG
  blob, not a throw), so U2 asserts the output type rather than relying on this holding (KTD3).
- `profiles` remains world-readable to authenticated users (existing RLS in `0001_profiles.sql`),
  so member `avatar_url` values are fetchable by the roster query.
- Supabase Storage public-URL shape (`/storage/v1/object/public/avatars/...`) is stable and
  derivable via the client SDK's `getPublicUrl`.

### Sequencing

U1 (migration + RLS, test-first) is the foundation and lands first with its throwaway-PG test.
U2 (image pipeline) and U3 (`saveProfile` + upload/remove/delete helpers) are pure/near-pure and
can proceed in parallel after U1. U4 (drawer + edit UI) depends on U2/U3. U5 (member avatars) is
independent of the drawer work and depends only on U1 existing (so real URLs exist to show).

---

## Implementation Units

### U1. `avatars` storage bucket + RLS migration (test-first)

**Goal:** A public `avatars` bucket whose objects only their owner can write/replace/delete,
proven by an RLS test before any UI exists.

**Requirements:** R8. **Supports:** R6, R7, R9.

**Dependencies:** none. **Tier: safety-critical — `effort: max`, test-first.**

**Files:**
- `supabase/migrations/0009_avatars.sql` (new)
- `supabase/migrations/tests/` — new RLS test following the existing throwaway-PG pattern
  (memory `supabase-migration-local-testing`), mirroring the **`0008`** RLS test (the only existing
  storage-bucket test — there is no `0001` test). **`run_rls_test.sh` is hardcoded to a single
  migration (`0008`) — generalize it to apply the `0008 → 0009` chain** so both the avatars policies
  and the extended `delete_user()` sweep are exercised.

**Approach:**
- Insert the bucket: `insert into storage.buckets (id, name, public, file_size_limit,
  allowed_mime_types) values ('avatars','avatars', true, 2097152, array['image/webp'])`
  (2 MB, WebP only). Idempotent (`on conflict do nothing`), matching the `0008` bucket style.
- Add policies on `storage.objects` for `bucket_id = 'avatars'`:
  - **SELECT**: `to authenticated` (`using (bucket_id = 'avatars')`) — public `<img>` rendering
    uses the bucket's `/object/public/` serving, so object *listing* is not exposed to anon.
  - **INSERT/UPDATE/DELETE**: `to authenticated`, gated by
    `bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text`. A single
    `create policy ... for all` cannot span these in Postgres RLS — emit separate per-command
    policies (settle the exact shape against the `0008` precedent).
- **Constrain `profiles.avatar_url`** (KTD5): a CHECK or `before insert/update` trigger allowing
  only `null` or a value beginning with the project public-avatars URL prefix.
- **Extend `public.delete_user()`** to also `delete from storage.objects where bucket_id =
  'avatars' and (storage.foldername(name))[1] = auth.uid()::text` **before** deleting the auth user
  — mirroring the `0008` `logbook-imports` sweep. `storage.objects.owner` is set-null (not cascade)
  on user delete, so without this a deleted user's face photo (personal data) stays publicly
  fetchable — a GDPR / App-Store-5.1.1 erasure gap.
- Keep policy names namespaced (`avatars_owner_read`, `avatars_owner_write`, …).

**Test scenarios (throwaway PG + auth stubs; harness applies `0008 → 0009`):**
- Owner can INSERT an object at `{own_uid}/x.webp`; can UPDATE and DELETE it.
- A different authenticated user is **denied** INSERT/UPDATE/DELETE under the first user's
  `{uid}/` prefix (AE6).
- INSERT at a path whose first folder ≠ caller uid is denied even for the caller.
- **Anon cannot `list()`/SELECT** `storage.objects` for the bucket (enumeration closed); object
  *serving* via `/object/public/` is unaffected.
- **`delete_user()` sweeps avatars:** after a user with an `{uid}/x.webp` object runs
  `delete_user()`, no `avatars/{uid}/*` objects remain.
- **`avatar_url` CHECK:** upserting a profile with an external `avatar_url`
  (e.g. `https://evil.example/x`) is rejected; `null` and a valid `/object/public/avatars/...` URL
  pass.

**Definition of done:** the `0008 → 0009` chain applies cleanly; all RLS tests pass (owner-only
write, anon-no-enumerate, `delete_user()` avatar sweep, `avatar_url` CHECK); no UI yet.

---

### U2. Client-side avatar image pipeline (pure-ish, canvas)

**Goal:** Turn an arbitrary user-selected image file into a ~512px square WebP `Blob` +
preview URL, or fail cleanly.

**Requirements:** R6, R11. **Dependencies:** none.

**Files:**
- `web/src/auth/avatarImage.ts` (new)
- `web/src/auth/avatarImage.test.ts` (new)

**Approach:**
- Export `processAvatarFile(file: File): Promise<{ blob: Blob; previewUrl: string }>`.
- Decode via `createImageBitmap(file)` (fallback to an `Image` + object URL if needed); draw
  center-cropped to a square `OffscreenCanvas`/`<canvas>` at `TARGET = 512`; `toBlob('image/webp',
  quality)`. Reject with a typed error on decode/encode failure (drives R11).
- Center-crop math: `side = min(w, h)`, source offset `(w-side)/2, (h-side)/2`, dest `512×512`.
- Keep it DOM-only-at-the-edges so the crop math is unit-testable (extract a pure
  `computeCropRect(w, h, target)` helper and test it directly; canvas/toBlob covered by a thin
  integration test or mocked in jsdom).

**Test scenarios:**
- `computeCropRect` on landscape, portrait, and square inputs yields a centered square.
- Non-image / corrupt file rejects with the typed error (no throw leaking).

---

### U3. Avatar storage helpers + `saveProfile` extension

**Goal:** Upload a staged blob, expose its public URL, delete old objects, and let the profile
write persist `avatar_url` (including `null`).

**Requirements:** R7, R5 (handle read-only pass-through). **Dependencies:** U1.

**Files:**
- `web/src/auth/avatarStorage.ts` (new) — `uploadAvatar(userId, blob) → { path, publicUrl }`,
  `deleteAvatarObject(path)` (best-effort, swallow "not found").
- `web/src/auth/AuthProvider.tsx` — extend `saveProfile` signature to
  `(handle, displayName, avatarUrl?: string | null)`; include `avatar_url` in the upsert only when
  the arg is provided. Consider exposing a small `updateAvatar` convenience if the edit form needs
  the old path for cleanup (see U4).
- `web/src/auth/avatarStorage.test.ts` (new) — path construction + URL derivation with a mocked
  Supabase client (mirror the existing upload/insert mock typing from PR #64 so `tsc -b` passes —
  memory `web-typecheck-use-tsc-b`).

**Approach:**
- `uploadAvatar` writes `{userId}/{uuid}.webp` via `storage.from('avatars').upload(path, blob,
  { contentType: blob.type })` (derive from the actual blob — U2 asserts it is `image/webp`), then
  `getPublicUrl(path)`.
- Derive `uuid` with `crypto.randomUUID()` (app code — the `Math.random`/`Date.now` ban is
  workflow-script-only, not React/runtime code).
- `saveProfile` upsert adds `avatar_url` when the third arg is passed; omitting it preserves the
  column (so non-avatar profile writes elsewhere are unaffected). It also **rejects a non-null
  `avatarUrl` that isn't under the public-avatars prefix** (defense-in-depth beside the DB CHECK,
  KTD5).

**Test scenarios:**
- `uploadAvatar` calls `upload` with a `{uid}/<uuid>.webp` path and the blob's `image/webp` content
  type; returns the public URL from `getPublicUrl`.
- `saveProfile(h, d, url)` includes `avatar_url: url` in the upsert; `saveProfile(h, d, null)`
  includes `avatar_url: null`; `saveProfile(h, d)` omits the key; a non-bucket `url` is rejected.

---

### U4. Navbar avatar button + right-side drawer + inline edit view

**Goal:** Replace the text handle with an avatar button, make the drawer a right-side drawer, and
add the inline edit view that stages/saves avatar + display name.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R10, R11. **Dependencies:** U2, U3.

**Files:**
- `web/src/auth/AccountMenu.tsx` — main changes.
- (only the `status === 'signedInWithProfile'` branch; leave other branches untouched — R10.)

**Approach:**
- **Trigger:** swap the `@{profile.handle}` `Button` for an avatar button — a `Button
  variant="ghost" size="icon"` wrapping `<Avatar size="sm"><AvatarImage src={profile.avatarUrl}
  /><AvatarFallback>{initials}</AvatarFallback></Avatar>`. `aria-label = profile.displayName ||
  '@' + profile.handle`, `aria-haspopup="menu"`. Ensure the button's tap area is ≥~44px even though
  the avatar glyph is `sm`. Initials helper: first char(s) of `displayName` else `handle`
  (reuse/mirror the roster `memberInitials` logic to keep one convention).
- **Drawer:** change `swipeDirection="down"` → `"right"`. Keep `showSwipeHandle`. **`DrawerTitle` is
  `'Edit profile'` when `mode==='edit'`, else `@handle`** (so assistive tech doesn't announce a
  stale handle as the edit form's accessible name). On `onOpenChange(false)`: if edits are pending
  (`staged`, `removeRequested`, or a changed name), **guard the dismiss with a lightweight confirm**
  rather than silently discarding a typed name / just-picked photo (an accidental rightward swipe or
  backdrop tap on mobile otherwise reads as data loss); otherwise reset `mode` to `'menu'` and clear
  staged image/errors.
- **menu view:** header block (avatar + `displayName` + muted read-only `@handle`) + **Edit
  profile** (primary, top) + **Sign out** + the existing two-step Delete confirm (unchanged).
- **edit view (`mode==='edit'`):**
  - Local state: `displayNameDraft`, `staged: { blob, previewUrl } | null`, `removeRequested:
    boolean`, `error`, `saving`.
  - Avatar preview shows `staged.previewUrl` → else (if not removeRequested) `profile.avatarUrl`
    → else initials. A hidden `<input type=file accept="image/*">` behind a photo button labelled
    **"Add photo"** when no avatar is set (and none staged), **"Change photo"** otherwise; on change
    call `processAvatarFile` (U2), set `staged` or `error` (R11 — actionable message per KTD3).
    **Remove photo** button (shown when an avatar exists and none staged) sets
    `removeRequested=true`, clears `staged`.
  - display name `Input` (`maxLength={50}`, `text-base md:text-sm`); Save disabled when trimmed
    empty, with inline message (R5).
  - **Save:** set `saving=true` and **disable Save + Cancel** (in-button "Saving…" spinner); ignore
    drawer-close while saving. If `staged` → `uploadAvatar` (U3) → `newUrl`; else if
    `removeRequested` → `newUrl = null`; else leave avatar unchanged (pass current
    `profile.avatarUrl`). Call `saveProfile(profile.handle, displayNameDraft.trim(), newUrl)`. On
    success: best-effort `deleteAvatarObject(oldPath)` derived from the prior `avatar_url` when it
    changed; **trigger a roster reload** (`refreshActiveSession()` / a new `refreshRoster()`) so the
    user's *own* roster chip reflects the new avatar — the roster is a separate non-realtime snapshot
    from `profile`, so without this AE2's "roster chip" clause fails; revoke the preview object URL;
    return to `menu`. **If `uploadAvatar` succeeds but `saveProfile` fails**, best-effort delete the
    just-uploaded object (compensating delete — KTD2). Errors surface inline and **re-enable Save**
    for retry; nothing is left half-committed (persist before delete — KTD2/KTD4).
  - **Cancel:** revoke preview URL, drop staged state, back to `menu` (R6/AE4).
- **Focus & roles:** the menu view keeps `role="menu"`/`role="menuitem"`; the **edit view is a form,
  not a menu** — do not carry menu roles onto its fields. On entering edit, move focus to the first
  control (or the "Edit profile" heading); on Save/Cancel, return focus to the "Edit profile"
  trigger. Preserve the existing `menuError` inline-error pattern.

**Test scenarios (browser `/verify`, see Verification Contract):** AE1–AE5, AE7-adjacent.

---

### U5. Member avatar images in rosters

**Goal:** Render real images for members who have avatars, everywhere `MemberAvatar` is used.

**Requirements:** R9. **Dependencies:** U1 (so real URLs can exist; renders fallback until then).

**Files:**
- `web/src/sessions/sessionsStore.ts` — `loadRoster`: add `avatar_url` to the profiles
  `.select('id, handle, display_name, avatar_url')`; widen `profilesById` type to include
  `avatarUrl: string | null`; map it.
- `web/src/sessions/sessionsTypes.ts` — add `avatarUrl: string | null` to `SessionMember`; add it
  to the `profile` param type of `fromSessionMemberRow` and map `avatarUrl: profile?.avatarUrl ??
  null`.
- `web/src/sessions/MemberAvatar.tsx` — add `avatarUrl?: string | null` prop; render
  `<AvatarImage src={avatarUrl ?? undefined} />` above the existing `<AvatarFallback>`.
- Callers: `web/src/catalog/SessionBar.tsx` (both call sites, ~lines 137, 173),
  `web/src/shell/SessionPill.tsx` (~line 46) — pass `avatarUrl={m.avatarUrl}`.
- `web/src/catalog/MemberStatusRow.tsx` — add an `avatarUrl?` prop and forward it; update its
  caller `FilterControls` to supply the member's `avatarUrl` (it's prop-driven, not member-object
  driven).

**Approach:** purely additive prop/column threading; `AvatarFallback` already covers the
no-image/error case, so members without avatars are visually unchanged. The *self* chip's freshness
after an avatar edit is handled by U4's post-Save roster reload (alternatively, render the self
member from the live `profile.avatarUrl`); pick one and keep it consistent so AE2/AE5 hold.

**Test scenarios:**
- `fromSessionMemberRow` maps `avatarUrl` (present and `null`).
- Roster with mixed avatar/no-avatar members renders images + fallbacks (AE7) — browser verify.

---

## Verification Contract

- **Typecheck/build:** `cd web && npm run build` (i.e. `tsc -b` + Vite) — **not** `tsc --noEmit`
  (memory `web-typecheck-use-tsc-b`). Must pass, including the Supabase mock typing (PR #64
  pattern) for the new storage mocks.
- **Unit tests:** `cd web && npm test` (or the repo's configured runner) covering U2
  (`computeCropRect`, decode failure), U3 (`uploadAvatar` path/URL, `saveProfile` avatar arg),
  U5 (`fromSessionMemberRow`).
- **Migration RLS test (safety-critical gate):** run the U1 throwaway-Postgres test proving
  owner-only write, anon-no-enumerate, the `delete_user()` avatar sweep, and the `avatar_url` CHECK
  (memory `supabase-migration-local-testing`). This proves *predicate correctness* and must be green
  before U4/U5 are wired — it does **not** prove the bucket exists in prod (see deploy order).
- **Deploy order (prod):** `0009` is applied manually to the production Supabase project (paste into
  the SQL Editor, as `0008` required) and the `avatars` bucket confirmed present **before** U4/U5
  code deploys to Vercel — otherwise every real upload fails against a missing bucket. The
  throwaway-PG gate and this prod-apply gate are distinct.
- **Browser end-to-end (`/verify`):** against the real Supabase project — AE1 (avatar button +
  right drawer), AE2 (iPhone-style pick → stage → Save → new URL, old object gone), AE3 (empty
  name blocked), AE4 (Cancel = no upload), AE5 (Remove photo), AE7 (mixed roster). Confirm the
  navbar, drawer, and roster all reflect the new avatar.
- **Lint:** repo linter clean on changed files.

---

## Definition of Done

- `avatars` bucket + RLS migration (`0009`) applied and its RLS test green (owner-only write,
  cross-user write denied, anon cannot enumerate, `delete_user()` sweeps avatars, `avatar_url`
  CHECK); `0009` applied to prod **before** the UI deploys.
- Navbar shows an avatar button (image or initials) for signed-in-with-profile users; other auth
  states unchanged.
- Clicking the avatar opens a right-side drawer; menu view has header + Edit / Sign out / two-step
  Delete (unchanged).
- Edit view: change display name (required, ≤50), change photo (staged → committed on Save with
  old-object cleanup), remove photo, cancel with no side effects; graceful error on unreadable
  images.
- `saveProfile` persists `avatar_url` (including `null`); handle stays read-only.
- Member avatars render real images in `SessionBar`, `SessionPill`, `MemberStatusRow`, with
  initials fallback.
- Build (`tsc -b`), unit tests, migration RLS test, lint, and the browser `/verify` pass.
- Docs: update the relevant `docs/` subsystem file if avatar/storage behavior is documented there
  (per root `CLAUDE.md` doc-discipline); note the new bucket wherever storage buckets are listed.

---

## Open Questions

- **Q1 (deferred, non-blocking)** — Should we constrain concurrent orphan buildup (e.g. a periodic
  cleanup of `avatars/{uid}/*` objects not referenced by the current `avatar_url`)? Not needed for
  correctness (delete-on-replace + public/tiny objects); revisit only if bucket size becomes a
  concern.
- **Q2 (deferred, non-blocking)** — Whether to also surface avatars in any non-roster member
  surfaces later (e.g. shared-list collaborators) — out of scope here, easy follow-up once the
  column is threaded.
- **Q3 (deferred, non-blocking)** — `createImageBitmap` vs `<img>` decode fallback ordering for the
  broadest mobile support; settle during U2 implementation against the real device matrix (also
  covers the iOS-HEIC decodability question, KTD3).
- **Q4 (resolved)** — Requiring a non-empty display name on every Save risked blocking a legacy
  empty-`display_name` user from a photo-only edit. **Resolved:** the edit form pre-fills the field
  with the current display name, falling back to the handle when empty (R5), so Save is never empty
  and R5's "required, ≤50" is preserved.
- **Q5 (deferred, non-blocking)** — Public avatars are an unmoderated UGC surface visible to other
  members in an app going social; record a takedown/moderation story as a deliberate deferral to
  revisit as the social surface grows.

No launch-blocking questions remain: Q4 is resolved, and Q1–Q3/Q5 are deferred and non-blocking.
The plan is implementation-ready.
