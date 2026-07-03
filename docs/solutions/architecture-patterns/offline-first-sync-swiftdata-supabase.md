---
module: "Cloud logbook sync (iOS)"
date: 2026-07-03
problem_type: architecture_pattern
component: database
severity: high
applies_when:
  - "Syncing a local SwiftData (or Core Data) store to Supabase/Postgres, offline-first"
  - "Converging the same account's data across multiple devices"
  - "Choosing a conflict-resolution strategy for a single-user-per-account dataset"
related_components:
  - authentication
tags:
  - offline-first
  - sync
  - last-write-wins
  - tombstones
  - swiftdata
  - supabase
  - postgrest
  - conflict-resolution
---

# Offline-first sync between SwiftData and Supabase

## Context

An iOS app with a local-only SwiftData logbook needed to sync per-user data (ascents +
user-created problems) to Supabase so it converges across a user's devices — offline-first,
cloud as the convergent source of truth, signed-out users completely unaffected. The design
was straightforward on paper; the value of this note is the **handful of specific traps that
broke sync in ways a compile and a signed-out smoke test do not catch**, found only in
adversarial review. Delivered on branch `feat/cloud-logbook-sync` (PR #8).

Key files: `ios/MoonBoardLED/Services/Supabase/LogbookSyncManager.swift`,
`LogbookDTO.swift`, `AscentSyncID.swift`, `supabase/migrations/0002_logbook_sync.sql`.

## Guidance

**The sync spine that worked: server-authoritative `updated_at` high-water mark.**
Every synced row carries an `updated_at` stamped by Postgres (a `before insert or update`
trigger) and a `deleted` tombstone flag. Each device stores a per-table cursor and pulls
`WHERE updated_at > cursor`, pushes its own dirty rows, and resolves conflicts by uniform
last-write-wins on `updated_at`. Deletes are tombstones kept **forever** (never GC'd) so a
long-offline device loses to the tombstone instead of resurrecting the row. Cadence is
push-on-write + pull-on-foreground — no background daemon, no realtime.

**Five decisions worth reusing:**

1. **LWW is fine for single-user-per-account data.** "Last write" means last to reach the
   server, not last human action; for a personal dataset where the same row is virtually
   never edited on two devices at once, that anomaly is acceptable and vastly simpler than
   CRDTs or vector clocks.
2. **Deterministic ids for mergeable aggregate rows.** A same-day "attempt counter" row is a
   mutable aggregate, not an immutable event — two devices would each create one. Deriving its
   primary key deterministically (UUIDv5 over a natural key) makes both devices name the row
   identically, so it structurally converges to one row with no post-hoc reconciliation.
   Immutable events (individual sends) keep random UUIDs.
3. **Sign-in collision → binary "which side wins" modal, no merge.** Fires only when both the
   device and the cloud already hold data; otherwise seed silently. Trades the ability to union
   two partial histories for a hard guarantee of no duplicates — the right trade when the merge
   key isn't reliable.
4. **Reversibility-based lifecycle asymmetry.** Sign-out *clears* the local cache (the cloud
   re-downloads it); delete-account *keeps* it (no cloud copy survives to restore from). The
   rule that unifies them: clear the local cache only when a cloud copy survives.
5. **Tag the local cache with an owner user-id.** Guards the cross-account leak below.

## Why This Matters

Two of these traps made sync **silently not work at all** while the app compiled cleanly and
launched fine signed-out. Neither is reachable without a real Postgres backend and a second
device, so they survive every check short of adversarial review + on-backend testing. Budget
for that testing explicitly; "it builds and launches" is not evidence a sync engine works.

## When to Apply

Any offline-first sync between a local object store and a PostgREST/Supabase backend,
especially with multi-device convergence and mergeable counter-like rows. The specific
gotchas apply to **any Swift code decoding Postgres timestamps** and **any deterministic-key
scheme layered over a partial unique index**.

## Examples — the traps (each is the reusable payload)

### Trap 1: Postgres microsecond timestamps break `ISO8601DateFormatter(.withFractionalSeconds)`

Postgres `timestamptz` serializes with up to **6** fractional digits (`...30.123456+00:00`).
`ISO8601DateFormatter` with `.withFractionalSeconds` accepts **only 3** and returns `nil` for
anything else. Effect: every server `updated_at` parsed to `nil` → the pull cursor never
advanced (re-pulled the whole table forever) and `incoming ?? .distantPast` meant remote rows
**never won LWW and never applied**. Sync was dead on arrival, silently.

```swift
// BROKEN — nil for 6-digit fractions (i.e. most real server values)
let f = ISO8601DateFormatter()
f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
return f.date(from: serverString)   // nil for "2026-07-03T10:20:30.123456+00:00"

// FIXED — normalize the fractional group to exactly 3 digits, then parse
// (pad or truncate the run of digits after the dot before handing to the formatter)
```

Test with a real 6-digit `+00:00` PostgREST value, not a hand-written 3-digit one.

### Trap 2: folding user-id into a natural-key-derived deterministic id wedges the upsert batch

The deterministic attempt id (Trap-2 sibling of decision #2) originally folded the user-id
into the hash, with a `"local"` sentinel when signed out. So the *same* problem/day produced a
**different** id across the signed-out→signed-in boundary — two ids competing for one slot in
the server's partial unique index `(user_id, problem, utc_day) WHERE sent = false`. The upsert
conflict target is the primary key, which doesn't cover that constraint, so the whole INSERT
aborted with `23505`, the error was swallowed, rows stayed dirty, and **all ascent sync got
permanently stuck**.

Fix: make the deterministic key **user-independent** — the row is already user-scoped by the
`user_id` column, RLS, and the index, so the id only needs to be stable per (problem, day).
General rule: **a client-computed key must agree with the server's uniqueness constraint on
every field, or an upsert on a different key silently dead-letters the batch.**

### Trap 3 (design risk, not a bug): cross-account cache leak on implicit sign-out

Wiring cache-clear only to the explicit "Sign out" button misses implicit sign-outs (token
expiry). User A's cache then lingers; if user B signs in, the sync engine pushes A's rows up
under B's `user_id` (RLS can't stop it — the rows *are* written as B). Fix: tag the local cache
with an owner user-id and, on sign-in, wipe a foreign owner's cache before syncing; gate the
sync entry points on cache ownership + a per-user "reconciled" flag so a launch-race can't push
the wrong user's data.

### Prevention checklist

- Decode DB timestamps with a parser tolerant of 0–6 fractional digits; unit-test with a real
  server value.
- Any client-computed deterministic/natural key must match the server's unique constraint on
  **every** field; test the signed-out→signed-in and two-device paths, not just one device.
- Bind cache-clear to the auth-state *transition*, not a UI button; tag cached data with its
  owner so it can never be attributed to a different account.
- Adding a non-optional stored property (e.g. `Problem.id: UUID`) to an existing SwiftData
  `@Model` with **no migration plan** is the riskiest change — lightweight migration may assign
  a shared default. Treat an on-device launch over a *populated* store as a hard release gate,
  and keep a runtime backfill that repairs duplicate ids as a safety net.
- A sync engine that "builds and launches signed-out" is unverified. The real gates need the
  live backend + a second device.
