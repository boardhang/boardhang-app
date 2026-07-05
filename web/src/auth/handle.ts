// Handle rules, shared by the DB check constraint and the client's live validation:
// 3–20 chars, lowercase a–z / 0–9 / underscore. Uniqueness is case-insensitive
// (enforced by the `citext` column); the client always lowercases before saving.
// Mirrors iOS `HandleRules`.

export const HANDLE_MIN_LENGTH = 3
export const HANDLE_MAX_LENGTH = 20

const HANDLE_PATTERN = new RegExp(`^[a-z0-9_]{${HANDLE_MIN_LENGTH},${HANDLE_MAX_LENGTH}}$`)

/** The canonical form we store and compare: trimmed + lowercased. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Whether `handle` (already normalized) satisfies the format constraint. */
export function isValidHandleFormat(handle: string): boolean {
  return HANDLE_PATTERN.test(handle)
}
