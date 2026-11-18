// "The user just set this board's angle on its edit page" — a mark the catalog reads.
//
// The catalog treats `?angle` as the truth and mirrors it into the board store. That
// is right for a deep link, and wrong for browser Back from the edit page onto a
// catalog history entry that still carries the old angle: the mirror would silently
// undo the edit. So the edit page marks the board here, and the catalog, finding the
// mark with a URL angle that differs from the stored one, moves its URL to the stored
// angle instead. The mark is cleared once the two agree.
//
// Module state on purpose: it is about this page load's history entries, so it must
// not outlive them in localStorage.

const edited = new Set<number>()

/** The edit page changed this board's angle. */
export function markAngleEdited(layoutId: number): void {
  edited.add(layoutId)
}

/** Whether the board's stored angle was set on the edit page and not yet seen by its catalog. */
export function isAngleEdited(layoutId: number): boolean {
  return edited.has(layoutId)
}

/** The catalog shows the stored angle; the mark has done its job. */
export function clearAngleEdited(layoutId: number): void {
  edited.delete(layoutId)
}

/** Test-only: forget every mark. */
export function resetAngleEdited(): void {
  edited.clear()
}
