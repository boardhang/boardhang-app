// Online-first logbook store. Unlike the iOS app (offline-first SwiftData + a sync
// manager), the web client reads and writes the shared Supabase `ascents` table
// directly: it's a viewer + logger that round-trips every change. Cross-device works
// because iOS and web are peers on the same owner-scoped table (migration 0002).
//
// Reads: all of the signed-in user's non-deleted ascents (RLS scopes to the owner),
// newest first. Board filtering is applied by the screen, mirroring iOS.
// Writes: optimistic local update + a Supabase upsert/update; on failure we roll the
// optimistic change back and surface the error. Deletes are soft (deleted = true).
//
// Reactive via useSyncExternalStore, same shape as boardStore / recentsStore.

import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../supabase/client'
import { useAuth } from '../auth/AuthProvider'
import { attemptId } from './attemptId'
import { ascentIdentity } from './problemHistory'

export interface Ascent {
  id: string
  /** ISO-8601 timestamp. */
  date: string
  sourceCatalogId: string | null
  userProblemId: string | null
  problemName: string
  problemGrade: string
  votedGrade: string
  tries: number
  stars: number
  comment: string
  sent: boolean
  boardLayoutId: number
}

/** Fields needed to create a new ascent. `id` is supplied by the caller — a random
 *  UUID for a send, or the deterministic attempt id for an unsent same-day attempt. */
export interface NewAscent {
  id: string
  date: string
  sourceCatalogId: string | null
  userProblemId?: string | null
  problemName: string
  problemGrade: string
  votedGrade: string
  tries: number
  stars: number
  comment: string
  sent: boolean
  boardLayoutId: number
}

/** Mutable fields when editing an existing ascent. */
export interface AscentPatch {
  date: string
  votedGrade: string
  tries: number
  stars: number
  comment: string
  sent: boolean
}

// ─── Row mapping (snake_case Postgres ↔ camelCase model) ──────────────────────

interface AscentRow {
  id: string
  date: string
  source_catalog_id: string | null
  user_problem_id: string | null
  problem_name: string
  problem_grade: string
  voted_grade: string
  tries: number
  stars: number
  comment: string
  sent: boolean
  board_layout_id: number
}

function fromRow(r: AscentRow): Ascent {
  return {
    id: r.id,
    date: r.date,
    sourceCatalogId: r.source_catalog_id,
    userProblemId: r.user_problem_id,
    problemName: r.problem_name,
    problemGrade: r.problem_grade,
    votedGrade: r.voted_grade,
    tries: r.tries,
    stars: r.stars,
    comment: r.comment,
    sent: r.sent,
    boardLayoutId: r.board_layout_id,
  }
}

// ─── Reactive store ───────────────────────────────────────────────────────────

export type AscentsStatus = 'idle' | 'loading' | 'loaded' | 'error'

export interface AscentsState {
  status: AscentsStatus
  /** Non-deleted ascents for the signed-in user, newest first. */
  ascents: Ascent[]
  error: string | null
}

let state: AscentsState = { status: 'idle', ascents: [], error: null }
const listeners = new Set<() => void>()

function setState(next: Partial<AscentsState>): void {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function sortNewestFirst(list: Ascent[]): Ascent[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date))
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/** Fetch the signed-in user's ascents. Signed-out / unconfigured → an empty loaded
 *  set (the screen shows its sign-in prompt). Best-effort: a network failure lands in
 *  the `error` status without clearing whatever was already shown. */
export async function loadAscents(): Promise<void> {
  if (!supabase) {
    setState({ status: 'loaded', ascents: [], error: null })
    return
  }
  const userId = await currentUserId()
  if (!userId) {
    setState({ status: 'loaded', ascents: [], error: null })
    return
  }
  setState({ status: 'loading', error: null })
  const { data, error } = await supabase
    .from('ascents')
    .select('*')
    .eq('deleted', false)
    .order('date', { ascending: false })
  if (error) {
    setState({ status: 'error', error: error.message })
    return
  }
  setState({
    status: 'loaded',
    ascents: sortNewestFirst((data as AscentRow[]).map(fromRow)),
    error: null,
  })
}

/** Clear the store (e.g. on sign-out) so one user's logbook never bleeds into the next. */
export function resetAscents(): void {
  setState({ status: 'idle', ascents: [], error: null })
}

/**
 * Create (or upsert) an ascent. Sends use a random id (upsert is a plain insert);
 * unsent attempts pass the deterministic attempt id so re-logging the same problem/day
 * merges onto one row (last-write-wins), matching the server's partial unique index.
 * Optimistic: the row appears immediately and is reconciled with the server copy.
 */
export async function createAscent(input: NewAscent): Promise<void> {
  const optimistic: Ascent = {
    id: input.id,
    date: input.date,
    sourceCatalogId: input.sourceCatalogId,
    userProblemId: input.userProblemId ?? null,
    problemName: input.problemName,
    problemGrade: input.problemGrade,
    votedGrade: input.votedGrade,
    tries: input.tries,
    stars: input.stars,
    comment: input.comment,
    sent: input.sent,
    boardLayoutId: input.boardLayoutId,
  }
  const prev = state.ascents
  // Replace any existing row with the same id (attempt merge), else prepend.
  const withoutDup = prev.filter((a) => a.id !== optimistic.id)
  setState({ ascents: sortNewestFirst([optimistic, ...withoutDup]) })

  if (!supabase) return
  const userId = await currentUserId()
  if (!userId) {
    setState({ ascents: prev })
    throw new Error('You need to be signed in to log an ascent.')
  }
  const { data, error } = await supabase
    .from('ascents')
    .upsert(
      {
        id: input.id,
        user_id: userId,
        date: input.date,
        source_catalog_id: input.sourceCatalogId,
        user_problem_id: input.userProblemId ?? null,
        problem_name: input.problemName,
        problem_grade: input.problemGrade,
        voted_grade: input.votedGrade,
        tries: input.tries,
        stars: input.stars,
        comment: input.comment,
        sent: input.sent,
        board_layout_id: input.boardLayoutId,
        deleted: false,
      },
      { onConflict: 'id' },
    )
    .select()
    .single()
  if (error) {
    setState({ ascents: prev })
    throw new Error(error.message)
  }
  // Reconcile with the server representation (authoritative id/fields).
  const saved = fromRow(data as AscentRow)
  setState({
    ascents: sortNewestFirst([saved, ...state.ascents.filter((a) => a.id !== saved.id)]),
  })
}

/**
 * Add unsent tries to today's attempt row for a problem — the deferred flush of the
 * inline "Log try" stepper. Mirrors iOS `flushPending` + `revive`: same-day attempts
 * converge on one row via the deterministic attempt id, and the tries ACCUMULATE
 * (existing + added) rather than overwrite, so multiple sessions the same day sum up.
 */
export async function addAttemptTries(input: {
  sourceCatalogId: string | null
  userProblemId?: string | null
  problemName: string
  problemGrade: string
  boardLayoutId: number
  /** ISO timestamp; the UTC calendar day buckets the attempt id. */
  date: string
  addTries: number
}): Promise<void> {
  if (input.addTries <= 0) return
  const id = await attemptId(ascentIdentity(input), new Date(input.date))

  // Accumulate onto any existing attempt row for today (iOS revive semantics).
  let existingTries = 0
  const local = state.ascents.find((a) => a.id === id)
  if (local) {
    existingTries = local.tries
  } else if (supabase) {
    const { data } = await supabase
      .from('ascents')
      .select('tries, deleted')
      .eq('id', id)
      .maybeSingle()
    const row = data as { tries: number; deleted: boolean } | null
    if (row && !row.deleted) existingTries = row.tries
  }

  await createAscent({
    id,
    date: input.date,
    sourceCatalogId: input.sourceCatalogId,
    userProblemId: input.userProblemId ?? null,
    problemName: input.problemName,
    problemGrade: input.problemGrade,
    votedGrade: input.problemGrade,
    tries: existingTries + input.addTries,
    stars: 0,
    comment: '',
    sent: false,
    boardLayoutId: input.boardLayoutId,
  })
}

/** Edit an existing ascent (optimistic; rolls back on failure). */
export async function updateAscent(id: string, patch: AscentPatch): Promise<void> {
  const prev = state.ascents
  setState({
    ascents: sortNewestFirst(prev.map((a) => (a.id === id ? { ...a, ...patch } : a))),
  })
  if (!supabase) return
  const { error } = await supabase
    .from('ascents')
    .update({
      date: patch.date,
      voted_grade: patch.votedGrade,
      tries: patch.tries,
      stars: patch.stars,
      comment: patch.comment,
      sent: patch.sent,
    })
    .eq('id', id)
  if (error) {
    setState({ ascents: prev })
    throw new Error(error.message)
  }
}

/** Soft-delete an ascent (optimistic remove; rolls back on failure). */
export async function deleteAscent(id: string): Promise<void> {
  const prev = state.ascents
  setState({ ascents: prev.filter((a) => a.id !== id) })
  if (!supabase) return
  const { error } = await supabase.from('ascents').update({ deleted: true }).eq('id', id)
  if (error) {
    setState({ ascents: prev })
    throw new Error(error.message)
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): AscentsState {
  return state
}

/** Reactive view of the logbook store. */
export function useAscents(): AscentsState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Reactive ascents, with the auth-gated load lifecycle attached: loads on sign-in
 * (after the initial session restore, so an established user doesn't flash signed-out)
 * and clears on sign-out. Any screen that surfaces sent/logged state uses this so the
 * "load-if-signed-in / reset-if-not" policy lives in one place, not copied per screen.
 */
export function useEnsureAscentsLoaded(): AscentsState {
  const { status, isRestoring } = useAuth()
  const signedIn = status !== 'signedOut'
  useEffect(() => {
    if (isRestoring) return
    if (signedIn) void loadAscents()
    else resetAscents()
  }, [signedIn, isRestoring])
  return useAscents()
}
