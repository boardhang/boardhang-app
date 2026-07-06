// Wires the routed board's slab into the browsing UI: the filter bar, the list,
// the recents sheet, and the detail pager. The URL is the source of truth —
// filters, sort, search, the resolved angle, and the open problem all come from
// `?…` search params and are written back with `navigate` (replace for
// filters/search, push-on-open / replace-on-swipe for the problem drawer). Owns
// the single useSlab and derives the filter context (favorites + installed-hold-set
// climbable check).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { FONT_GRADES, gradeIndex } from '../board/grades'
import { boardByLayoutId, defaultAngle } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle, setAngle, useBoardStore } from '../board/boardStore'
import { holdSetContext, isClimbable } from '../board/holdSetMembership'
import { CatalogList } from './CatalogList'
import { FilterSheet } from './FilterSheet'
import { RecentsSheet } from './RecentsSheet'
import { ProblemDetail } from './ProblemDetail'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { applyFilters, type FilterContext, type FilterState } from './filters'
import { filtersToSearch, searchToFilters } from './catalogSearch'
import { saveSeed } from './filterSeed'
import { useFavorites } from './favoritesStore'
import { useSlab } from './useSlab'
import { useAuth } from '../auth/AuthProvider'
import { loadAscents, resetAscents, useAscents } from '../logbook/ascents'
import type { CatalogProblem } from './catalogSync'

const routeApi = getRouteApi('/board/$layoutId/catalog')

export function CatalogScreen() {
  const router = useRouter()
  const { layoutId } = routeApi.useParams()
  const search = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  const { addedBoards, addBoard } = useBoardStore()
  // beforeLoad guarantees the board exists in the registry (unknown ids redirect).
  const board = boardByLayoutId(Number(layoutId))!
  const added = addedBoards.some((b) => b.layoutId === board.layoutId)

  // Angle comes from the URL (?angle), never a fresh getAngle() in render — the URL
  // is the single truth, so localStorage can't drift from it. Fall back to the
  // board's default when the URL omits it or names an angle the board doesn't have.
  const angle = board.angles.includes(search.angle) ? search.angle : defaultAngle(board)

  // Mirror the resolved angle back into boardStore so /boards (which can't read this
  // route) stays coherent with a deep-linked ?angle. Only writes when it differs.
  useEffect(() => {
    if (getAngle(board) !== angle) setAngle(board.layoutId, angle)
  }, [board, angle])

  const { problems, loading, degraded } = useSlab(board.layoutId, angle)
  const { favoriteIds } = useFavorites()

  // Logged sends → the green "sent" check on rows/detail (iOS parity). The ascents
  // store is a global singleton the Logbook tab also feeds; load it here too so the
  // check appears even when the catalog is opened without first visiting the logbook.
  const { status: authStatus, isRestoring } = useAuth()
  const signedIn = authStatus !== 'signedOut'
  const { ascents } = useAscents()
  useEffect(() => {
    if (isRestoring) return
    if (signedIn) void loadAscents()
    else resetAscents()
  }, [signedIn, isRestoring])
  // Board-scoped, mirroring the Logbook tab: a send counts for this board's catalog
  // only. `sent === false` rows (attempts) are excluded — only true sends get the check.
  const sentIds = useMemo(
    () =>
      new Set(
        ascents
          .filter((a) => a.sent && a.boardLayoutId === board.layoutId && a.sourceCatalogId)
          .map((a) => a.sourceCatalogId as string),
      ),
    [ascents, board.layoutId],
  )

  const filters = useMemo(() => searchToFilters(search), [search])

  // Persist filter changes to the URL (source of truth) and write them through to the
  // cold-launch seed. filtersToSearch omits angle/problem, so spreading preserves them.
  const setFilters = (next: FilterState) => {
    saveSeed(board.layoutId, angle, next)
    void navigate({ search: (prev) => ({ ...prev, ...filtersToSearch(next) }), replace: true })
  }

  // The slab's actual grade span (ordinal) for the slider, and its methods.
  const gradeSpan = useMemo<[number, number]>(() => {
    const idx = problems.map((p) => gradeIndex(p.grade)).filter((i) => i < FONT_GRADES.length)
    return idx.length ? [Math.min(...idx), Math.max(...idx)] : [0, FONT_GRADES.length - 1]
  }, [problems])
  const methods = useMemo(
    () => [...new Set(problems.map((p) => p.method).filter((m): m is string => !!m))].sort(),
    [problems],
  )

  // Installed-hold-set climbable check. The raw string is read in render (boardStore
  // re-renders this component when it changes) and is a memo dep, so toggling installed
  // sets re-derives the filter without relying on a coincidental re-render.
  const activeHoldSetsRaw = getActiveHoldSetsRaw(board.layoutId)
  const context = useMemo<FilterContext>(() => {
    const { membership, active } = holdSetContext(board.membershipResource, activeHoldSetsRaw)
    return { favoriteIds, isClimbable: (holds) => isClimbable(membership, holds, active) }
  }, [board, favoriteIds, activeHoldSetsRaw])

  const transform = useMemo(
    () => (list: CatalogProblem[]) => applyFilters(list, filters, context),
    [filters, context],
  )
  const displayed = useMemo(() => transform(problems), [transform, problems])

  // Ring the actively-filtered holds on thumbnails + the detail board (iOS parity).
  const highlightHolds = useMemo(() => new Set(filters.holdsFilter), [filters.holdsFilter])

  // ── Problem drawer, driven by ?problem ──────────────────────────────────────
  // The open problem's id lives in ?problem (deep-linkable). The pager *domain* is
  // session state: a recents snapshot when opened from the recents sheet (so paging
  // stays within recents, filter-independent — iOS parity), else the filtered
  // `displayed` list. Push on open (Back closes the drawer), replace on paging.
  const [pagerStack, setPagerStack] = useState<CatalogProblem[] | null>(null)
  const openId = search.problem
  const pagerList = pagerStack ?? displayed
  // Resolve against the active pager domain, falling back to the full slab so a
  // deep-linked problem the filters exclude still opens (standalone, prev/next off).
  const current = openId
    ? (pagerList.find((p) => p.source_catalog_id === openId) ??
      problems.find((p) => p.source_catalog_id === openId))
    : undefined
  // A deep link can request a problem before its slab has synced (cold cache / first
  // open). Keep the drawer open showing a spinner rather than nothing until the slab
  // resolves; if it loads and the id still isn't there, the drawer closes.
  const problemPending = Boolean(openId) && !current && loading
  const drawerOpen = current !== undefined || problemPending

  // Drop the recents pager source whenever the drawer closes (?problem cleared by any
  // means: Back, gesture, deep-link removal) so a later list tap or deep link never
  // pages over a stale recents snapshot.
  useEffect(() => {
    if (!openId) setPagerStack(null)
  }, [openId])

  // Whether this drawer session was push-opened (so Back should close it) rather than
  // entered cold via a deep link (nothing to go Back to).
  const pushed = useRef(false)

  // List taps: page over the filtered list.
  const openProblem = (problem: CatalogProblem) => {
    pushed.current = true
    setPagerStack(null)
    void navigate({ search: (prev) => ({ ...prev, problem: problem.source_catalog_id }) })
  }
  // Recent taps: page over the recents snapshot RecentsSheet hands over.
  const openRecent = (stack: CatalogProblem[], index: number) => {
    pushed.current = true
    setPagerStack(stack)
    void navigate({ search: (prev) => ({ ...prev, problem: stack[index].source_catalog_id }) })
  }
  const showProblem = (id: string) => {
    void navigate({ search: (prev) => ({ ...prev, problem: id }), replace: true })
  }
  const closeDrawer = () => {
    if (pushed.current) {
      pushed.current = false
      void router.history.back()
    } else {
      // Not push-opened (cold deep-link): drop ?problem in place. '' is its default,
      // so the strip middleware removes it from the URL.
      void navigate({ search: (prev) => ({ ...prev, problem: '' }), replace: true })
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {!added && <UnaddedBoardBanner name={board.name} onAdd={() => addBoard(board.layoutId)} />}
      <CatalogList
        board={board}
        angle={angle}
        problems={problems}
        loading={loading}
        degraded={degraded}
        favoriteIds={favoriteIds}
        sentIds={sentIds}
        transform={transform}
        searchActive={filters.search.trim().length > 0}
        highlightHolds={highlightHolds}
        onSelect={openProblem}
      />
      {/* Shared FAB column: recents on top, filter below (mirrors iOS's VStack).
          mt-auto pins it to the bottom of the flex-column scroll region; sticky
          keeps it there as a long list scrolls; pointer-events fall through. */}
      <div className="pointer-events-none sticky bottom-4 z-30 mt-auto flex flex-col items-end gap-3">
        <RecentsSheet board={board} angle={angle} problems={problems} favoriteIds={favoriteIds} sentIds={sentIds} onSelect={openRecent} />
        <FilterSheet state={filters} onChange={setFilters} board={board} gradeSpan={gradeSpan} methods={methods} />
      </div>

      <Drawer open={drawerOpen} onOpenChange={(open) => !open && closeDrawer()} showSwipeHandle>
        <DrawerContent>
          <DrawerTitle className="sr-only">Problem details</DrawerTitle>
          <div className="max-h-[85vh] overflow-y-auto px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {current ? (
              <ProblemDetail
                problem={current}
                displayed={pagerList}
                board={board}
                angle={angle}
                favoriteIds={favoriteIds}
                sentIds={sentIds}
                highlightHolds={highlightHolds}
                onNavigate={showProblem}
              />
            ) : problemPending ? (
              <div
                className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground"
                data-testid="problem-pending"
              >
                <Loader2 className="size-6 animate-spin" />
                <p className="text-sm">Loading problem…</p>
              </div>
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function UnaddedBoardBanner({ name, onAdd }: { name: string; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-3 py-2 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">
        Previewing <span className="font-medium text-foreground">{name}</span>
      </span>
      <Button size="sm" onClick={onAdd}>
        Add this board
      </Button>
    </div>
  )
}
