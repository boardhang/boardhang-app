// Per-slab "new benchmarks since I last looked" store. Reads the public benchmark_events
// table (rows the server-side trigger writes on every catalog rising edge, see
// supabase/migrations/0018_benchmark_notifications.sql / plan KTD1) and diffs against a
// device-local watermark to surface unseen problems on the catalog banner and the Boards-page
// dot. Everything but the fetch is synchronous, cache-backed, and useSyncExternalStore-driven —
// mirrors recentsStore.ts.
//
// Design points from the plan:
//   • Watermark defaults to now-on-first-touch so a fresh device / first-ever slab sync doesn't
//     present pre-existing benchmarks as new (R4).
//   • Query filters `discarded_at is null`, so an operator `--discard` retracts the banner and
//     dot along with the push (KTD1); `notified_at` is IGNORED by the client so banners survive
//     the drain and don't require the sender to have run.
//   • Fetch is best-effort and per-added-board: null supabase client, offline, or a
//     server-side failure degrades to "no unseen" — the Boards page stays fully-offline usable.
//   • Advancing the watermark to `now()` also drops the in-memory cache so the banner and dot
//     clear in the same frame.

import { useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'

/** One unseen benchmark event on a slab. */
export interface BenchmarkEvent {
  /** Catalog problem the event points at — the id the deep link resolves against. */
  sourceCatalogId: string
  /** ISO timestamp the event was captured at (server clock). */
  createdAt: string
}

/** Snapshot for a single slab. Empty ids = no dot, no banner. */
export interface BenchmarkNewsSnapshot {
  /** Ids of unseen events on this slab, most-recent first. */
  ids: string[]
  /** Timestamps aligned with `ids`; index [0] is the freshest event. */
  createdAt: string[]
}

const EMPTY_SNAPSHOT: BenchmarkNewsSnapshot = Object.freeze({
  ids: [] as string[],
  createdAt: [] as string[],
}) as BenchmarkNewsSnapshot

const watermarkKey = (layoutId: number, angle: number) => `benchmarkSeen_${layoutId}_${angle}`
const slabKey = (layoutId: number, angle: number) => `${layoutId}_${angle}`

// Guard against the trigger's rare clock skew where a captured event's created_at can be
// microseconds ahead of the row's insert time. Not doing this is not disastrous (worst case
// the watermark bumps to a value that swallows an in-flight event on this device), but adding
// a fixed offset when a slab first touches makes "fresh device shows nothing" deterministic.
const WATERMARK_STARTUP_OFFSET_MS = 1_000

// ─── localStorage (best-effort — matches boardStore's Bluefy/quota guards) ────
function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Best-effort; degrades to a re-derived default next read.
  }
}

/** The watermark for this slab, or null when we've never touched it (first-touch case). */
export function getWatermark(layoutId: number, angle: number): string | null {
  const raw = readLS(watermarkKey(layoutId, angle))
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null
}

/** Get the watermark, seeding to now() the first time this slab is touched so pre-existing
 *  benchmarks never present as new on a fresh device (R4). */
function ensureWatermark(layoutId: number, angle: number): string {
  const existing = getWatermark(layoutId, angle)
  if (existing) return existing
  const seeded = new Date(Date.now() + WATERMARK_STARTUP_OFFSET_MS).toISOString()
  writeLS(watermarkKey(layoutId, angle), seeded)
  return seeded
}

/** Advance the watermark to now(); clears the slab's cached snapshot so the banner + dot drop
 *  in the same frame. Called on view, dismiss, and the R3 "silent advance" path.
 *
 *  Bumps the slab's generation counter FIRST so any in-flight `refreshBenchmarkNews` for this
 *  slab (kicked off by the same effect that renders the banner) is treated as stale on arrival
 *  and does not re-populate the cache with the pre-clear result set (finding #1 — dismiss race
 *  where a slow fetch resurrects a just-cleared banner within 1-2s of the tap). */
export function markSeen(layoutId: number, angle: number): void {
  bumpSlabGeneration(layoutId, angle)
  writeLS(watermarkKey(layoutId, angle), new Date().toISOString())
  cache.delete(slabKey(layoutId, angle))
  emit()
}

// ─── Reactive layer (mirrors recentsStore.ts) ─────────────────────────────────
const listeners = new Set<() => void>()
const cache = new Map<string, BenchmarkNewsSnapshot>()
// Monotonic version bumped on every mutation. useSyncExternalStore's getSnapshot must return a
// referentially-stable value between mutations — a number is; a freshly-built Map is not (a
// naive Map return causes an infinite render loop). Callers that need derived data (like the
// per-slab count map on the Boards page) subscribe on this and useMemo their own derivation.
let version = 0

// Per-slab generation counter. `markSeen` (and any future mutation that should invalidate an
// in-flight fetch on ONE slab) bumps the slab's entry; `refreshBenchmarkNews` snapshots the
// value at fetch start and drops the result on resolution if the counter advanced. Semantically
// this is the KTD7 `cacheGeneration` pattern from `web/src/lists/listsSync.ts`, sliced per slab
// because per-slab mutations are per slab too.
const slabGeneration = new Map<string, number>()

// Global identity generation counter. `clearBenchmarkNewsCache` (called by
// `syncBenchmarkNewsIdentity` on user change) bumps this — a fetch that captured the previous
// value is dropped on resolution regardless of per-slab generation. Distinct axis from
// slabGeneration because an identity switch invalidates every slab, including ones that were
// never touched by markSeen (so slabGeneration has no entry for them).
let identityGeneration = 0

function bumpSlabGeneration(layoutId: number, angle: number): void {
  const k = slabKey(layoutId, angle)
  slabGeneration.set(k, (slabGeneration.get(k) ?? 0) + 1)
}

function currentSlabGeneration(layoutId: number, angle: number): number {
  return slabGeneration.get(slabKey(layoutId, angle)) ?? 0
}

function emit(): void {
  version++
  for (const l of listeners) l()
}

function snapshotFor(layoutId: number, angle: number): BenchmarkNewsSnapshot {
  return cache.get(slabKey(layoutId, angle)) ?? EMPTY_SNAPSHOT
}

/** Load the unseen events for `slabs` from the server and cache them. Best-effort: an offline
 *  client, an unconfigured build, or a network/PostgREST error resolves to an empty snapshot
 *  for each slab rather than throwing (Boards page must stay usable offline). */
export async function refreshBenchmarkNews(slabs: Array<{ layoutId: number; angle: number }>): Promise<void> {
  if (!supabase || slabs.length === 0) return
  // Snapshot the per-slab generation counter alongside the watermark BEFORE issuing the fetch —
  // if markSeen (or any future mutation that bumps the generation) fires while this fetch is in
  // flight, we detect the drift on resolution and discard that slab's result rather than
  // repopulating the cache with the pre-clear rows (finding #1).
  const bounds = slabs.map((s) => ({
    ...s,
    watermark: ensureWatermark(s.layoutId, s.angle),
    gen: currentSlabGeneration(s.layoutId, s.angle),
    identityGen: identityGeneration,
  }))

  // One request per slab keeps the OR filter simple and lets a single failure degrade only
  // that slab. The volumes are small (a handful of added boards × a handful of unseen events).
  const outcomes = await Promise.all(
    bounds.map(async ({ layoutId, angle, watermark, gen, identityGen }) => {
      try {
        const { data, error } = await supabase!
          .from('benchmark_events')
          .select('source_catalog_id, created_at')
          .eq('layout_id', layoutId)
          .eq('angle', angle)
          .is('discarded_at', null)
          .gt('created_at', watermark)
          .order('created_at', { ascending: false })
          .limit(500)
        if (error) return { layoutId, angle, gen, identityGen, snapshot: EMPTY_SNAPSHOT }
        const ids: string[] = []
        const createdAt: string[] = []
        for (const row of data ?? []) {
          const rowRec = row as { source_catalog_id?: unknown; created_at?: unknown }
          if (typeof rowRec.source_catalog_id === 'string' && typeof rowRec.created_at === 'string') {
            ids.push(rowRec.source_catalog_id)
            createdAt.push(rowRec.created_at)
          }
        }
        return {
          layoutId, angle, gen, identityGen,
          snapshot: ids.length === 0 ? EMPTY_SNAPSHOT : { ids, createdAt },
        }
      } catch {
        return { layoutId, angle, gen, identityGen, snapshot: EMPTY_SNAPSHOT }
      }
    }),
  )
  let anyLanded = false
  for (const { layoutId, angle, gen, identityGen, snapshot } of outcomes) {
    // Discard the slab's result if either the per-slab generation advanced (markSeen while
    // in flight — finding #1) OR the identity generation advanced (user switch / sign-out
    // via syncBenchmarkNewsIdentity — finding #7). The identity guard is what saves fresh
    // slabs that had no slabGeneration entry when the fetch started.
    if (identityGen !== identityGeneration) continue
    if (currentSlabGeneration(layoutId, angle) !== gen) continue
    cache.set(slabKey(layoutId, angle), snapshot)
    anyLanded = true
  }
  // Only bump the reactive version when at least one slab's result actually landed, so a
  // fully-invalidated fetch (every result discarded) doesn't spuriously re-run derivations
  // that would just re-read the cache values markSeen already set.
  if (anyLanded) emit()
}

/** The events matching a caller-supplied filter (typically climbable + hold-set installed).
 *  Callers usually want the *count* — that's the number to show in "N new benchmarks". Returned
 *  order matches the cached fresh-first order. */
export function filterNewsIds(
  layoutId: number,
  angle: number,
  keep: (sourceCatalogId: string) => boolean,
): string[] {
  const snap = snapshotFor(layoutId, angle)
  return snap.ids.filter(keep)
}

/** Reactive snapshot for a slab; empty when unseen count is zero, unconfigured, or offline. */
export function useBenchmarkNews(layoutId: number, angle: number): BenchmarkNewsSnapshot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snapshotFor(layoutId, angle),
  )
}

/** A version number that increments whenever any slab's unseen-events cache mutates (fetch
 *  result landed, watermark advanced). Callers useMemo their derived data on `[version, …]`
 *  so a Map / array they build stays referentially stable across renders. */
export function useBenchmarkNewsVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}

/** Non-reactive: how many unseen events a slab currently has (0 when uncached or empty). Used
 *  inside `useMemo` on the reactive version to derive the Boards-page dot set. */
export function unseenCount(layoutId: number, angle: number): number {
  return snapshotFor(layoutId, angle).ids.length
}

/** Result of a `?newSince=<iso>` fetch: `ids` is the set of problems promoted after `since` on
 *  the given slab. `error` distinguishes "the server said no rows" from "we couldn't reach the
 *  server" so the deep-link view can decide between "nothing new here anymore" and "still trying".
 */
export interface NewSinceFetch {
  ids: string[]
  error: boolean
}

/** Fetch event ids on `(layoutId, angle)` with `created_at > since and discarded_at is null` —
 *  the exact set the `?newSince=<since>` catalog view renders. Independent of the watermark: a
 *  device that hasn't seen these events yet and one that has both resolve the same set. */
export async function fetchEventIdsSince(
  layoutId: number,
  angle: number,
  since: string,
): Promise<NewSinceFetch> {
  if (!supabase) return { ids: [], error: true }
  try {
    const { data, error } = await supabase
      .from('benchmark_events')
      .select('source_catalog_id')
      .eq('layout_id', layoutId)
      .eq('angle', angle)
      .is('discarded_at', null)
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) return { ids: [], error: true }
    const ids: string[] = []
    for (const row of data ?? []) {
      const rec = row as { source_catalog_id?: unknown }
      if (typeof rec.source_catalog_id === 'string') ids.push(rec.source_catalog_id)
    }
    return { ids, error: false }
  } catch {
    return { ids: [], error: true }
  }
}

// ─── Identity lifecycle (mirrors syncSessionsIdentity, docs/solutions/offline-first-sync Trap 3) ──

const LAST_USER_KEY = 'benchmarkNewsLastUser'

/** Best-effort scrub of every `benchmarkSeen_*` watermark from localStorage. Called by
 *  `syncBenchmarkNewsIdentity` on identity change so a shared device never lets user B
 *  inherit user A's dismissal state (finding #7). */
function clearWatermarksLocalStorage(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('benchmarkSeen_')) doomed.push(k)
    }
    for (const k of doomed) {
      try {
        localStorage.removeItem(k)
      } catch {
        /* ignore per-key failure */
      }
    }
  } catch {
    /* localStorage completely unavailable — nothing to clear */
  }
}

/** Clear the in-memory cache + persisted watermarks + bump every slab's generation. Called
 *  from `syncBenchmarkNewsIdentity` when the signed-in identity changes. Same shape as
 *  `clearSessionsCache` in sessionsStore.ts. */
export function clearBenchmarkNewsCache(): void {
  // Bump the global identity generation FIRST so any in-flight fetch from before the identity
  // change is dropped on resolution rather than repopulating user A's snapshot into user B's
  // session — this single bump invalidates every in-flight fetch across every slab, including
  // ones that had no per-slab generation entry when the fetch started (a fresh Boards-page
  // mount is the common case).
  identityGeneration += 1
  cache.clear()
  clearWatermarksLocalStorage()
  emit()
}

/**
 * Reconcile with the signed-in identity, called from `AuthProvider.resolveSession` beside
 * `syncSessionsIdentity` / `syncListsIdentity`. Clears the store + watermarks whenever the
 * user id changes (sign-out or a different user) so on a shared device user B never inherits
 * user A's dismissal state. A same-user restore is a no-op — token refresh must not churn the
 * store (matches R9/AE4 semantics from the plan even though push isn't the concern here).
 *
 * Sync + localStorage-only, no Supabase calls — safe to await inside the auth callback
 * (no re-entrant Supabase call, no deadlock risk).
 */
export function syncBenchmarkNewsIdentity(userId: string | null): void {
  const next = userId ?? ''
  let prev: string | null = null
  try {
    prev = localStorage.getItem(LAST_USER_KEY)
  } catch {
    /* ignore */
  }
  if (prev === next) return
  clearBenchmarkNewsCache()
  try {
    localStorage.setItem(LAST_USER_KEY, next)
  } catch {
    /* ignore */
  }
}

// Test hook: reset all in-memory state so unit tests can start clean. Not exported from index.
export function __resetBenchmarkNewsForTests(): void {
  cache.clear()
  listeners.clear()
  slabGeneration.clear()
  identityGeneration = 0
  // Also reset the monotonic version counter so a test asserting on absolute version values
  // starts from zero — otherwise it accumulates across tests via the module singleton and a
  // future test subscribing on `useBenchmarkNewsVersion` sees non-zero initial state.
  version = 0
}
