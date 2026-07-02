# MoonBoard LED — PWA

A Vite + React + TypeScript PWA that connects to a DIY MoonBoard LED controller
over **Web Bluetooth**, lets you build a problem on a tappable 11×12 grid, and
lights it up / clears it.

This is the web sibling of the native iOS app in `../ios`. The BLE protocol,
serpentine LED geometry, and hold data model are ported from the shared spec in
`../shared/spec` (separate TS reimplementation, no shared binary).

## Develop

```
npm install
npm run dev
```

Then open the printed URL in **desktop Chrome or Edge** over `localhost`.

- **Web Bluetooth requires a secure context** — `localhost` counts, so `npm run
  dev` works out of the box. Any other host needs HTTPS.
- Click **Connect** (the picker must be opened from a user gesture), pick your
  board, tap cells to cycle empty → start → move → end, then **Light up** /
  **Clear**.

## Browser support

Web Bluetooth does **not** work in Safari or any normal iOS browser. It works in:

- Desktop **Chrome / Edge**
- **Android Chrome**
- **iPhone: only inside a third-party BLE browser like Bluefy / WebBLE** — open
  the hosted site there. (Phone hosting / HTTPS deploy is out of scope for now.)

## Build

```
npm run build     # tsc + vite build, emits an installable PWA into dist/
npm run preview   # serve the production build
```
