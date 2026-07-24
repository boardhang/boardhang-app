// The Logbook tab: the signed-in user's climbing history for the active board —
// a grade pyramid on top, then every day-session below with its ascent rows. Mirrors
// the iOS Home logbook section + full LogbookView combined onto one screen. Data comes
// straight from the shared Supabase `ascents` table (online-first; see ascents.ts).

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { SlidersHorizontal, X } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { useAuth } from '../auth/AuthProvider'
import { SignInPanel } from '../auth/SignInPanel'
import { useBoardStore } from '../board/boardStore'
import { getCatalogProblemsByIds, type CatalogProblem } from '../catalog/catalogSync'
import { useFavorites } from '../catalog/favoritesStore'
import { ProblemDetail } from '../catalog/ProblemDetail'
import { useProblemDrawer } from '../catalog/useProblemDrawer'
import { useShowPreviews } from '../catalog/previewsStore'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useEnsureAscentsLoaded, type Ascent } from './ascents'
import { AscentRow } from './AscentRow'
import { GradePyramid } from './GradePyramid'
import { LogAscentSheet, type LogTarget } from './LogAscentSheet'
import { MoonBoardImportBanner } from './MoonBoardImportBanner'
import { FONT_GRADES } from '../board/grades'
import { priorHistoryIds } from './problemHistory'
import { filterByDayRange, filterByGradeRange, loggedGradeSpan, sessions } from './sessions'

const routeApi = getRouteApi('/logbook')

const rangeLabelFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
})

export function LogbookScreen() {
  const { status, isRestoring } = useAuth()
  const { addedBoards, activeBoard } = useBoardStore()
  // Loads on sign-in / clears on sign-out (the shared auth-gated lifecycle).
  const { status: dataStatus, ascents, error } = useEnsureAscentsLoaded()
  // Route-bound so the drawer's `search` reducer types against /logbook's params.
  const navigate = routeApi.useNavigate()
  const signedIn = status !== 'signedOut'
  // The store defaults `activeBoard` to Mini 2025 even when it isn't among the added
  // boards (adding a board doesn't activate it), so gate on membership — not just count —
  // or the logbook would leak the default board for a user who added only a different one.
  const activeBoardAdded = addedBoards.some((b) => b.layoutId === activeBoard.layoutId)

  const [target, setTarget] = useState<LogTarget | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [catalogById, setCatalogById] = useState<Map<string, CatalogProblem>>(new Map())
  // Filters narrowing the session list (not the pyramid): a date span (local days,
  // inclusive) and a grade-ordinal range (null = full span, mirroring the catalog filter).
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [gradeRange, setGradeRange] = useState<[number, number] | null>(null)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)

  // Board-scoped view, mirroring iOS (the pyramid + list follow the active board).
  const boardAscents = useMemo(
    () => ascents.filter((a) => a.boardLayoutId === activeBoard.layoutId),
    [ascents, activeBoard.layoutId],
  )
  // The grade slider's domain: the span of grades actually logged on this board.
  const gradeSpan = useMemo(() => loggedGradeSpan(boardAscents), [boardAscents])
  const filteredAscents = useMemo(
    () =>
      filterByGradeRange(
        filterByDayRange(boardAscents, dateRange?.from, dateRange?.to),
        gradeRange,
      ),
    [boardAscents, dateRange, gradeRange],
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
  const daySessions = useMemo(() => sessions(filteredAscents), [filteredAscents])
  // Rows whose problem has earlier logged history — their one-try sends read
  // "Session flash" (flash stays reserved for never-tried problems). Computed over ALL
  // board ascents, not the filtered view: a row's history doesn't change with the filter.
  const historyIds = useMemo(() => priorHistoryIds(boardAscents), [boardAscents])
  // The pyramid is the career picture — it always shows the FULL board history,
  // untouched by the filters (which narrow only the session list below).
  const hasSends = boardAscents.some((a) => a.sent)

  function openEdit(ascent: Ascent) {
    setTarget({ kind: 'edit', ascent })
    setSheetOpen(true)
  }

  // ── Problem detail drawer, driven by ?problem (shared useProblemDrawer hook) ─
  // /logbook is a tab root, so the drawer rides a history-integrated search param:
  // Back closes it and stays on the tab (a pure-local-state drawer would eject the
  // user from the whole Logbook tab on Back). The hook owns the push/close/history
  // protocol; the pager *domain* it snapshots here is the tapped row's day-session
  // (deduped, resolvable problems in on-screen order — see openProblem call below).
  const search = routeApi.useSearch()
  const openId = search.problem ?? ''
  const { pagerStack, openProblem, showProblem, closeDrawer } = useProblemDrawer({
    openId,
    pushProblem: (id) => void navigate({ search: (prev) => ({ ...prev, problem: id }) }),
    replaceProblem: (id) =>
      void navigate({ search: (prev) => ({ ...prev, problem: id }), replace: true }),
    clearProblem: () => void navigate({ search: (prev) => ({ ...prev, problem: '' }), replace: true }),
  })
  // Resolve the open id against the captured session snapshot, falling back to the cached
  // catalog map for a cold deep-link (no snapshot → single-problem view, prev/next off).
  const current = openId
    ? (pagerStack?.find((p) => p.source_catalog_id === openId) ?? catalogById.get(openId))
    : undefined
  const displayed = pagerStack ?? (current ? [current] : [])

  const { favoriteIds } = useFavorites()
  const showThumbnails = useShowPreviews('logbook')
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

  // Chip labels for the active filters (null = filter off).
  const dateLabel = dateRange?.from
    ? dateRange.to && dateRange.to.getTime() !== dateRange.from.getTime()
      ? `${rangeLabelFormatter.format(dateRange.from)} – ${rangeLabelFormatter.format(dateRange.to)}`
      : rangeLabelFormatter.format(dateRange.from)
    : null
  const gradeLabel = gradeRange
    ? `${FONT_GRADES[gradeRange[0]]} – ${FONT_GRADES[gradeRange[1]]}`
    : null
  const filtersActive = dateLabel !== null || gradeLabel !== null

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
            Your logged ascents sync with the Boardhang app across your devices.
          </p>
          <SignInPanel hideIntro />
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
          action={
            <Button variant="outline" onClick={() => void navigate({ to: '/logbook/import' })}>
              Import from MoonBoard
            </Button>
          }
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
          body="Switch boards to see ascents logged elsewhere, or bring in your history from the MoonBoard app."
          action={
            <Button variant="outline" onClick={() => void navigate({ to: '/logbook/import' })}>
              Import from MoonBoard
            </Button>
          }
        />
      </div>
    )
  }

  // ── Logbook ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col px-3">
      {header}

      <MoonBoardImportBanner />

      {hasSends && (
        <section className="mb-4 rounded-lg border border-border p-3">
          <GradePyramid ascents={boardAscents} />
        </section>
      )}

      {/* The session list's own header — "History" with the Filters opener ON the header
          line — anchors the filters to the list below; the pyramid above is deliberately
          outside their scope. Active filters show as removable tags under the header
          (catalog pill-bar idiom: tap to remove, ✕ as the cue). */}
      <div className="mb-1 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-tight">History</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFilterSheetOpen(true)}
          className="h-6 shrink-0 gap-1 rounded-[min(var(--radius-md),12px)] px-2 text-xs font-medium"
        >
          <SlidersHorizontal aria-hidden className="size-3.5" />
          Filters
        </Button>
      </div>

      {filtersActive && (
        <div
          role="group"
          aria-label="Active logbook filters"
          className="mb-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
        {dateLabel && (
          <button
            type="button"
            onClick={() => setDateRange(undefined)}
            aria-label={`Remove ${dateLabel} filter`}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border bg-transparent px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span>{dateLabel}</span>
            <X aria-hidden className="size-3 text-muted-foreground" />
          </button>
        )}
        {gradeLabel && (
          <button
            type="button"
            onClick={() => setGradeRange(null)}
            aria-label={`Remove ${gradeLabel} filter`}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border bg-transparent px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span>{gradeLabel}</span>
            <X aria-hidden className="size-3 text-muted-foreground" />
          </button>
        )}
        </div>
      )}

      <Drawer open={filterSheetOpen} onOpenChange={setFilterSheetOpen} showSwipeHandle>
        <DrawerContent>
          <DrawerHeader className="flex flex-row items-center justify-between gap-2">
            <DrawerTitle>Filters</DrawerTitle>
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDateRange(undefined)
                  setGradeRange(null)
                }}
              >
                Clear filters
              </Button>
            )}
          </DrawerHeader>
          <div className="max-h-[70vh] space-y-5 overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                {`Dates · ${dateLabel ?? 'All'}`}
              </div>
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                defaultMonth={dateRange?.from}
                disabled={{ after: new Date() }}
                className="mx-auto"
              />
            </div>
            {gradeSpan && gradeSpan[0] < gradeSpan[1] && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">
                  {`Grade · ${FONT_GRADES[(gradeRange ?? gradeSpan)[0]]} – ${FONT_GRADES[(gradeRange ?? gradeSpan)[1]]}`}
                </div>
                <Slider
                  aria-label="Grade range"
                  min={gradeSpan[0]}
                  max={gradeSpan[1]}
                  step={1}
                  value={[(gradeRange ?? gradeSpan)[0], (gradeRange ?? gradeSpan)[1]]}
                  onValueChange={(value) => {
                    const [lo, hi] = value as number[]
                    setGradeRange(lo === gradeSpan[0] && hi === gradeSpan[1] ? null : [lo, hi])
                  }}
                />
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {daySessions.length === 0 && (
        <EmptyState
          title="No ascents match your filters"
          body="Adjust or clear the filters to see more of your history."
        />
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
                      showThumbnail={showThumbnails}
                      hasPriorHistory={historyIds.has(ascent.id)}
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
