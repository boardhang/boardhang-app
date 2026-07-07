// The Logbook tab: the signed-in user's climbing history for the active board —
// a grade pyramid on top, then every day-session below with its ascent rows. Mirrors
// the iOS Home logbook section + full LogbookView combined onto one screen. Data comes
// straight from the shared Supabase `ascents` table (online-first; see ascents.ts).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useAuth } from '../auth/AuthProvider'
import { SignInPanel } from '../auth/SignInPanel'
import { useBoardStore } from '../board/boardStore'
import { getCatalogProblemsByIds, type CatalogProblem } from '../catalog/catalogSync'
import { useFavorites } from '../catalog/favoritesStore'
import { ProblemDetail } from '../catalog/ProblemDetail'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useEnsureAscentsLoaded, type Ascent } from './ascents'
import { AscentRow } from './AscentRow'
import { GradePyramid } from './GradePyramid'
import { LogAscentSheet, type LogTarget } from './LogAscentSheet'
import { sessions } from './sessions'

const routeApi = getRouteApi('/logbook')

export function LogbookScreen() {
  const { status, isRestoring } = useAuth()
  const { addedBoards, activeBoard } = useBoardStore()
  // Loads on sign-in / clears on sign-out (the shared auth-gated lifecycle).
  const { status: dataStatus, ascents, error } = useEnsureAscentsLoaded()
  // Route-bound so the drawer's `search` reducer types against /logbook's params.
  const navigate = routeApi.useNavigate()
  const router = useRouter()
  const signedIn = status !== 'signedOut'
  // The store defaults `activeBoard` to Mini 2025 even when it isn't among the added
  // boards (adding a board doesn't activate it), so gate on membership — not just count —
  // or the logbook would leak the default board for a user who added only a different one.
  const activeBoardAdded = addedBoards.some((b) => b.layoutId === activeBoard.layoutId)

  const [target, setTarget] = useState<LogTarget | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [catalogById, setCatalogById] = useState<Map<string, CatalogProblem>>(new Map())

  // Board-scoped view, mirroring iOS (the pyramid + list follow the active board).
  const boardAscents = useMemo(
    () => ascents.filter((a) => a.boardLayoutId === activeBoard.layoutId),
    [ascents, activeBoard.layoutId],
  )

  // Enrich rows with cached catalog entries (setter / benchmark / thumbnail). Scoped to
  // the *active board's* ascents — not all ascents — so a `?problem` deep-link can only
  // ever resolve to a problem on the active board, never another board's holds rendered
  // on this board's grid (the drawer renders `board={activeBoard}`).
  useEffect(() => {
    const ids = boardAscents.map((a) => a.sourceCatalogId).filter((x): x is string => x !== null)
    if (ids.length === 0) {
      setCatalogById(new Map())
      return
    }
    let cancelled = false
    getCatalogProblemsByIds(ids)
      .then((m) => {
        if (!cancelled) setCatalogById(m)
      })
      .catch(() => {
        /* enrichment is best-effort — rows fall back to ascent-only data */
      })
    return () => {
      cancelled = true
    }
  }, [boardAscents])
  const daySessions = useMemo(() => sessions(boardAscents), [boardAscents])
  const hasSends = boardAscents.some((a) => a.sent)

  function openEdit(ascent: Ascent) {
    setTarget({ kind: 'edit', ascent })
    setSheetOpen(true)
  }

  // ── Problem detail drawer, driven by ?problem (CatalogScreen pattern) ────────
  // /logbook is a tab root, so the drawer rides a history-integrated search param:
  // Back closes it and stays on the tab (a pure-local-state drawer would eject the
  // user from the whole Logbook tab on Back). Push on open so Back closes.
  //
  // The pager *domain* is the tapped row's day-session (deduped, resolvable problems
  // in on-screen order), captured as a state snapshot at open time — `?problem` alone
  // can't name the session (a problem logged on two days shares one id), mirroring
  // CatalogScreen's recents `pagerStack`. A cold deep-link / refresh has no snapshot →
  // falls back to a single-problem view (prev/next off).
  const search = routeApi.useSearch()
  const openId = search.problem
  const [sessionStack, setSessionStack] = useState<CatalogProblem[] | null>(null)
  const current = openId
    ? (sessionStack?.find((p) => p.source_catalog_id === openId) ?? catalogById.get(openId))
    : undefined
  const displayed = sessionStack ?? (current ? [current] : [])

  // Drop the session snapshot whenever the drawer closes (?problem cleared by any means:
  // Back, gesture, deep-link removal) so a later tap never pages over a stale session.
  useEffect(() => {
    if (!openId) setSessionStack(null)
  }, [openId])

  const { favoriteIds } = useFavorites()
  // Logged sends → the green sent check on the detail (iOS parity), mirroring
  // CatalogScreen. Board-scoped; attempts (sent === false) excluded.
  const sentIds = useMemo(
    () =>
      new Set(
        boardAscents
          .filter((a) => a.sent && a.sourceCatalogId)
          .map((a) => a.sourceCatalogId as string),
      ),
    [boardAscents],
  )

  // Push-opened drawers close on Back; there's nothing to go Back to for a cold deep link.
  const pushed = useRef(false)
  function openProblem(id: string, sessionProblems: CatalogProblem[]) {
    pushed.current = true
    setSessionStack(sessionProblems)
    void navigate({ search: (prev) => ({ ...prev, problem: id }) })
  }
  function showProblem(id: string) {
    void navigate({ search: (prev) => ({ ...prev, problem: id }), replace: true })
  }
  function closeDrawer() {
    if (pushed.current) {
      pushed.current = false
      void router.history.back()
    } else {
      // Cold deep-link (not push-opened): drop ?problem in place. '' is its default,
      // so the strip middleware removes it from the URL.
      void navigate({ search: (prev) => ({ ...prev, problem: '' }), replace: true })
    }
  }

  // The board name only belongs here once the active board is one the user added —
  // otherwise the store's default board would leak a name for a board they never chose.
  const header = (
    <div className="mb-3 px-1">
      <h1 className="text-lg font-bold tracking-tight">Logbook</h1>
      {activeBoardAdded && <p className="text-xs text-muted-foreground">{activeBoard.name}</p>}
    </div>
  )

  // ── Signed out ──────────────────────────────────────────────────────────────
  if (!isRestoring && !signedIn) {
    return (
      <div className="flex flex-1 flex-col px-3">
        {header}
        <div className="mt-6 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold">Sign in to see your logbook</h2>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Your logged ascents sync with the MoonBoard app across your devices.
          </p>
          <SignInPanel />
        </div>
      </div>
    )
  }

  // ── Signed in, but the active board isn't one the user added ────────────────
  // The logbook is board-scoped, so if the active board isn't in the added list there's
  // nothing legitimate to scope to. Guard here — ahead of the data checks — so cloud
  // ascents on the store's default board never render a logbook for a board never added.
  if (signedIn && !activeBoardAdded) {
    return (
      <div className="flex flex-1 flex-col px-3">
        {header}
        <EmptyState
          title="Add a board to start your logbook"
          body="Your logbook tracks your ascents on each board. Add a board and your climbing history will show up here."
          action={<Button onClick={() => void navigate({ to: '/boards' })}>Add a board</Button>}
        />
      </div>
    )
  }

  // ── Loading (initial) ───────────────────────────────────────────────────────
  if (isRestoring || (dataStatus === 'loading' && ascents.length === 0)) {
    return (
      <div className="flex flex-1 flex-col px-3">
        {header}
        <Skeleton className="h-[220px] w-full rounded-lg" />
        <div className="mt-4 space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    )
  }

  // ── Empty: nothing logged anywhere ─────────────────────────────────────────
  if (ascents.length === 0) {
    return (
      <div className="flex flex-1 flex-col px-3">
        {header}
        <EmptyState
          title="No logged ascents yet"
          body="When you log tries or an ascent, it'll show up in your logbook."
        />
        {error && <ErrorNote error={error} />}
      </div>
    )
  }

  // ── Empty: logged, but nothing on the active board ──────────────────────────
  if (boardAscents.length === 0) {
    return (
      <div className="flex flex-1 flex-col px-3">
        {header}
        <EmptyState
          title={`No ascents on ${activeBoard.name}`}
          body="Switch boards to see ascents logged elsewhere."
        />
      </div>
    )
  }

  // ── Logbook ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col px-3">
      {header}

      {hasSends && (
        <section className="mb-4 rounded-lg border border-border p-3">
          <GradePyramid ascents={boardAscents} />
        </section>
      )}

      <div className="space-y-4">
        {daySessions.map((session) => {
          // This day's pager domain: its resolvable problems, deduped, in on-screen
          // order. Tapping any row in the session pages within exactly this list.
          const sessionProblems = resolveSession(session.ascents, catalogById)
          return (
            <section key={session.dayKey}>
              <h2 className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {session.title}
              </h2>
              <div className="overflow-hidden rounded-lg border border-border">
                {session.ascents.map((ascent) => {
                  // Only rows whose catalog entry resolved open the detail drawer; a
                  // user-created or uncached row gets no onSelect (not tappable).
                  const catalog = ascent.sourceCatalogId
                    ? catalogById.get(ascent.sourceCatalogId)
                    : undefined
                  return (
                    <AscentRow
                      key={ascent.id}
                      ascent={ascent}
                      catalog={catalog}
                      board={activeBoard}
                      showThumbnail
                      onEdit={openEdit}
                      onSelect={
                        catalog
                          ? () => openProblem(ascent.sourceCatalogId as string, sessionProblems)
                          : undefined
                      }
                    />
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {error && <ErrorNote error={error} />}

      <LogAscentSheet open={sheetOpen} onOpenChange={setSheetOpen} target={target} />

      <Drawer open={current !== undefined} onOpenChange={(open) => !open && closeDrawer()} showSwipeHandle>
        <DrawerContent>
          <DrawerTitle className="sr-only">Problem details</DrawerTitle>
          <div className="max-h-[85vh] overflow-y-auto px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {current && (
              <ProblemDetail
                problem={current}
                displayed={displayed}
                board={activeBoard}
                angle={current.angle}
                favoriteIds={favoriteIds}
                sentIds={sentIds}
                onNavigate={showProblem}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

/** A day-session's pager domain: its resolvable problems in on-screen order, deduped by
 *  `source_catalog_id` (keep the first/topmost occurrence). Non-resolvable ascents
 *  (user-created or uncached) are skipped — they were never tappable. */
function resolveSession(
  ascents: Ascent[],
  catalogById: Map<string, CatalogProblem>,
): CatalogProblem[] {
  const seen = new Set<string>()
  const out: CatalogProblem[] = []
  for (const a of ascents) {
    if (!a.sourceCatalogId || seen.has(a.sourceCatalogId)) continue
    const problem = catalogById.get(a.sourceCatalogId)
    if (!problem) continue
    seen.add(a.sourceCatalogId)
    out.push(problem)
  }
  return out
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function ErrorNote({ error }: { error: string }) {
  return (
    <p className="mt-4 text-center text-xs text-destructive" role="alert">
      Couldn’t load your logbook: {error}
    </p>
  )
}
