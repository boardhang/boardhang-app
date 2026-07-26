// Multi-board state, persisted to localStorage with the same key scheme as the
// iOS app's @AppStorage (ios/MoonBoardLED/Board/Board.swift), so per-board angle,
// installed hold sets, and flip calibration stay traceable across apps.
//
// This module owns the RAW persisted values: added-instance list (MRU order), the
// active instance, per-instance angle / flipped / installed-hold-set string, and the
// mirrored canonical definition of each shared instance. The hold-set string is
// interpreted against membership data by holdSetMembership.ts — this module does not
// know which sets are filterable.
//
// State is keyed by *instance* id, not layout id (see boardInstance.ts). Pre-existing
// entries are bare layout ids and are read as local instances of that layout, so
// existing users migrate with no write at all — the read path just reinterprets the
// values already on disk.

import { useSyncExternalStore } from 'react'
import { boardByLayoutId, type CatalogBoardDef } from './boards'
import {
  canSetAngle,
  canSetHoldSets,
  layoutIdFromInstanceId,
  localInstanceId,
  parseSharedBoardMirror,
  resolveInstanceAngle,
  sharedInstanceId,
  type BoardInstance,
  type InstanceId,
  type SharedBoardMirror,
} from './boardInstance'

const ADDED_KEY = 'addedBoards'
const ACTIVE_KEY = 'activeBoardId'
const LAST_USER_KEY = 'boardsLastUser'
const angleKey = (id: InstanceId) => `angle_${id}`
const flippedKey = (id: InstanceId) => `flipped_${id}`
const activeHoldSetsKey = (id: InstanceId) => `activeHoldSets_${id}`
/**
 * Records an instance's layout when its id doesn't encode one. Only a *demoted* instance
 * needs this: it keeps its `S:` id (re-keying would collide with a sibling local instance
 * of the same layout) but no longer has a mirror to read the layout from. Its absence is
 * what still makes a mirror-less `S:` id an orphan, so a half-written adoption is dropped
 * while a deliberate demote survives.
 */
const layoutPinKey = (id: InstanceId) => `instanceLayout_${id}`

/**
 * Mirrors are namespaced by the account that adopted them. boardStore is device-wide,
 * which is harmless for purely local boards but not once an entry carries another
 * account's board, role, and definition: on a shared device the next person to sign in
 * would otherwise inherit it. Purely local instances stay device-wide as before.
 */
const mirrorKey = (id: InstanceId) => `sharedBoard_${accountNamespace()}_${id}`

/** Default active board when none is stored — the Mini 2025 this app centers on. */
const DEFAULT_ACTIVE = 7

// localStorage can throw (Safari private mode, quota, restricted embedders like
// Bluefy). Persistence is best-effort: a failed read/write degrades to a default
// rather than crashing a UI event handler.
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
    // Ignore — the value simply won't persist across reloads.
  }
}

function removeLS(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Ignore — same best-effort posture as writeLS.
  }
}

// ─── Account scoping ──────────────────────────────────────────────────────────

/** The account whose shared instances this device currently holds ('' = never signed in). */
function accountNamespace(): string {
  return readLS(LAST_USER_KEY) ?? ''
}

/**
 * React to an auth identity change, mirroring syncListsIdentity / syncSessionsIdentity.
 *
 * Signing **out** deliberately keeps everything: a member's adopted instance has to
 * survive sign-out (and the owner deleting their account) — after that the instance
 * genuinely is the member's own local board. Only a *different* account signing in
 * clears the previous account's shared instances, so a shared device never hands
 * user B user A's board. Purely local instances are never touched.
 */
export function syncBoardsIdentity(userId: string | null): void {
  if (userId === null) return
  const prev = readLS(LAST_USER_KEY)
  if (prev === userId) return
  if (prev !== null && prev !== '') dropSharedInstances(prev)
  writeLS(LAST_USER_KEY, userId)
  emit()
}

/** Forget every instance adopted under `accountId`, along with its per-instance state. */
function dropSharedInstances(accountId: string): void {
  const kept: InstanceId[] = []
  for (const id of readAddedInstanceIds()) {
    const key = `sharedBoard_${accountId}_${id}`
    if (readLS(key) === null) {
      kept.push(id)
      continue
    }
    removeLS(key)
    removeLS(angleKey(id))
    removeLS(flippedKey(id))
    removeLS(activeHoldSetsKey(id))
    removeLS(layoutPinKey(id))
  }
  writeAddedInstanceIds(kept)
  if (!kept.includes(readActiveInstanceId())) {
    writeLS(ACTIVE_KEY, kept[0] ?? String(DEFAULT_ACTIVE))
  }
}

// ─── Raw persisted accessors (pure; safe to unit-test directly) ───────────────

/** Raw added-instance ids in MRU order (front = most recent), unvalidated. */
function readAddedInstanceIds(): InstanceId[] {
  const raw = readLS(ADDED_KEY)
  if (!raw) return []
  return raw.split('|').filter((s) => s !== '')
}

function writeAddedInstanceIds(ids: InstanceId[]): void {
  writeLS(ADDED_KEY, ids.join('|'))
}

/** Added instance ids whose layout resolves — i.e. the ones that can actually render. */
export function getAddedInstanceIds(): InstanceId[] {
  return resolveInstances().map((i) => i.instanceId)
}

function readActiveInstanceId(): InstanceId {
  return readLS(ACTIVE_KEY) ?? String(DEFAULT_ACTIVE)
}

/**
 * Read the stored mirror for an instance. An `S:` id whose mirror is missing or
 * unparseable is an orphan — a half-written adoption or a cleared account — and is
 * dropped from the snapshot *without writing*, so a partial adoption can never surface
 * as a layout-less row and a transient read failure can't destroy recoverable state.
 */
function readMirror(id: InstanceId): SharedBoardMirror | undefined {
  return parseSharedBoardMirror(readLS(mirrorKey(id)))
}

/** The pinned layout for a demoted instance whose id encodes none. */
function readLayoutPin(id: InstanceId): number | undefined {
  const raw = readLS(layoutPinKey(id))
  if (raw === null || !/^\d+$/.test(raw)) return undefined
  return Number(raw)
}

/**
 * Build the live instance list from storage. This is the migration: a bare numeric id
 * becomes a local instance of that layout, an `S:` id takes its layout from its mirror,
 * and anything whose layout doesn't resolve is skipped.
 */
function resolveInstances(): BoardInstance[] {
  const out: BoardInstance[] = []
  for (const instanceId of readAddedInstanceIds()) {
    const mirror = readMirror(instanceId)
    const layoutId =
      mirror?.layoutId ?? layoutIdFromInstanceId(instanceId) ?? readLayoutPin(instanceId)
    if (layoutId === undefined) continue
    const layout = boardByLayoutId(layoutId)
    if (layout === undefined) continue
    // A bare id that carries a mirror is a *promoted* local instance: it keeps its id
    // (never re-keyed) and is shared all the same. Shared-ness is the mirror, not the id.
    out.push(mirror ? { instanceId, layoutId, layout, shared: mirror } : { instanceId, layoutId, layout })
  }
  return out
}

/** The instance with this id, or undefined when it isn't added / can't resolve. */
export function instanceById(id: InstanceId): BoardInstance | undefined {
  return resolveInstances().find((i) => i.instanceId === id)
}

/**
 * The instance for a layout id — the bridge for surfaces that only know a layout, which
 * today is every catalog surface (the route is `/board/$layoutId/catalog`). Unambiguous
 * while a layout backs at most one instance per device. The catalog route gains an
 * explicit `instance` param later, which is what retires this helper.
 */
export function instanceByLayoutId(layoutId: number): BoardInstance | undefined {
  const ofLayout = resolveInstances().filter((i) => i.layoutId === layoutId)
  // Prefer the instance whose id *is* the bare layout id, so a link that predates the
  // `instance` param keeps resolving to the same board it always did, even once a shared
  // instance of the same layout sits ahead of it in MRU order.
  return ofLayout.find((i) => i.instanceId === localInstanceId(layoutId)) ?? ofLayout[0]
}

/**
 * The instance for a layout, or a synthetic un-held one when the user doesn't hold it.
 *
 * Total by design: catalog surfaces render registry-valid boards the user has *not* added
 * (the read-only preview with its "Add this board" banner), so those surfaces need an
 * instance to read config from before any instance exists. The synthetic one carries the
 * bare layout id, so it reads exactly the keys the board would use once added.
 */
export function instanceForLayout(layout: CatalogBoardDef): BoardInstance {
  return (
    instanceByLayoutId(layout.layoutId) ?? {
      instanceId: localInstanceId(layout.layoutId),
      layoutId: layout.layoutId,
      layout,
    }
  )
}

/**
 * Add a local instance of a layout, promoting it to the MRU front (re-adding an existing
 * one re-fronts it), matching iOS `AddedBoards.promoting`.
 */
export function addBoard(layoutId: number): void {
  if (boardByLayoutId(layoutId) === undefined) return
  const id = localInstanceId(layoutId)
  const rest = readAddedInstanceIds().filter((existing) => existing !== id)
  writeAddedInstanceIds([id, ...rest])
  // Invariant: the active instance is always one the user holds. Adding does not
  // otherwise change it, but if the stored active instance isn't held (e.g. the
  // fresh-install default), adopt this new one so the list always has exactly one
  // active instance to Browse.
  if (!getAddedInstanceIds().includes(readActiveInstanceId())) {
    writeLS(ACTIVE_KEY, id)
  }
  emit()
}

/**
 * Adopt a shared board as a new instance. Writes the mirror **before** appending to the
 * added list, so a failure between the two leaves an unreferenced mirror (harmless)
 * rather than a referenced instance with no definition.
 */
export function addSharedInstance(mirror: SharedBoardMirror): InstanceId | undefined {
  if (boardByLayoutId(mirror.layoutId) === undefined) return undefined
  const id = sharedInstanceId(mirror.boardId)
  writeLS(mirrorKey(id), JSON.stringify(mirror))
  const rest = readAddedInstanceIds().filter((existing) => existing !== id)
  writeAddedInstanceIds([id, ...rest])
  writeLS(ACTIVE_KEY, id)
  emit()
  return id
}

/** Replace an existing instance's mirror — the reconcile path for a definition change. */
export function updateInstanceMirror(id: InstanceId, mirror: SharedBoardMirror): void {
  if (readLS(mirrorKey(id)) === null) return
  writeLS(mirrorKey(id), JSON.stringify(mirror))
  emit()
}

/**
 * Turn a shared instance back into a plain local one: drop the mirror, keep the id and
 * every mirrored value already on disk. The id is deliberately *not* re-keyed — doing so
 * would collide with a sibling local instance of the same layout, which is exactly the
 * case a member who also owns that layout locally is in.
 */
export function demoteInstanceToLocal(id: InstanceId): void {
  const instance = instanceById(id)
  if (instance?.shared === undefined) return
  // Freeze the canonical values into this device's own per-instance keys first, so the
  // board keeps browsing the way it did a moment ago instead of snapping to defaults.
  if (readLS(angleKey(id)) === null) {
    writeLS(angleKey(id), String(resolveInstanceAngle(instance, null)))
  }
  if (readLS(activeHoldSetsKey(id)) === null) {
    writeLS(activeHoldSetsKey(id), instance.shared.canonicalHoldSetsRaw)
  }
  // Pin the layout *before* dropping the mirror: an `S:` id carries no layout of its own,
  // so between the two writes the instance would read as a mirror-less orphan and vanish.
  writeLS(layoutPinKey(id), String(instance.layoutId))
  removeLS(mirrorKey(id))
  emit()
}

/**
 * Remove an instance. If it was active, reassign to the new MRU front (or the default
 * when none remain). Sibling instances of the same layout are untouched.
 */
export function removeBoard(id: InstanceId): void {
  const remaining = readAddedInstanceIds().filter((existing) => existing !== id)
  writeAddedInstanceIds(remaining)
  removeLS(mirrorKey(id))
  removeLS(angleKey(id))
  removeLS(flippedKey(id))
  removeLS(activeHoldSetsKey(id))
  removeLS(layoutPinKey(id))
  if (readActiveInstanceId() === id) {
    writeLS(ACTIVE_KEY, remaining[0] ?? String(DEFAULT_ACTIVE))
  }
  emit()
}

/** The active instance id (defaults to the Mini 2025 local instance). */
export function getActiveInstanceId(): InstanceId {
  const stored = readActiveInstanceId()
  return getAddedInstanceIds().includes(stored) ? stored : String(DEFAULT_ACTIVE)
}

/** Make an instance active and promote it to the front of the MRU list. */
export function activateBoard(id: InstanceId): void {
  if (instanceById(id) === undefined) return
  writeLS(ACTIVE_KEY, id)
  const rest = readAddedInstanceIds().filter((existing) => existing !== id)
  writeAddedInstanceIds([id, ...rest])
  emit()
}

/**
 * The angle to browse this instance at. Single clamp site: a fixed shared wall resolves
 * to the owner's canonical angle (itself clamped to the layout's bundled angles),
 * everything else honors the stored value when the layout bundles it.
 */
export function getAngle(instance: BoardInstance): number {
  return resolveInstanceAngle(instance, readLS(angleKey(instance.instanceId)))
}

/**
 * Set an instance's angle. Refused outright on a shared instance whose definition forbids
 * it — the UI hiding the control is not the enforcement, because the catalog mirrors the
 * URL's angle back into storage and that would otherwise be a back door.
 */
export function setAngle(instance: BoardInstance, angle: number): void {
  if (!canSetAngle(instance)) return
  writeLS(angleKey(instance.instanceId), String(angle))
  emit()
}

/** Whether the instance's LED strip is reverse-wired (feeds MoonBoardClient.send). */
export function getFlipped(id: InstanceId): boolean {
  return readLS(flippedKey(id)) === 'true'
}

/** LED wiring is the holder's own hardware, so it is never part of a shared definition. */
export function setFlipped(id: InstanceId, flipped: boolean): void {
  writeLS(flippedKey(id), String(flipped))
  emit()
}

/**
 * The raw installed-hold-set string ("" = all installed / filter off). It is
 * pipe-delimited (e.g. "17|18") and interpreted by holdSetMembership.ts. On a shared
 * instance the owner's canonical set wins — installed holds are a fact about the wall.
 */
export function getActiveHoldSetsRaw(instance: BoardInstance): string {
  if (instance.shared && instance.shared.role !== 'owner') {
    return instance.shared.canonicalHoldSetsRaw
  }
  return readLS(activeHoldSetsKey(instance.instanceId)) ?? ''
}

export function setActiveHoldSetsRaw(instance: BoardInstance, raw: string): void {
  if (!canSetHoldSets(instance)) return
  writeLS(activeHoldSetsKey(instance.instanceId), raw)
  emit()
}

// ─── React binding ────────────────────────────────────────────────────────────

interface StoreSnapshot {
  instances: BoardInstance[]
  activeInstance: BoardInstance
}

const listeners = new Set<() => void>()
let snapshot: StoreSnapshot = computeSnapshot()

function computeSnapshot(): StoreSnapshot {
  const instances = resolveInstances()
  // The active instance is always shown as one the user holds: prefer the stored active
  // instance when it's held, else fall back to the MRU front (mirrors the cold-launch
  // redirect in router.tsx). Guards legacy state where the stored active id predates the
  // added list. Empty added list → first-run screen, so the DEFAULT_ACTIVE synthetic
  // fallback is never actually surfaced there.
  const activeId = readActiveInstanceId()
  const activeInstance =
    instances.find((i) => i.instanceId === activeId) ?? instances[0] ?? defaultInstance()
  return { instances, activeInstance }
}

/** A synthetic local instance of the default board, for the never-surfaced empty case. */
function defaultInstance(): BoardInstance {
  const layout = boardByLayoutId(DEFAULT_ACTIVE)!
  return { instanceId: localInstanceId(DEFAULT_ACTIVE), layoutId: DEFAULT_ACTIVE, layout }
}

/** Rebuild the cached snapshot and notify subscribers. Called after every write. */
function emit(): void {
  snapshot = computeSnapshot()
  for (const l of listeners) l()
}

// Reflect writes made in another tab (localStorage 'storage' events fire in the
// *other* tabs, not the writer), so the active instance / added list stays in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', () => emit())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): StoreSnapshot {
  return snapshot
}

/** Reactive view of the held instances and active instance, with the mutating actions. */
export function useBoardStore() {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  return {
    ...snap,
    addBoard,
    addSharedInstance,
    removeBoard,
    activateBoard,
    demoteInstanceToLocal,
    setAngle,
    setFlipped,
    setActiveHoldSetsRaw,
  }
}

export type { BoardInstance, CatalogBoardDef }
