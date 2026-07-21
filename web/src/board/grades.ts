// Canonical Font-grade scale, ported from ios/MoonBoardLED/Models/Problem.swift
// (`FontGrade`). Grade sort and grade-range filtering key off the ordinal
// position here, never String comparison — lexicographic order gets it wrong
// (e.g. "6A+" vs "6A", "7C" vs "8A").

export const FONT_GRADES: readonly string[] = [
  '5+', '5B', '5C',
  '6A', '6A+', '6B', '6B+', '6C', '6C+',
  '7A', '7A+', '7B', '7B+', '7C', '7C+',
  '8A', '8A+', '8B', '8B+',
]

export const DEFAULT_GRADE = '6A+'

/**
 * Ordinal floor of the grade FILTER (issue #96): 6A+ is the lowest grade the filter
 * offers or labels. The scale keeps its sub-6A+ entries so stray catalog grades
 * (5+, 6A…) still sort correctly, but every filter surface clamps to this floor and
 * the range predicate treats sub-floor grades as 6A+ — so capping the top of the
 * range never silently hides them.
 */
export const GRADE_FILTER_FLOOR = FONT_GRADES.indexOf(DEFAULT_GRADE)

/** Position on the canonical scale; unknown/unmapped grades sort to the end. */
export function gradeIndex(grade: string): number {
  const i = FONT_GRADES.indexOf(grade)
  return i === -1 ? FONT_GRADES.length : i
}
