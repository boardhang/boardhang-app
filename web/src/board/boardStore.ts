// Multi-board state, persisted to localStorage with the same key scheme as the
// iOS app's @AppStorage (ios/MoonBoardLED/Board/Board.swift), so per-board angle,
// installed hold sets, and flip calibration stay traceable across apps.
//
// This module owns the RAW persisted values: added-board list (MRU order), the
// active board, per-board angle / flipped / installed-hold-set string. The
// hold-set string is interpreted against membership data by holdSetMembership.ts
// (U5) — this module does not know which sets are filterable.

import { useSyncExternalStore } from 'react'
import { boardByLayoutId, defaultAngle, type CatalogBoardDef } from './boards'

const ADDED_KEY = 'addedBoards'
const ACTIVE_KEY = 'activeBoardId'
const angleKey = (id: number) => `angle_${id}`
const flippedKey = (id: number) => `flipped_${id}`
const activeHoldSetsKey = (id: number) => `activeHoldSets_${id}`

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

// ─── Raw persisted accessors (pure; safe to unit-test directly) ───────────────

/** Added board layout ids, in most-recently-used order (front = most recent). */
export function getAddedBoardIds(): number[] {
  const raw = readLS(ADDED_KEY)
  if (!raw) return []
  return raw
    .split('|')
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && boardByLayoutId(n) !== undefined)
}

function writeAddedBoardIds(ids: number[]): void {
  writeLS(ADDED_KEY, ids.join('|'))
}

/** Add a board to the owned list, promoting it to the MRU front (re-adding an
 *  existing board re-fronts it), matching iOS `AddedBoards.promoting`. */
export function addBoard(layoutId: number): void {
  if (boardByLayoutId(layoutId) === undefined) return
  const rest = getAddedBoardIds().filter((id) => id !== layoutId)
  writeAddedBoardIds([layoutId, ...rest])
  // Invariant: the active board is always one the user owns. Adding a board does
  // not otherwise change the active board, but if the stored active board isn't
  // owned (e.g. the fresh-install default), adopt this newly added one so the
  // list always has exactly one active board to Browse.
  if (!getAddedBoardIds().includes(getActiveBoardId())) {
    writeLS(ACTIVE_KEY, String(layoutId))
  }
  emit()
}

/** Remove a board from the owned list. If it was active, reassign the active
 *  board to the new MRU front (or the default when none remain). */
export function removeBoard(layoutId: number): void {
  const remaining = getAddedBoardIds().filter((id) => id !== layoutId)
  writeAddedBoardIds(remaining)
  if (getActiveBoardId() === layoutId) {
    writeLS(ACTIVE_KEY, String(remaining[0] ?? DEFAULT_ACTIVE))
  }
  emit()
}

/** The active board id (defaults to Mini 2025). */
export function getActiveBoardId(): number {
  const raw = readLS(ACTIVE_KEY)
  const id = raw === null ? DEFAULT_ACTIVE : Number(raw)
  return boardByLayoutId(id) !== undefined ? id : DEFAULT_ACTIVE
}

/** Make a board active and promote it to the front of the MRU list. */
export function activateBoard(layoutId: number): void {
  if (boardByLayoutId(layoutId) === undefined) return
  writeLS(ACTIVE_KEY, String(layoutId))
  const rest = getAddedBoardIds().filter((id) => id !== layoutId)
  writeAddedBoardIds([layoutId, ...rest])
  emit()
}

/** The board's chosen angle, or its default when unset or invalid for the board. */
export function getAngle(board: CatalogBoardDef): number {
  const raw = readLS(angleKey(board.layoutId))
  const angle = raw === null ? NaN : Number(raw)
  return board.angles.includes(angle) ? angle : defaultAngle(board)
}

export function setAngle(layoutId: number, angle: number): void {
  writeLS(angleKey(layoutId), String(angle))
  emit()
}

/** Whether the board's LED strip is reverse-wired (feeds MoonBoardClient.send). */
export function getFlipped(layoutId: number): boolean {
  return readLS(flippedKey(layoutId)) === 'true'
}

export function setFlipped(layoutId: number, flipped: boolean): void {
  writeLS(flippedKey(layoutId), String(flipped))
  emit()
}

/** The raw installed-hold-set string ("" = all installed / filter off). It is
 *  pipe-delimited (e.g. "17|18") and interpreted by holdSetMembership.ts. */
export function getActiveHoldSetsRaw(layoutId: number): string {
  return readLS(activeHoldSetsKey(layoutId)) ?? ''
}

export function setActiveHoldSetsRaw(layoutId: number, raw: string): void {
  writeLS(activeHoldSetsKey(layoutId), raw)
  emit()
}

// ─── React binding ────────────────────────────────────────────────────────────

interface StoreSnapshot {
  addedBoards: CatalogBoardDef[]
  activeBoard: CatalogBoardDef
}

const listeners = new Set<() => void>()
let snapshot: StoreSnapshot = computeSnapshot()

function computeSnapshot(): StoreSnapshot {
  const addedBoards = getAddedBoardIds()
    .map((id) => boardByLayoutId(id))
    .filter((b): b is CatalogBoardDef => b !== undefined)
  // The active board is always shown as one the user owns: prefer the stored
  // active board when it's owned, else fall back to the MRU front (mirrors the
  // cold-launch redirect in router.tsx). Guards legacy state where the stored
  // active board predates the added list. Empty added list → first-run screen,
  // so the DEFAULT_ACTIVE fallback is never actually surfaced there.
  const activeId = getActiveBoardId()
  const activeBoard =
    addedBoards.find((b) => b.layoutId === activeId) ??
    addedBoards[0] ??
    boardByLayoutId(activeId) ??
    boardByLayoutId(DEFAULT_ACTIVE)!
  return { addedBoards, activeBoard }
}

/** Rebuild the cached snapshot and notify subscribers. Called after every write. */
function emit(): void {
  snapshot = computeSnapshot()
  for (const l of listeners) l()
}

// Reflect writes made in another tab (localStorage 'storage' events fire in the
// *other* tabs, not the writer), so the active board / added list stays in sync.
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

/** Reactive view of the added boards and active board, with the mutating actions. */
export function useBoardStore() {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  return {
    ...snap,
    addBoard,
    removeBoard,
    activateBoard,
    setAngle,
    setFlipped,
    setActiveHoldSetsRaw,
  }
}
