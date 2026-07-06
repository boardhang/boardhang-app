// One saved list: its problems (resolved against the catalog cache), an angle
// filter/grouping (KTD1 — a list may hold any angle), remove, and tap-through to the
// existing ProblemDetail pager. The pager's `displayed` domain is the angle-filtered
// subset, so prev/next never pages to a problem the active filter hides. A non-member's
// /lists/$listId returns zero rows under RLS → a "list not found" state (KTD4).

import { useEffect, useMemo, useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { boardByLayoutId } from '../board/boards'
import { CatalogRow } from '../catalog/CatalogRow'
import { ProblemDetail } from '../catalog/ProblemDetail'
import { getCatalogProblemsByIds, type CatalogProblem } from '../catalog/catalogSync'
import { useFavorites } from '../catalog/favoritesStore'
import { useShowPreviews } from '../catalog/previewsStore'
import { useEnsureAscentsLoaded } from '../logbook/ascents'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { addProblem, loadLists, removeProblem, useSavedLists } from './listsStore'
import { useListProblems } from './useListProblems'
import { boardShortLabel } from './listsTypes'

const routeApi = getRouteApi('/lists/$listId')

export function ListDetailScreen() {
  const { listId } = routeApi.useParams()
  const { status, isRestoring } = useAuth()
  const { status: dataStatus, lists } = useSavedLists()
  const signedIn = status !== 'signedOut'

  useEffect(() => {
    if (isRestoring) return
    if (signedIn) void loadLists()
  }, [signedIn, isRestoring])

  const list = lists.find((l) => l.id === listId)
  const board = list ? boardByLayoutId(list.boardLayoutId) : undefined

  const { problems: saved, loading } = useListProblems(listId)

  // Resolve each saved problem's catalog entry (board-agnostic id lookup). Best-effort:
  // an uncached id is simply absent (rare — the board's slab is cached when browsed).
  const [resolved, setResolved] = useState<CatalogProblem[]>([])
  useEffect(() => {
    const ids = saved.map((p) => p.sourceCatalogId)
    if (ids.length === 0) {
      setResolved([])
      return
    }
    let cancelled = false
    getCatalogProblemsByIds(ids)
      .then((map) => {
        if (cancelled) return
        // Preserve the saved order (newest-added first).
        const ordered = saved
          .map((p) => map.get(p.sourceCatalogId))
          .filter((p): p is CatalogProblem => p !== undefined)
        setResolved(ordered)
      })
      .catch(() => {
        if (!cancelled) setResolved([])
      })
    return () => {
      cancelled = true
    }
  }, [saved])

  const angles = useMemo(
    () => [...new Set(resolved.map((p) => p.angle))].sort((a, b) => a - b),
    [resolved],
  )
  const [angleFilter, setAngleFilter] = useState<number | 'all'>('all')
  // Reset the filter if it names an angle no longer present.
  useEffect(() => {
    if (angleFilter !== 'all' && !angles.includes(angleFilter)) setAngleFilter('all')
  }, [angles, angleFilter])

  const displayed = useMemo(
    () => (angleFilter === 'all' ? resolved : resolved.filter((p) => p.angle === angleFilter)),
    [resolved, angleFilter],
  )

  const { favoriteIds } = useFavorites()
  const showThumbnails = useShowPreviews()
  // Logged sends → the green sent check on rows + detail (iOS parity), mirroring
  // CatalogScreen. Board-scoped to this list's board; attempts (sent === false) excluded.
  const { ascents } = useEnsureAscentsLoaded()
  const sentIds = useMemo(
    () =>
      new Set(
        ascents
          .filter((a) => a.sent && a.boardLayoutId === board?.layoutId && a.sourceCatalogId)
          .map((a) => a.sourceCatalogId as string),
      ),
    [ascents, board?.layoutId],
  )
  const [openId, setOpenId] = useState<string | null>(null)
  const current = openId ? displayed.find((p) => p.source_catalog_id === openId) : undefined

  function handleRemove(catalogId: string, name: string) {
    if (!list) return
    const boardLayoutId = list.boardLayoutId
    void removeProblem(listId, catalogId)
      .then(() => {
        // Removal is a tombstone, so Undo revives the same row via addProblem's
        // explicit-revive path (KTD8) — no new membership id, no duplicate.
        toast(`Removed ${name}`, {
          action: {
            label: 'Undo',
            onClick: () =>
              void addProblem(listId, catalogId, boardLayoutId).catch((e) =>
                toast.error(`Could not restore ${name}.`, {
                  description: e instanceof Error ? e.message : undefined,
                }),
              ),
          },
        })
      })
      .catch((e) =>
        toast.error(`Could not remove ${name}.`, {
          description: e instanceof Error ? e.message : undefined,
          action: { label: 'Retry', onClick: () => void removeProblem(listId, catalogId) },
        }),
      )
  }

  const header = list && (
    <div className="mb-3 px-1">
      <h1 className="text-lg font-bold tracking-tight">{list.name}</h1>
      <p className="text-xs text-muted-foreground">{boardShortLabel(board?.name ?? '')}</p>
    </div>
  )

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isRestoring || (dataStatus === 'loading' && lists.length === 0)) {
    return (
      <div className="flex flex-1 flex-col px-3" data-testid="list-detail-screen">
        <Skeleton className="mb-3 h-8 w-40" />
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    )
  }

  // ── Not found / not a member (RLS-empty) ────────────────────────────────────
  if (!list) {
    return (
      <div className="flex flex-1 flex-col px-3" data-testid="list-detail-screen">
        <div className="mt-10 rounded-lg border border-dashed border-border p-6 text-center">
          <h2 className="text-sm font-semibold">List not found</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            This list doesn’t exist or isn’t shared with your account.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col px-3" data-testid="list-detail-screen">
      {header}

      {angles.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by angle">
          <AnglePill label="All" active={angleFilter === 'all'} onClick={() => setAngleFilter('all')} />
          {angles.map((a) => (
            <AnglePill
              key={a}
              label={`${a}°`}
              active={angleFilter === a}
              onClick={() => setAngleFilter(a)}
            />
          ))}
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
          <h2 className="text-sm font-semibold">
            {loading ? 'Loading…' : resolved.length === 0 ? 'No problems in this list yet' : 'None at this angle'}
          </h2>
          {!loading && resolved.length === 0 && (
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              Open a problem and use the save-to-list button to add it here.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {displayed.map((p) => (
            <div key={p.source_catalog_id} className="flex items-center">
              <div className="min-w-0 flex-1">
                <CatalogRow
                  problem={p}
                  board={board!}
                  isSent={sentIds.has(p.source_catalog_id)}
                  showThumbnail={showThumbnails}
                  onSelect={() => setOpenId(p.source_catalog_id)}
                />
              </div>
              {angles.length > 1 && (
                <span className="shrink-0 px-1 text-xs tabular-nums text-muted-foreground">{p.angle}°</span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${p.name}`}
                className="mr-1 shrink-0"
                onClick={() => handleRemove(p.source_catalog_id, p.name)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Drawer open={current !== undefined} onOpenChange={(open) => !open && setOpenId(null)} showSwipeHandle>
        <DrawerContent>
          <DrawerTitle className="sr-only">Problem details</DrawerTitle>
          <div className="max-h-[85vh] overflow-y-auto px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {current && board && (
              <ProblemDetail
                problem={current}
                displayed={displayed}
                board={board}
                angle={current.angle}
                favoriteIds={favoriteIds}
                sentIds={sentIds}
                onNavigate={(id) => setOpenId(id)}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function AnglePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
