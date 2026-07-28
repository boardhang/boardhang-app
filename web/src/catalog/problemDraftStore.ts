// The in-progress problem the editor is authoring, persisted to localStorage per
// board+angle. One mechanism covers every way the tab can go away mid-draft: a full
// page reload at the wall, PWA tab eviction, and the Google OAuth full-page redirect —
// see plan KTD10/AE1. Only the CREATE editor persists here; an edit session keeps its
// working copy in memory (see ProblemEditorDrawer) so it can never clobber a parked draft.
//
// The stored shape is the whole draft, not just the holds: `name`, `grade` and
// `visibility` are already carried here so the save sheet can join without a storage
// migration. Reads fill every field, so a draft written by an older build (holds only)
// still restores.

import type { CatalogHold } from './catalogSync'
import type { HoldType } from '../types'

export type Visibility = 'private' | 'public'

export interface ProblemDraft {
  holds: CatalogHold[]
  name: string
  /** Font grade label (e.g. "6B"); `''` until the author picks one. */
  grade: string
  visibility: Visibility
}

export const EMPTY_DRAFT: ProblemDraft = { holds: [], name: '', grade: '', visibility: 'private' }

const key = (layoutId: number, angle: number) => `problemDraft_${layoutId}_${angle}`
const intentKey = (layoutId: number, angle: number) => `problemSaveIntent_${layoutId}_${angle}`

const HOLD_TYPES: readonly HoldType[] = ['start', 'left', 'right', 'match', 'end']

function parseHolds(raw: unknown): CatalogHold[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (h): h is CatalogHold =>
      typeof h === 'object' &&
      h !== null &&
      Number.isInteger((h as CatalogHold).c) &&
      Number.isInteger((h as CatalogHold).r) &&
      HOLD_TYPES.includes((h as CatalogHold).t),
  )
}

/** The persisted draft for a slab, or an empty draft when there is none. Never throws:
 *  a corrupt or hand-edited entry degrades to "no draft" rather than breaking the editor. */
export function readDraft(layoutId: number, angle: number): ProblemDraft {
  try {
    const raw = localStorage.getItem(key(layoutId, angle))
    if (!raw) return EMPTY_DRAFT
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_DRAFT
    const d = parsed as Partial<ProblemDraft>
    return {
      holds: parseHolds(d.holds),
      name: typeof d.name === 'string' ? d.name : '',
      grade: typeof d.grade === 'string' ? d.grade : '',
      visibility: d.visibility === 'public' ? 'public' : 'private',
    }
  } catch {
    return EMPTY_DRAFT
  }
}

/** Persist the draft for a slab. Best-effort: a full/blocked quota must not break editing. */
export function writeDraft(layoutId: number, angle: number, draft: ProblemDraft): void {
  try {
    localStorage.setItem(key(layoutId, angle), JSON.stringify(draft))
  } catch {
    // Best-effort.
  }
}

/** Drop a slab's draft and any pending save intent (explicit discard, or a completed save). */
export function clearDraft(layoutId: number, angle: number): void {
  try {
    localStorage.removeItem(key(layoutId, angle))
    localStorage.removeItem(intentKey(layoutId, angle))
  } catch {
    // Best-effort.
  }
}

// ─── Pending save intent (AE1) ───────────────────────────────────────────────
// "The author asked to save" is editor state, not draft content, so it rides its own key
// rather than widening ProblemDraft. It exists for the same reason the draft is persisted
// at all: a signed-out Save opens the sign-in dialog, and Google OAuth takes the whole page
// away. Without this the session comes back and the editor just sits there — the author has
// to find the Save button again and re-state an intent they already expressed.

/** Whether a save was pending when the editor last went away. */
export function readSaveIntent(layoutId: number, angle: number): boolean {
  try {
    return localStorage.getItem(intentKey(layoutId, angle)) === '1'
  } catch {
    return false
  }
}

/** Record (or drop) a pending save for this slab. Best-effort, like the draft itself. */
export function writeSaveIntent(layoutId: number, angle: number, pending: boolean): void {
  try {
    if (pending) localStorage.setItem(intentKey(layoutId, angle), '1')
    else localStorage.removeItem(intentKey(layoutId, angle))
  } catch {
    // Best-effort.
  }
}
