---
title: Snapshot eviction over tombstone streams for small shared datasets
date: 2026-07-28
category: docs/solutions/architecture-patterns
module: "User-authored problems (web) — public sharing"
problem_type: architecture_pattern
component: database
severity: high
applies_when:
  - "Syncing a small, bounded set of rows that other users can publish and retract"
  - "A cached row can disappear for several unrelated reasons (retraction, delete, account deletion) and you're reaching for a tombstone stream"
  - "Relaxing RLS so one user's rows become readable by another for the first time"
related_components:
  - authentication
tags:
  - sync
  - snapshot
  - eviction
  - tombstones
  - offline-first
  - rls
  - supabase
  - postgres
  - rate-limiting
---

# Snapshot eviction over tombstone streams for small shared datasets

## Context

Web problem authoring (branch `fix/web-add-problems`, migrations `0018`/`0019`) let a signed-in
user draw a problem and optionally **publish** it so other users browsing the same board see it.
That created the app's first cross-user read path, and with it a cache-invalidation question the
existing sync spine could not answer.

The established pattern in this repo — and the one documented in
[offline-first-sync-swiftdata-supabase.md](offline-first-sync-swiftdata-supabase.md) — is an
`updated_at` high-water cursor plus permanent `deleted` tombstones. It works because those rows are
**owner-scoped**: you can always read your own tombstone. A public row is different. The moment a
setter retracts it (`visibility` back to `private`) or their account is deleted, the reader loses
read access to the row *and to any tombstone it might carry* — the retraction is exactly the event
that makes the evidence of the retraction unreadable. A cursor-and-tombstone design would leave
every other client caching a problem that is no longer public, forever.

Key files: `web/src/catalog/userProblemsSync.ts`, `web/src/catalog/userProblemsStore.ts`,
`supabase/migrations/0019_user_problems_public.sql`.

## Guidance

**When the shared set is bounded, sync it as a full snapshot and treat absence as retraction.**
Pull every live public row for one board+angle, upsert what the list contains, then delete the
cached rows the list no longer mentions. That one rule covers retraction, deletion, account
deletion and re-publishing with no tombstone plumbing, no per-event handling and no server-side
retention policy — and it is self-healing, because every pull re-derives the truth from scratch
rather than replaying a history the client might have missed part of.

The bound is what makes it affordable, and it should be a *structural* bound, not a hope: here a
per-user cap of 50 live public rows times the setters active on one board, per slab. If the set can
grow without limit, this pattern stops being viable and you are back to a cursor.

Four rules that are not optional once you adopt it:

1. **Order snapshot pages by an immutable key, not `updated_at`.** A snapshot spans several
   round-trips. Under an `updated_at` ordering, a row edited between page 2 and page 5 slides to
   the end of the ordering and is skipped by every remaining window — it then reads as *absent*,
   and eviction-by-absence deletes a row that was merely being edited. Ordering by `id` means only
   genuine inserts and deletes shift the windows. Sorting a bounded set costs nothing.
2. **Never evict on a failed pull.** Absence is only meaningful in a snapshot that actually
   completed. A pull that dies halfway (offline, 5xx, quota) must leave the cache untouched, so a
   disconnected device keeps browsing what it has instead of reading its own network failure as
   "everything was retracted". Same for a mid-pull identity change: the snapshot was read under the
   previous session, so its evictions belong to that user, not this one.
3. **Fence out the rows the snapshot cannot speak for.** The caller's own rows arrive on the
   cursor-delta lane (with tombstones, because you can read your own). They must never be applied
   or evicted by the snapshot: a *private* row is absent from a public snapshot by definition, so
   eviction-by-absence would delete the author's own unpublished work — and there is no server copy
   of a private row to re-pull. Fence on the live session **and** on the cached identity, because a
   sign-out whose cache clear failed can still hold the previous user's rows.
4. **Filter the snapshot query explicitly; don't let RLS define it.** A permissive public-read
   policy ORs with the owner policy, so an unfiltered `select` hands the caller their own private
   rows and tombstones as part of the "public" snapshot — and every own row missing from it then
   reads as a retraction. Say `visibility = 'public' and deleted = false` in the query.

**Open a cross-user read path only together with the guards that must hold the instant it opens.**
`0019` ships the read policy as the *last* of five statements, after: server-stamped attribution, a
completeness `CHECK`, and a per-user cap. Three lessons from getting there:

- **Attribution has to be server-owned, not client-supplied.** A `BEFORE INSERT OR UPDATE`
  `SECURITY DEFINER` trigger stamps the setter id and a denormalized handle from the caller's own
  profile, and clears both when the row goes private or is tombstoned. Overwrite rather than a
  `WITH CHECK` pin (a forged setter is corrected, not rejected), so **no shape of client write can
  leave a false attribution on a readable row**. Denormalize the handle if anon users can read the
  row but not the profile table, and re-stamp it on rename — otherwise a freed handle claimed by
  someone else silently re-credits the work to a different person.
- **Retract-then-constrain the rows that predate the guards.** The previous migration accepted
  `'public'` as a *value* while granting it no reader, so rows could already carry the intent
  without ever passing a completeness or attribution check. Flip those back to private *before*
  adding the constraint and the policy; otherwise the migration silently publishes rows nothing
  ever validated. Make the sweep re-runnable by keying it on a column the guards then guarantee
  (here: `setter_user_id is null`).
- **An INSERT-only cap is bypassable when publishing is an UPDATE.** The repo's earlier per-user
  cap fires on INSERT, which is right when creation *is* the rate-limited act. Here the act is
  private→public, so the trigger has to fire on INSERT **or** UPDATE — an INSERT-only version is
  defeated by bulk-flipping existing rows. Take a per-user transaction advisory lock inside it:
  under `READ COMMITTED` two concurrent flips each count the same pre-commit total and both pass.
  Exclude the row's own id from the count, or re-saving an already-published row starts failing the
  moment its author reaches the cap.

## Why This Matters

Reaching for tombstones here would have produced a design that *appears* to work in every
single-user test and leaks permanently in production: a retracted problem staying visible on every
other device, with no mechanism that could ever remove it. The failure is invisible from the
authoring side — the setter sees their row go private — so it would have been found by a user
report, not by testing.

The snapshot rules are equally sharp. Ordering by `updated_at` is the natural first instinct
(every other pull in this codebase does it) and it silently deletes rows that were merely edited
mid-pull. Evicting after a partial pull turns one flaky request into a wiped cache. Both are the
kind of bug that only shows up under real network conditions with real concurrent editors.

## When to Apply

**Use it when** the shared set is small and structurally bounded, and rows can leave the set for
reasons that also revoke your read access to the evidence. **Don't** use it for the unbounded case
(the ~12k-row official catalog stays on cursor + tombstones — a full snapshot per open would be
absurd), or where you own every row and can therefore always read its tombstone.

The RLS half applies to any migration that first makes one user's rows readable by another,
whatever the sync shape.

## Examples

The reconcile, reduced to its shape:

```ts
const listed = new Set<string>()
await eachPublicPage(client, layoutId, angle, async (page) => {
  for (const row of page) listed.add(row.source_catalog_id)   // own rows count as listed…
  const others = page.filter((row) => row.user_id !== ownUserId)  // …but are never written
  if (others.length > 0) await cache(others)
})
// Only after every page succeeded:
const absent = cached.filter((p) => p.userId !== ownUserId && !listed.has(p.sourceCatalogId))
if (absent.length > 0) await evict(absent)
```

Note the split: own rows are added to `listed` (so nothing can evict them) but excluded from the
write (the delta lane owns them — a snapshot page fetched moments before an optimistic delete would
otherwise resurrect a problem its author just removed).

The cap trigger's two non-obvious clauses:

```sql
perform pg_advisory_xact_lock(public.user_problem_public_cap_lock_key(new.user_id));
select count(*) into _live from public.user_problems
 where user_id = new.user_id and visibility = 'public' and not deleted
   and id <> new.id;                     -- re-saving a published row must not count itself
...
create trigger user_problems_public_cap
    before insert or update on public.user_problems   -- not insert-only: publishing is an UPDATE
    for each row when (new.visibility = 'public' and new.deleted = false)
    execute function public.enforce_user_problem_public_cap();
```

## Related

- [offline-first-sync-swiftdata-supabase.md](offline-first-sync-swiftdata-supabase.md) — the
  cursor + tombstone spine this pattern deliberately does *not* use for shared rows, and still uses
  for own rows.
- [../developer-experience/testing-supabase-rls-rpc-migrations-locally.md](../developer-experience/testing-supabase-rls-rpc-migrations-locally.md)
  — how `0019`'s policy, trigger and cap were proven before the migration was applied.
- `docs/catalog-data-pipeline.md` — the two lanes in context, plus the takedown runbook that relies
  on eviction-by-absence to reach every client.
