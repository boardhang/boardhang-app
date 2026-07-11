# Boardhang

A native iOS app (with a companion Web Bluetooth PWA) to create boulder problems and light
them on a MoonBoard LED system running the
[ArduinoMoonBoardLED](https://github.com/FabianRig/ArduinoMoonBoardLED) firmware.

The Arduino firmware is treated as fixed — this app speaks its Nordic-UART protocol correctly
and does not modify the firmware.

> **Contributing / picking this up?** Read [`CONTEXT.md`](CONTEXT.md) first — it's the
> orientation doc (repo map, build, gotchas, and links into [`docs/`](docs/README.md)). This
> README is just the user-facing run guide.

## What it does

- Create problems by tapping holds on the board grid; each tap cycles
  off → start (green) → move (blue) → end (red).
- Name + Font grade; saved locally (SwiftData), with a logbook of your ascents.
- Browse bundled read-only **official-problem catalogs** for several MoonBoard setups
  (Mini 2025, 2016, 2024, Masters 2017/2019).
- Connect to the board over BLE; **live preview** lights holds as you tap them; "Light up" /
  "Clear board" from any problem.
- **LED Test / Calibration** screen to verify the hold→LED mapping against your physical
  wiring (with a flip toggle if it's wired from the other end).
- Optional **accounts** (email code or Google sign-in, `@handle` profile). Entirely optional —
  the app is fully usable signed-out.

## Run it on your iPhone

1. Open **`ios/MoonBoardLED.xcodeproj`** in Xcode.
2. Select the **MoonBoardLED** scheme and your iPhone as the run destination.
3. In **Signing & Capabilities**, pick your personal Apple ID team (a free account works).
   Xcode auto-generates a provisioning profile; change the bundle ID if Xcode reports a conflict.
4. Press ⌘R. Free-account signing expires after 7 days; just re-run from Xcode.

> A free Apple ID can run the app on your own device. No App Store needed. BLE does **not**
> work in the Simulator — you need a real device.

Accounts are off unless you configure Supabase — see
[docs/social-accounts-login-SETUP.md](docs/social-accounts-login-SETUP.md). Without it, the app
simply hides sign-in and runs offline.

## First-run checklist

1. Power the Arduino. In the app, tap the connection status → **Scan** → tap your board to connect.
2. Open **LED Test / Calibration**. Step to LED 0 and confirm the bottom-left hold (A1) lights.
   Step a couple more to confirm direction; toggle "flip" if your board is wired from the other end.
3. Create a problem, watch the live preview, save, and light it from the list.

## Protocol notes

Message sent to the board: `l#<tokens>#`, tokens comma-separated `<type><led>`
(e.g. `l#S0,P14,E131#`). `S`=start, `P`=move, `E`=end. The number is the 0-based LED index
along the serpentine strip. Mapping lives in `BoardGeometry.ledIndex`. The critical
implementation detail (≤20-byte chunked writes) is covered in
[docs/ble-hardware.md](docs/ble-hardware.md).

## Web app

A companion Web Bluetooth PWA lives in [`web/`](web/) (`cd web && npm run dev`). It's a partial
port — connect, build a problem, light/clear. Web Bluetooth requires desktop Chrome/Edge,
Android Chrome, or iPhone via Bluefy. See [web/README.md](web/README.md).

## Layout & docs

See [`CONTEXT.md`](CONTEXT.md) for the repo map and [`docs/`](docs/README.md) for subsystem
deep dives.
