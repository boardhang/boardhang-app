# Boardhang

Boardhang is a free, unofficial web app for MoonBoards: browse around 12,000 problems,
keep your filters between visits, and light any problem on a DIY LED board over Web
Bluetooth. It runs in the browser — no install, no account — and is not affiliated with
Moon Climbing Ltd.

- **Use it:** [www.boardhang.app](https://www.boardhang.app)
- **Guides and project site:** [boardhang.app](https://boardhang.app)
- **Hardware:** DIY LED MoonBoards running the open-source
  [ArduinoMoonBoardLED](https://github.com/FabianRig/ArduinoMoonBoardLED) firmware. The
  firmware is treated as fixed — Boardhang speaks its Nordic-UART protocol correctly and
  does not modify it.

> **Contributing / picking this up?** Read [`CONTEXT.md`](CONTEXT.md) first — it's the
> orientation doc (repo map, build, gotchas, and links into [`docs/`](docs/README.md)). This
> README is just the user-facing run guide. Bug reports and feature ideas are welcome as
> [issues](https://github.com/boardhang/boardhang-app/issues); pull requests too.

## What it does

- **Browse a curated catalog** — around 12,000 MoonBoard problems, including 2,832 official
  benchmarks, across five layouts (MoonBoard 2016, 2024, Masters 2017, Masters 2019 and
  Mini MoonBoard 2025), with search, grade filters and favorites.
- **Keep your filters** — sort and filter once; Boardhang remembers your setup per board, so
  every visit starts where you left off.
- **Light problems on the wall** — pick a problem and Boardhang sends it to the board over
  Web Bluetooth, with start, hand and finish holds each in their own color.
- **Session with friends** — sign in (free, optional) to see what everyone has sent or
  tried, find a problem to work on together, and always know what's lit on the wall.
- **Share problems as links** — every problem has a web address that opens in any browser.
- **Log your ascents** — a local logbook builds a grade pyramid from what you climb, with
  CSV/JSON export so the data stays yours.
- **Create your own problems** — tap holds on the board grid, with a live preview on the
  board as you tap.

Browsing works in any modern browser. Lighting the board needs Web Bluetooth: desktop
Chrome/Edge, Android Chrome, or iPhone via the Bluefy browser.

## Run the web app locally

```sh
cd web && npm install && npm run dev
```

[web/README.md](web/README.md) has the develop/build/test guide; the deploy runbook is in
[web/CLAUDE.md](web/CLAUDE.md).

## First-run checklist (with a board)

1. Power the Arduino. In the app, add your board and connect — the browser shows a device
   picker; choose the board.
2. Light a problem and check that the bottom-left hold (A1) lights where you expect. If the
   board lights mirrored, use the board's flip setting — it is wired from the other end.
3. Light a few more problems, log a send, and start a session with a friend.

## iOS app (on hold)

A native SwiftUI app lives in [`ios/`](ios/). It is not under active development — the web
app is the active client — but it still builds and runs on your own iPhone:

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

## Protocol notes

Message sent to the board: `l#<tokens>#`, tokens comma-separated `<type><led>`
(e.g. `l#S0,P14,E131#`). `S`=start, `P`=move, `E`=end. The number is the 0-based LED index
along the serpentine strip. Mapping lives in `BoardGeometry.ledIndex`. The critical
implementation detail (≤20-byte chunked writes) is covered in
[docs/ble-hardware.md](docs/ble-hardware.md).

## Layout & docs

See [`CONTEXT.md`](CONTEXT.md) for the repo map and [`docs/`](docs/README.md) for subsystem
deep dives.

## License

[MIT](LICENSE).
