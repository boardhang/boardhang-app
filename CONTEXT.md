# MoonBoard LED — Handoff / Orientation

**Read this first.** It orients you; the deep dives in [`docs/`](docs/README.md) own the
detail. This doc *summarizes and links* — it does not re-explain subsystems. If a section
here grows into a second copy of a `docs/` file, trim it back to a summary + link.

Pairs with [`README.md`](README.md) (user-facing run guide).

## What this is

A native **SwiftUI + SwiftData iOS app** (plus a companion Web Bluetooth PWA — see the repo
map) for authoring and lighting boulder problems on a **DIY LED-wired MoonBoard**. You build a
problem by tapping holds (auto-cycling taps or per-role brushes, Font grade); the app drives an
**Arduino** running the fixed
[FabianRig/ArduinoMoonBoardLED](https://github.com/FabianRig/ArduinoMoonBoardLED) firmware over
Bluetooth (Nordic UART) to live-preview, light, clear, and calibrate the LEDs.

The reference/physical hardware is a **Mini MoonBoard 2025** (11 cols A–K × 12 rows = 132
holds). LED geometry is row-parameterized (12-row Mini / 18-row full boards) and the lighting
path can drive a full wall too — the Mini is a hardware limit, not a code one; only the
custom-problem editor is Mini-specific.

Beyond authoring it bundles read-only **official-problem catalogs** for five layouts (Mini
2025, 2016, 2024, Masters 2017/2019 — ~22k problems across 40°/25°) with search/sort/filter/
favorites, a **multi-board** model (per-board angle + installed hold-set filtering), a local
**logbook** of ascents/attempts with a grade-pyramid view, and **optional accounts** (email
code or Google, `@handle`). Everything except sign-in works fully offline.

## Repo map (a monorepo)

| Dir | What |
| --- | --- |
| `ios/` | **Primary app** — native SwiftUI + CoreBluetooth + SwiftData. Multi-board catalog, logbook, accounts. The live Xcode project is **`ios/MoonBoardLED.xcodeproj`**. |
| `web/` | Companion **Web Bluetooth PWA** (Vite + React 19 + TS). Partial port: connect → build → light/clear. No catalog/logbook. |
| `shared/spec/` | **Markdown specs only** (BLE, geometry, data model). Not shared code — `web/` reimplements them in TS. |
| `supabase/` | Postgres migration(s) backing accounts/profiles. |
| `docs/` | Subsystem deep dives + index ([docs/README.md](docs/README.md)). |
| `scripts/` | Python catalog fetchers + board-art importers. |
| `catalog-data/` | Pre-fetched board catalogs (NOT bundled; copy into iOS `Resources/` to add a board). |

## Build & run

**iOS:** open `ios/MoonBoardLED.xcodeproj` (Swift 5 mode, iOS 17). One SPM dep:
`supabase-swift`. Supabase creds go in `ios/MoonBoardLED/Supabase.xcconfig` (gitignored;
copy from `.example`). Build check (no signing):
```
xcodebuild -project ios/MoonBoardLED.xcodeproj -scheme MoonBoardLED \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO
```
BLE only works on a real device, not the Simulator. Full run steps: [README.md](README.md).

**Web:** `cd web && npm run dev` (build: `npm run build`, lint: `npm run lint`). Web Bluetooth
needs a secure context — desktop Chrome/Edge, Android Chrome, or iPhone via Bluefy. Details:
[docs/pwa-monorepo-plan.md](docs/pwa-monorepo-plan.md).

## ⚠️ Load-bearing gotchas (things that cost hours if missed)

- **The 20-byte BLE bug** — the firmware's RX characteristic silently truncates writes >20
  bytes, so a naive single write delivers only ~4 holds. Every message must be split into
  **≤20-byte chunks sent with flow control** (`peripheralIsReady(toSendWriteWithoutResponse:)`);
  do **not** size by `maximumWriteValueLength`. This is *why the app exists* (it's the bug that
  broke the official app). Full protocol: [docs/ble-hardware.md](docs/ble-hardware.md).
- **The real Xcode project is `ios/MoonBoardLED.xcodeproj`.** The repo-root
  `MoonBoardLED.xcodeproj/` is a stale empty shell (no `project.pbxproj`) — ignore it.
- **Offline-first invariant.** If `Supabase.xcconfig` is absent, `SupabaseClientProvider.shared
  == nil`, `AuthManager` stays `signedOut`/inert, and Settings shows no auth entry point.
  Preserve "app fully usable signed-out."
- **SwiftData enum-rename crash.** Changing/removing a `HoldType` raw value makes old saved
  problems undecodable → fatal `DecodingError` on launch. There is intentionally no migration
  shim — the app must be deleted from the device to wipe the store. See
  [docs/data-model-and-logging.md](docs/data-model-and-logging.md).
- **Secrets are local-only.** Real Supabase creds live in `web/.env`
  (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) and `ios/MoonBoardLED/Supabase.xcconfig` —
  both gitignored. Never commit them; copy from the `.env.example` / `.xcconfig.example`
  templates and fill in your own.
- **Branch reality:** iOS auth is on `main`; **web auth is only on `feat/pwa-login`**, unmerged.
  Don't hunt for Supabase code in `web/` on `main` — there isn't any.

## Where to read next

| Working on… | Read |
| --- | --- |
| Bluetooth, LED lighting, connection, calibration | [docs/ble-hardware.md](docs/ble-hardware.md) |
| Hold coords, LED index math, board rendering | [docs/board-geometry.md](docs/board-geometry.md) |
| Board registry, adding a board, active/added boards, hold-set filtering | [docs/multi-board-model.md](docs/multi-board-model.md) |
| Catalog data, JSON schemas, the Python fetch scripts | [docs/catalog-data-pipeline.md](docs/catalog-data-pipeline.md) |
| SwiftData models, logging ascents, logbook & pyramid | [docs/data-model-and-logging.md](docs/data-model-and-logging.md) |
| Tabs, navigation, Home board management, Settings | [docs/navigation-and-ui-flows.md](docs/navigation-and-ui-flows.md) |
| Accounts, Supabase setup, Google/email auth, profiles | [docs/social-accounts-login-SETUP.md](docs/social-accounts-login-SETUP.md) |
| The web PWA + monorepo plan | [docs/pwa-monorepo-plan.md](docs/pwa-monorepo-plan.md) |

## Deferred / open

- **Web login** — built on `feat/pwa-login`, not merged.
- **Sign in with Apple** — stubbed; needs paid Apple Developer enrollment (Guideline 4.8
  requires it before any TestFlight/App Store release).
- **Social features** — friends, shared lists, cloud logbook sync are planned, not built
  (logbook is local SwiftData only). Avatar upload deferred (`avatar_url` reserved).
- Dev/prod Supabase env split; PWA catalog/logbook + HTTPS hosting; app icon (placeholder).
- Hold→LED mapping not yet hardware-confirmed — LED Test is the tool to confirm/flip it.

## External references

- Firmware: https://github.com/FabianRig/ArduinoMoonBoardLED
- BLE-serial lib: https://github.com/FabianRig/ArduinoMultiUserHardwareBLESerial
