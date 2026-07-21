// A user's sends on their profile (R19) — the projection is get_user_sends (single-actor
// wrapper over the revoked _sends_for_actors core). The server applies the R6/R12 gate: a
// blocked pair or an effectively-private non-follower gets an empty set, which renders here as
// the gated empty state (indistinguishable from "no sends yet", by design — a private account
// must not leak whether it has activity).
//
// The list mirrors the logbook exactly: a grade pyramid, then the keyset-paged sends grouped
// into day-sessions (same `sessions()` grouping + date headers) rendered with the shared
// `AscentRow`. Read-only — no edit pencil, and no per-row "sent" check since every row is a send
// by this user. Rows are enriched from the viewer's own synced catalog (setter/benchmark/
// thumbnail); a resolvable row opens the same `?problem` detail drawer the logbook/catalog use —
// the pager domain is the loaded sends, and the drawer's green "sent" check reflects the VIEWER's
// own logbook (i.e. "you've also done this").

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { boardByLayoutId } from '../board/boards'
import { useBoardStore } from '../board/boardStore'
import { getCatalogProblemsByIds, type CatalogProblem } from '../catalog/catalogSync'
import { useFavorites } from '../catalog/favoritesStore'
import { useShowPreviews } from '../catalog/previewsStore'
import { ProblemDetail } from '../catalog/ProblemDetail'
import { useProblemDrawer } from '../catalog/useProblemDrawer'
import { AscentRow } from '../logbook/AscentRow'
import { useEnsureAscentsLoaded, type Ascent } from '../logbook/ascents'
import { GradePyramid } from '../logbook/GradePyramid'
import { sessions } from '../logbook/sessions'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchSendsPage, SENDS_PAGE } from './sendsPage'
import type { SendItem } from './socialTypes'

const routeApi = getRouteApi('/u/$handle')

/** A send → the Ascent shape AscentRow / sessions() / pyramid() consume. The projection omits
 *  only voted_grade (→ no vote arrow); every projected row is a send. */
function toAscent(s: SendItem): Ascent {
  return {
    id: s.ascentId,
    date: s.climbedAt,
    sourceCatalogId: s.sourceCatalogId,
    userProblemId: s.userProblemId,
    problemName: s.problemName,
    problemGrade: s.problemGrade,
    votedGrade: s.problemGrade,
    tries: s.tries,
    stars: s.stars,
    comment: s.comment,
    sent: true,
    boardLayoutId: s.boardLayoutId,
  }
}

type LoadState = 'loading' | 'loaded' | 'error'

export function ProfileSends({ userId }: { userId: string }) {
  const [sends, setSends] = useState<SendItem[]>([])
  const [status, setStatus] = useState<LoadState>('loading')
  const [done, setDone] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [catalogById, setCatalogById] = useState<Map<string, CatalogProblem>>(new Map())
  // Guards against a stale response overwriting a newer userId's list.
  const reqId = useRef(0)

  // Scope to the viewer's active board, so a profile mirrors their active-board logbook (server
  // filters, so keyset pagination stays correct). Changing board refetches from page 1.
  const { activeBoard } = useBoardStore()
  const fetchPage = useCallback(
    (cursor: SendItem | null) =>
      fetchSendsPage('get_user_sends', cursor, {
        p_target: userId,
        p_board_layout_id: activeBoard.layoutId,
      }),
    [userId, activeBoard.layoutId],
  )

  useEffect(() => {
    const id = ++reqId.current
    setSends([])
    setStatus('loading')
    setDone(false)
    void fetchPage(null).then((rows) => {
      if (id !== reqId.current) return
      if (rows === null) {
        setStatus('error')
        return
      }
      setSends(rows)
      setStatus('loaded')
      setDone(rows.length < SENDS_PAGE)
    })
  }, [fetchPage])

  // Enrich rows from the viewer's own cached catalog (setter/benchmark + tap-to-open), same as
  // the logbook — resolves for boards the viewer has synced; the rest fall back gracefully.
  useEffect(() => {
    const ids = sends.map((s) => s.sourceCatalogId).filter((v): v is string => v !== null)
    if (ids.length === 0) return
    let live = true
    void getCatalogProblemsByIds(ids).then((map) => {
      if (live) setCatalogById(map)
    })
    return () => {
      live = false
    }
  }, [sends])

  async function loadMore() {
    const cursor = sends[sends.length - 1]
    if (!cursor) return
    const id = reqId.current
    setLoadingMore(true)
    const rows = await fetchPage(cursor)
    setLoadingMore(false)
    if (id !== reqId.current || rows === null) return
    setSends((prev) => [...prev, ...rows])
    setDone(rows.length < SENDS_PAGE)
  }

  const ascents = useMemo(() => sends.map(toAscent), [sends])
  const daySessions = useMemo(() => sessions(ascents), [ascents])

  // ── Problem detail drawer (?problem) — same protocol as logbook/catalog ──────
  const search = routeApi.useSearch()
  const navigate = routeApi.useNavigate()
  const openId = search.problem ?? ''
  const { pagerStack, openProblem, showProblem, closeDrawer } = useProblemDrawer({
    openId,
    pushProblem: (id) => void navigate({ search: (prev) => ({ ...prev, problem: id }) }),
    replaceProblem: (id) =>
      void navigate({ search: (prev) => ({ ...prev, problem: id }), replace: true }),
    clearProblem: () => void navigate({ search: (prev) => ({ ...prev, problem: '' }), replace: true }),
  })

  // The pager domain: the loaded sends' resolvable catalog problems, in on-screen order, deduped
  // by source_catalog_id (keep the first occurrence).
  const sendProblems = useMemo(() => {
    const seen = new Set<string>()
    const out: CatalogProblem[] = []
    for (const a of ascents) {
      const id = a.sourceCatalogId
      if (!id || seen.has(id)) continue
      const problem = catalogById.get(id)
      if (!problem) continue
      seen.add(id)
      out.push(problem)
    }
    return out
  }, [ascents, catalogById])

  const current = openId
    ? (pagerStack?.find((p) => p.source_catalog_id === openId) ?? catalogById.get(openId))
    : undefined
  const displayed = pagerStack ?? (current ? [current] : [])
  const currentBoard = current ? boardByLayoutId(current.layout_id) : undefined

  const { favoriteIds } = useFavorites()
  // Thumbnails honour the viewer's logbook preview toggle — same style/surface as the logbook.
  const showThumbnails = useShowPreviews('logbook')
  // The green "sent" check in the drawer = the VIEWER's own logged sends (all boards) — "you've
  // also done this" — not the profile owner's. Answers the row-level ambiguity explicitly.
  const { ascents: myAscents } = useEnsureAscentsLoaded()
  const sentIds = useMemo(
    () =>
      new Set(
        myAscents.filter((a) => a.sent && a.sourceCatalogId).map((a) => a.sourceCatalogId as string),
      ),
    [myAscents],
  )

  const openAscent = useCallback(
    (a: Ascent) => {
      if (a.sourceCatalogId && catalogById.has(a.sourceCatalogId)) {
        openProblem(a.sourceCatalogId, sendProblems)
      }
    },
    [catalogById, openProblem, sendProblems],
  )

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (status === 'error') {
    return <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load sends.</p>
  }

  if (sends.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No sends to show.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="px-1 pb-2 text-sm font-semibold text-foreground">Grades</h2>
        <GradePyramid items={ascents} />
      </section>

      <div className="flex flex-col gap-4">
        {daySessions.map((session) => (
          <section key={session.dayKey}>
            <h2 className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {session.title}
            </h2>
            <SendRows
              ascents={session.ascents}
              catalogById={catalogById}
              showThumbnails={showThumbnails}
              onOpen={openAscent}
            />
          </section>
        ))}
        {!done && (
          <Button variant="ghost" className="self-center" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </div>

      <Drawer open={current !== undefined} onOpenChange={(open) => !open && closeDrawer()} showSwipeHandle>
        <DrawerContent>
          <DrawerTitle className="sr-only">Problem details</DrawerTitle>
          <div className="max-h-[85vh] overflow-y-auto px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {current && currentBoard && (
              <ProblemDetail
                problem={current}
                displayed={displayed}
                board={currentBoard}
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

/** One day-session's sends as shared AscentRows (no edit pencil, no per-row sent check).
 *  Rows whose problem resolves in the viewer's catalog are tappable → the detail drawer. */
function SendRows({
  ascents,
  catalogById,
  showThumbnails,
  onOpen,
}: {
  ascents: Ascent[]
  catalogById: Map<string, CatalogProblem>
  showThumbnails: boolean
  onOpen: (ascent: Ascent) => void
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      {ascents.map((a) => {
        const resolved = a.sourceCatalogId ? catalogById.get(a.sourceCatalogId) : undefined
        return (
          <AscentRow
            key={a.id}
            ascent={a}
            catalog={resolved}
            board={boardByLayoutId(a.boardLayoutId)}
            showThumbnail={showThumbnails}
            showSentIndicator={false}
            onSelect={resolved ? () => onOpen(a) : undefined}
          />
        )
      })}
    </div>
  )
}
