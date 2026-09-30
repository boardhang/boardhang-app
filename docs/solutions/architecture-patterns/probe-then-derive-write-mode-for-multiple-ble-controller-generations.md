---
title: Probe services in order, then derive the write mode per link, to drive two BLE controller generations
date: 2026-09-30
category: docs/solutions/architecture-patterns
module: web BLE client (web/src/ble/moonboard.ts)
problem_type: architecture_pattern
component: frontend_ble
severity: high
applies_when:
  - A Web Bluetooth client must drive more than one hardware generation that speaks the same wire format over different GATT services
  - The write characteristic's properties are unknown, conflicting between sources, or absent on a shim (Bluefy)
  - A wrong unacknowledged write fails silently and a wrong acknowledged write fails loudly
  - The client severs links it opened itself (failed probe, timeout, race-guard bail)
tags:
  - web-bluetooth
  - ble
  - redbearlab
  - nordic-uart
  - write-with-response
  - reconnect-backoff
  - bluefy
  - safety-critical
---

# Probe services in order, then derive the write mode per link, to drive two BLE controller generations

## Context

The web client only knew the Nordic UART service: it filtered the chooser on that UUID,
resolved only that service after connect, and wrote only without response. The
first-generation official MoonBoard LED box uses a RedBearLab module with a different
service family (`713d0000` / write `713d0003`) and, per boardsesh's read of the official
app, wants acknowledged writes on iOS. The wire format, LED numbering, and 20-byte
chunking are identical. Plan:
`docs/plans/2026-09-30-001-feat-web-redbearlab-led-box-plan.md`; shipped in PR #165.

## The approach that worked

1. **One chooser request, three OR'd filters, both services optional.** Web Bluetooth
   grants service access by the union of `filters[].services` and `optionalServices`
   regardless of which filter matched, so a name-prefix match (`MoonBoard`) can still
   open either service. Keep the options object a frozen exported constant so tests
   assert the exact shape.
2. **Probe in order inside `establish()`, fall through on any rejection.** Nordic pair
   first (the common case; a missing service rejects fast), then RedBearLab. Fall
   through on *any* Nordic rejection, including the nameless numeric ones the Bluefy
   shim produces. Raise the readable "no known service" error only when both failures
   are `NotFoundError` or nameless; rethrow any other named error (`NetworkError`,
   `SecurityError`) as itself. Sever the link you opened when the probe fails.
3. **Reduced race guard before the second GATT call.** Check user-disconnect and device
   identity only. Do not check `gatt.connected`: Chrome clears it before a lookup
   rejects with `NetworkError`, so including it swallows a real link drop as a silent
   bail. The full guard (adding `gatt.connected === false`) still runs before the
   connected state is committed.
4. **Derive the write mode per link from controller + properties, biased to the loud
   failure.** Nordic keeps write-without-response (field-proven, including on the shim
   with no properties). RedBearLab writes with response whenever properties allow it or
   say nothing, without response only when properties rule acknowledged writes out.
   Absent or empty properties leave the link *unproven*.
5. **One-way flip, only after the same-mode retry.** On an unproven link a chunk gets the
   ordinary same-mode retry first; only a second acknowledged rejection triggers one
   retry without response. Whichever attempt succeeds locks the mode. Flipping on the
   first rejection would let a single transient error lock the silent mode for the
   whole connection.
6. **One link record on the client, captured at the top of the write loop.** Mutate mode
   or proven only while that record is still the client's current link, so a rejection
   from a stale characteristic after a fast reconnect cannot touch the new link. An
   interleaved send that loses the race to another send's flip follows the locked mode
   instead of throwing.
7. **Only a drop from `'connected'` restarts the reconnect backoff.** Chrome echoes the
   client's own `gatt.disconnect()` back as `gattserverdisconnected`. Resetting the
   counter on every echo made a retained box that connected but failed the probe
   reconnect every 500 ms forever (120 attempts per minute in the red test).

## What was tried and rejected

- **Always try write-without-response first.** A wrong unacknowledged write is silent at
  every layer; a locally successful write proves only that the browser accepted it.
- **Hardcode write-with-response for RedBearLab.** Fails if the box really refuses
  acknowledged writes (the RedBearLab Biscuit firmware declares write-without-response).
- **Flip on the first rejection.** Locks the silent mode on a transient error.
- **Gate the fallback probe on the error name.** Breaks the original box on Bluefy, which
  rejects with bare numbers.
- **Enumerate with `getPrimaryServices()` once.** Unknown support on the Bluefy shim; the
  two-lookup probe uses only calls the client already made.
- **A `selfTeardown` flag around the client's own `gatt.disconnect()`.** Covers only a
  synchronous echo; keying the backoff reset on the prior state covers sync and async.

## Testing pattern

The fake stack (`web/src/test/fakeBleStack.ts`) is options-driven: which services
resolve, how a missing lookup rejects, the characteristic's `properties` (or none), which
write methods exist, and whether `gatt.disconnect()` echoes an event synchronously or
asynchronously. Suites are split per concern (`moonboard.test.ts`,
`moonboard.discovery.test.ts`, `moonboard.writeMode.test.ts`). Chunk order and size are
pinned by decoding every mock call and comparing the concatenation to `buildMessage`.

## Status

Unit-tested against both possible property shapes; **unverified on a real
first-generation box** as of 2026-09-30. `docs/ble-hardware.md` has the capture
checklist; the working write mode goes there and in `shared/spec/ble-protocol.md`.
