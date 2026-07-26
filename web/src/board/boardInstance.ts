// A board *instance*: the thing a user actually holds. One registry layout can back
// several instances — a local Masters 2019 in the garage and a shared Masters 2019 at
// the gym are two instances of layout 5, each with its own angle, installed hold sets,
// and flip calibration.
//
// This module is pure: types, id conventions, the mirror parser, and the permission and
// angle-resolution decisions. It touches no localStorage — boardStore.ts owns
// persistence and account scoping. Keeping the decisions here makes them directly
// unit-testable without seeding storage.

import { defaultAngle, type CatalogBoardDef } from './boards'

/**
 * An instance id is an **opaque, immutable** string. It is assigned once when the
 * instance is created and never re-keyed for the instance's lifetime — not on promote
 * to shared, not on demote back to local.
 *
 * Two shapes exist for migration reasons only:
 *   - `"7"`  — a bare layout id. Every instance that predates the instance model has
 *              this shape, so `angle_7` / `flipped_7` / `activeHoldSets_7` keep working
 *              and existing users migrate with zero writes.
 *   - `"S:<boardId>"` — an instance adopted by joining a shared board.
 *
 * The shape is NOT a shared-ness signal. A promoted local instance keeps its bare id
 * while being shared; a demoted instance keeps its `S:` id while being local. Read
 * shared-ness from `BoardInstance.shared` (i.e. from the mirror), never from the id.
 */
export type InstanceId = string

/** Whether the physical wall's angle can change, as declared by the board's owner. */
export type AngleMode = 'fixed' | 'adjustable'

export type BoardRole = 'owner' | 'member'

/**
 * The owner's canonical definition of a shared board, mirrored into device storage so
 * angle resolution stays synchronous and the instance survives sign-out, going offline,
 * and the owner deleting their account.
 *
 * Deliberately excludes the invite token — tokens are never persisted client-side.
 */
export interface SharedBoardMirror {
  /** Server id of the `shared_boards` row. */
  boardId: string
  role: BoardRole
  /** Owner-set display name, which is why two instances of one layout are tellable apart. */
  name: string
  layoutId: number
  angleMode: AngleMode
  canonicalAngle: number
  /** Pipe-delimited installed-hold-set string, same encoding as `activeHoldSets_`. */
  canonicalHoldSetsRaw: string
}

export interface BoardInstance {
  instanceId: InstanceId
  layoutId: number
  /** The resolved registry layout. An instance whose layout can't resolve is not surfaced. */
  layout: CatalogBoardDef
  /** Present iff this instance has a mirror — the single source of shared-ness. */
  shared?: SharedBoardMirror
}

const SHARED_PREFIX = 'S:'

/** The id a purely local instance of `layoutId` gets. Matches the pre-instance key scheme. */
export function localInstanceId(layoutId: number): InstanceId {
  return String(layoutId)
}

/** The id a newly adopted shared board gets. */
export function sharedInstanceId(boardId: string): InstanceId {
  return `${SHARED_PREFIX}${boardId}`
}

/**
 * The layout id encoded in a bare instance id, or undefined when the id carries no
 * layout of its own (an `S:` id, whose layout comes from the mirror).
 */
export function layoutIdFromInstanceId(instanceId: InstanceId): number | undefined {
  if (instanceId.startsWith(SHARED_PREFIX)) return undefined
  // `Number('')` is 0, and ' 7 ' coerces too — require an explicit digit run so a blank
  // or padded entry can't resolve to a layout nobody asked for.
  if (!/^\d+$/.test(instanceId)) return undefined
  const n = Number(instanceId)
  return Number.isInteger(n) ? n : undefined
}

export function isSharedInstance(instance: BoardInstance): boolean {
  return instance.shared !== undefined
}

/** What to call this instance: the owner's name for a shared board, else the layout name. */
export function instanceName(instance: BoardInstance): string {
  return instance.shared?.name ?? instance.layout.name
}

/**
 * Whether this device may set the instance's angle.
 *
 * A member of a *fixed* wall may not: the whole point of the fixed declaration is that
 * the wall is bolted at one angle, so browsing another angle would show problems that
 * can't be climbed. On an adjustable wall a member may switch among the angles the
 * layout bundles, and that choice is device-local — it never touches the canonical row.
 */
export function canSetAngle(instance: BoardInstance): boolean {
  const shared = instance.shared
  if (!shared) return true
  if (shared.role === 'owner') return true
  return shared.angleMode === 'adjustable'
}

/**
 * Whether this device may set the instance's installed hold sets. Only the owner can:
 * installed holds are a fact about the physical wall, and the owner is the one standing
 * in front of it.
 */
export function canSetHoldSets(instance: BoardInstance): boolean {
  const shared = instance.shared
  return !shared || shared.role === 'owner'
}

/**
 * Parse a stored mirror. Returns undefined for anything unparseable or structurally
 * wrong, so a half-written or hand-corrupted value degrades to "no mirror" (the instance
 * is then dropped as an orphan) rather than surfacing a layout-less row.
 */
export function parseSharedBoardMirror(raw: string | null): SharedBoardMirror | undefined {
  if (raw === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const m = parsed as Record<string, unknown>
  if (typeof m.boardId !== 'string' || m.boardId === '') return undefined
  if (m.role !== 'owner' && m.role !== 'member') return undefined
  if (typeof m.name !== 'string') return undefined
  if (typeof m.layoutId !== 'number' || !Number.isInteger(m.layoutId)) return undefined
  if (m.angleMode !== 'fixed' && m.angleMode !== 'adjustable') return undefined
  if (typeof m.canonicalAngle !== 'number' || !Number.isFinite(m.canonicalAngle)) return undefined
  if (typeof m.canonicalHoldSetsRaw !== 'string') return undefined
  return {
    boardId: m.boardId,
    role: m.role,
    name: m.name,
    layoutId: m.layoutId,
    angleMode: m.angleMode,
    canonicalAngle: m.canonicalAngle,
    canonicalHoldSetsRaw: m.canonicalHoldSetsRaw,
  }
}

/**
 * Resolve which angle to browse this instance at, given its stored device-local value.
 *
 * This is the single clamp site. A fixed shared wall resolves to the owner's canonical
 * angle — but that canonical value is itself clamped against the layout's bundled
 * angles, because a bad row must not reach the slab loader's `(layoutId, angle)` key and
 * hand every member an unresolvable catalog. Everything else honors the stored angle when
 * the layout bundles it, and falls back to the layout default.
 */
export function resolveInstanceAngle(instance: BoardInstance, storedRaw: string | null): number {
  const layout = instance.layout
  const shared = instance.shared
  if (shared && shared.angleMode === 'fixed') {
    return layout.angles.includes(shared.canonicalAngle)
      ? shared.canonicalAngle
      : defaultAngle(layout)
  }
  const stored = storedRaw === null ? NaN : Number(storedRaw)
  return layout.angles.includes(stored) ? stored : defaultAngle(layout)
}
