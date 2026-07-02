# MoonBoard LED — MVP

A minimal native iOS app to create boulder problems and light them on a DIY
MoonBoard LED system (Mini MoonBoard 2025) running the
[ArduinoMoonBoardLED](https://github.com/FabianRig/ArduinoMoonBoardLED) firmware.

Built to replace the official MoonBoard app for controlling the LEDs, which broke
after a recent update. The Arduino firmware is unchanged — this app just speaks its
Nordic-UART protocol correctly.

## Features (MVP)

- Create problems by tapping holds on the 11×12 Mini 2025 grid; each tap cycles
  off → start (green) → move (blue) → end (red).
- Name + Font grade; saved locally (SwiftData).
- Connect to the board over BLE; **live preview** lights holds as you tap them.
- "Light up on board" / "Clear board" from any saved problem.
- **LED Test / Calibration** screen to verify the hold→LED mapping against your
  physical wiring (and a flip toggle if it's wired from the other end).

## Run it on your iPhone

1. Open `MoonBoardLED.xcodeproj` in Xcode.
2. Select the **MoonBoardLED** scheme and your iPhone as the run destination.
3. In **Signing & Capabilities**, pick your personal Apple ID team (free account
   works). Xcode auto-generates a provisioning profile.
   - Bundle ID is `com.bertil.MoonBoardLED` — change it if Xcode reports a conflict.
4. Press ⌘R. Free-account signing expires after 7 days; just re-run from Xcode.

> A free Apple ID can run the app on your own device. No App Store needed.

## First-run checklist

1. Power the Arduino. In the app, tap the connection status (top-left) → **Scan** →
   tap your board to connect.
2. Open the menu (＋) → **LED Test / Calibration**. Step to LED 0 and confirm the
   bottom-left hold (A1) lights. Step a couple more to confirm direction; toggle
   "flip" if your board is wired from the opposite end.
3. Create a problem, watch the live preview, save, and light it from the list.

## Protocol notes

Message sent to the board: `l#<tokens>#`, tokens comma-separated `<type><led>`
(e.g. `l#S0,P14,E131#`). `S`=start, `P`=move, `E`=end. The number is the 0-based
LED index along the serpentine strip. Mapping lives in `BoardGeometry.ledIndex`.

## Project layout

```
ios/MoonBoardLED/
  MoonBoardApp.swift          app entry + SwiftData container
  Models/HoldType.swift       hold roles, tap cycle, HoldAssignment
  Models/Problem.swift        SwiftData model + Font grades
  Board/BoardGeometry.swift   11×12 serpentine LED mapping
  Board/BoardGridView.swift   reusable tappable grid
  BLE/MoonBoardBLEManager.swift   CoreBluetooth, NUS, message builder
  Views/                      list, edit, detail, connection, LED test
```
