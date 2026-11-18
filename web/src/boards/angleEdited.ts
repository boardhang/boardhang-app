// "The user just set this board's angle on its edit page" — a mark the catalog reads.
//
// The catalog treats `?angle` as the truth and mirrors it into the board store. That
// is right for a deep link, and wrong for browser Back from the edit page onto a
// catalog history entry that still carries the old angle: the mirror would silently
// undo the edit. So the edit page marks the board here, and the catalog, finding the
// mark with a URL angle that differs from the stored one, moves its URL to the stored
// angle instead.
//
// The mark lasts for the page load and is never cleared: there can be several older
// catalog entries for the board in history, and each one is corrected as Back reaches
// it. That is safe because no link inside the app carries an angle other than the
// stored one, so within a page load a differing `?angle` on a marked board can only be
// a stale history entry. A pasted or shared link is a fresh page load with no marks,
// so its `?angle` still wins.
//
// Module state on purpose: it is about this page load's history entries, so it must
// not outlive them in localStorage.

const edited = new Set<number>()

/** The edit page changed this board's angle. */
export function markAngleEdited(layoutId: number): void {
  edited.add(layoutId)
}

/** Whether the board's stored angle was set on the edit page during this page load. */
export function isAngleEdited(layoutId: number): boolean {
  return edited.has(layoutId)
}

/** Test-only: forget every mark. */
export function resetAngleEdited(): void {
  edited.clear()
}
