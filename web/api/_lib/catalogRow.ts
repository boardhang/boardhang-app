// One-row read of `catalog_problems` for the link-preview functions. Plain REST with
// the anon key (the table is world-readable and the key already ships to the browser)
// — no supabase-js, whose session machinery is dead weight in a function.
//
// `ProblemRow` is declared here on purpose: the app's `CatalogRow` lives in
// src/catalog/catalogSync.ts, which is not a leaf module (it reaches the Supabase
// client, import.meta.env and IndexedDB), and even a type-only import would pull it
// into the API type-check program. api/ may import only the leaf modules
// src/board/boards.js, src/board/renderGeometry.js, src/types.js and
// src/catalog/problemPath.js.

import type { HoldType } from '../../src/types.js'
import { boardByLayoutId } from '../../src/board/boards.js'

export interface ProblemHold {
  c: number
  r: number
  t: HoldType
}

export interface ProblemRow {
  source_catalog_id: string
  layout_id: number
  angle: number
  name: string
  grade: string
  user_grade: string | null
  setter: string
  stars: number
  repeats: number
  is_benchmark: boolean
  method: string | null
  holds: ProblemHold[]
  updated_at: string
  deleted: boolean
}

/** Exactly the columns the functions read — the REST `select=` list. */
export const PROBLEM_ROW_COLUMNS = [
  'source_catalog_id',
  'layout_id',
  'angle',
  'name',
  'grade',
  'user_grade',
  'setter',
  'stars',
  'repeats',
  'is_benchmark',
  'method',
  'holds',
  'updated_at',
  'deleted',
] as const

export interface RowEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

export interface RowDeps {
  fetch: typeof globalThis.fetch
  env: RowEnv
  /** Abort the read after this long; a slow database must not stall a crawler. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 3000
const MAX_ID_LENGTH = 128

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isHold(v: unknown): v is ProblemHold {
  return isRecord(v) && typeof v.c === 'number' && typeof v.r === 'number' && typeof v.t === 'string'
}

/** Shape-check the row well enough that the renderers never see undefined coordinates. */
function asRow(v: unknown): ProblemRow | null {
  if (!isRecord(v)) return null
  if (typeof v.source_catalog_id !== 'string' || typeof v.layout_id !== 'number') return null
  if (typeof v.angle !== 'number' || typeof v.name !== 'string' || typeof v.grade !== 'string') return null
  if (typeof v.updated_at !== 'string') return null
  if (!Array.isArray(v.holds) || !v.holds.every(isHold)) return null
  return {
    source_catalog_id: v.source_catalog_id,
    layout_id: v.layout_id,
    angle: v.angle,
    name: v.name,
    grade: v.grade,
    user_grade: typeof v.user_grade === 'string' ? v.user_grade : null,
    setter: typeof v.setter === 'string' ? v.setter : '',
    stars: typeof v.stars === 'number' ? v.stars : 0,
    repeats: typeof v.repeats === 'number' ? v.repeats : 0,
    is_benchmark: v.is_benchmark === true,
    method: typeof v.method === 'string' ? v.method : null,
    holds: v.holds,
    updated_at: v.updated_at,
    deleted: v.deleted === true,
  }
}

/**
 * Read one problem by primary key. Resolves null — never throws — for an empty or
 * malformed id, missing credentials, a non-2xx, a timeout, a body that isn't JSON, an
 * empty result, a deleted row, or a layout the registry doesn't know.
 */
export async function fetchProblemRow(id: string, deps: RowDeps): Promise<ProblemRow | null> {
  const { VITE_SUPABASE_URL: base, VITE_SUPABASE_ANON_KEY: key } = deps.env
  if (!id || id.length > MAX_ID_LENGTH || /\s/.test(id) || !base || !key) return null

  const params = new URLSearchParams({
    select: PROBLEM_ROW_COLUMNS.join(','),
    source_catalog_id: `eq.${id}`,
    limit: '1',
  })
  const url = `${base.replace(/\/$/, '')}/rest/v1/catalog_problems?${params.toString()}`

  try {
    const res = await deps.fetch(url, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body: unknown = await res.json()
    if (!Array.isArray(body) || body.length === 0) return null
    const row = asRow(body[0])
    if (!row || row.deleted) return null
    if (boardByLayoutId(row.layout_id) === undefined) return null
    return row
  } catch {
    return null
  }
}
