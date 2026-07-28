---
title: A store that mutates inside getSnapshot must schedule a notify
date: 2026-07-28
category: docs/solutions/architecture-patterns
module: web sessions (cross-member ascent projection)
problem_type: architecture_pattern
component: frontend_react
severity: high
applies_when:
  - A module-singleton store is exposed through useSyncExternalStore
  - Its getSnapshot does more than return state — it expires, prunes, or lazily derives
  - More than one component subscribes to that store
tags:
  - reactive-store
  - usesyncexternalstore
  - notify
  - cache-expiry
  - stale-state
  - react
  - privacy
---

# A store that mutates inside getSnapshot must schedule a notify

## Context

`memberAscentsStore` caches a collaboration session's cross-member ascent projection and
enforces a 5-minute max-age on it. The age check ran in two places — a 30s timer, and
`getSnapshot`, so a stale map could never be read even if the timer had not fired:

```ts
function applyStaleness(): boolean {
  if (state.fetchedAt !== null && Date.now() - state.fetchedAt > MAX_AGE_MS) {
    state = { ready: false, bySets: {}, members: [], /* … */ fetchedAt: null }
    return true          // mutated — but nobody is told
  }
  return false
}

function getSnapshot() {
  applyStaleness()
  return state
}

// the timer, elsewhere:
staleTimer = setInterval(() => {
  if (applyStaleness()) notify()   // only notifies when IT wins the race
}, STALE_CHECK_MS)
```

Three components subscribed. The failure is an ordering one, and it is permanent rather than
transient:

1. Any one component re-renders for an unrelated reason and calls `getSnapshot`.
2. That call performs the drop. **That component** sees the new state, because it is mid-render.
3. No listener fires, so the other two subscribers are never told.
4. The next timer tick calls `applyStaleness()`, which now returns `false` — the drop already
   happened — so its `notify()` never runs either.

`useSyncExternalStore` caches a subscriber's snapshot and only re-reads it when notified, so a
component that does not happen to re-render for some other reason keeps rendering a map the
store no longer holds — indefinitely. Here that meant a departed session member's sends staying
on the catalog's "who sent this" pills, which is the exact exposure the max-age exists to bound.

## Guidance

If `getSnapshot` can change state, it must schedule a notification — and **schedule** is the
operative word, because `getSnapshot` runs during React's render phase and notifying
synchronously would set state mid-render:

```ts
function applyStalenessOnRead(): void {
  if (applyStaleness()) queueMicrotask(notify)
}

function getSnapshot(): MemberAscentsState {
  applyStalenessOnRead()
  return state
}
```

Two properties make this safe rather than a re-render loop:

- **The mutation is idempotent.** A dropped map has `fetchedAt === null`, so the second call is
  a no-op and returns `false`. Exactly one microtask is scheduled per transition, no matter how
  many subscribers read.
- **The post-mutation snapshot is reference-stable.** `getSnapshot` must return the same object
  on every call until something really changes, or `useSyncExternalStore` loops.

Lose either property and the scheduled notify becomes a cascade: notify → render → getSnapshot
→ mutate → notify.

## Why This Matters

The bug is invisible to the obvious test. An imperative assertion —
`expect(getMemberAscentsSnapshot().stale).toBe(true)` — **passes**, because that helper runs the
age check itself. Only a mounted subscriber that did *not* trigger the drop can observe the
staleness, so catching it requires React:

```tsx
const { result } = renderHook(() => useMemberAscents('S1'))
await vi.advanceTimersByTimeAsync(0)

vi.setSystemTime(new Date(Date.now() + MAX_AGE_MS + 1_000))
getMemberAscentsSnapshot()          // a DIFFERENT reader performs the drop

await vi.advanceTimersByTimeAsync(0) // let the microtask flush
expect(result.current.ready).toBe(false)   // fails without the scheduled notify
```

The severity comes from what the mutation was *for*. A lazily-derived value going stale is a
correctness annoyance; an **expiry** going unannounced silently defeats the control it
implements. When the mutation inside `getSnapshot` enforces a privacy or security bound, a
missing notify converts "the data is purged" into "the data is purged for whoever happened to
render first."

## When to Apply

Audit any `useSyncExternalStore`-backed module store whose `getSnapshot` is not a bare
`return state`. The tell is a read path that expires, prunes, evicts, or lazily computes.

The dual test: **can two components disagree about this store's contents?** If the only writer
is an explicit action that calls `notify()`, no. If a *read* can write, yes — and the component
that reads first is the only one that finds out.

Not a concern for a store whose `getSnapshot` only returns state, or for a single-subscriber
store (though that is a property of today's call sites, not of the store — it stops being true
the moment someone adds a second consumer).

## Related

- Files: `web/src/sessions/memberAscentsStore.ts` (`applyStalenessOnRead`),
  `web/src/sessions/memberAscentsSubscribers.test.tsx` (the subscriber-level regression test)
- Sibling stores, audited 2026-07-28: `sessionsStore.ts`, `queueStore.ts` and `listsStore.ts`
  are all a bare `return state` — the rule does not bite them. `pinnedFiltersStore.ts` is the
  instructive near-miss: its `snapshot(layoutId)` *does* write on the read path, populating a
  memo `Map` on a miss. It is safe, and for a reason worth internalising — the write is a pure
  memoization that cannot change the observable value, and it exists precisely to keep the
  returned reference stable across calls. Writing during a read is not the hazard; writing
  something a subscriber would need to be *told* about is.
- Contrast: [`snapshot-reactive-store-array-when-opening-a-view.md`](./snapshot-reactive-store-array-when-opening-a-view.md)
  is the mirror image — there a *view* writes back into the store it reads, and the fix is to
  stop reading live. Here the *store itself* writes during a read, and the fix is to make that
  write reach everyone.
- Subsystem doc: [`docs/collaboration-sessions.md`](../../collaboration-sessions.md) (R16, the
  max-age bound this defends)
