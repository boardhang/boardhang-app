// The Lists index: browse / create / rename / delete your Saved Lists, newest first,
// each labeled with its board and live problem count. Mirrors LogbookScreen's render
// ladder (isRestoring → signed-out card → loading → empty/offline/error → content).
// The list_problems counts come from the offline cache (countListProblems); the store
// is cached-first, so a warm cache paints instantly and only an explicit refresh pulls.

import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { SignInPanel } from '../auth/SignInPanel'
import { boardByLayoutId } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import { useBoardStore } from '../board/boardStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  createList,
  deleteList,
  loadLists,
  refreshLists,
  renameList,
  subscribeListProblemsChanged,
  useSavedLists,
} from './listsStore'
import { countListProblems } from './listsSync'
import { retryAction } from './retryAction'
import { MAX_LIST_NAME, boardShortLabel, trimListName, type SavedList } from './listsTypes'

export function ListsScreen() {
  const { status, isRestoring } = useAuth()
  const { status: dataStatus, lists, error } = useSavedLists()
  const { activeBoard } = useBoardStore()
  const signedIn = status !== 'signedOut'

  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SavedList | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Load on sign-in. The cache reset on sign-out / user switch is owned by AuthProvider
  // (KTD-I9), NOT this screen — so we only ever load here.
  useEffect(() => {
    if (isRestoring) return
    if (signedIn) void loadLists()
  }, [signedIn, isRestoring])

  // Keep the per-list problem counts fresh from the cache (re-read on list changes and
  // whenever a mutation nudges the problem cache).
  useEffect(() => {
    let cancelled = false
    // Generation guard: a burst of notifies can start overlapping count reads that
    // resolve out of order — only the latest issued read applies (#3).
    let latest = 0
    const read = () => {
      const seq = ++latest
      countListProblems()
        .then((m) => {
          if (!cancelled && seq === latest) setCounts(m)
        })
        .catch(() => {
          /* counts are best-effort */
        })
    }
    read()
    const unsub = subscribeListProblemsChanged(read)
    return () => {
      cancelled = true
      unsub()
    }
  }, [lists])

  async function handleCreate() {
    const name = trimListName(newName)
    if (!name) return // blank rejected
    setNewName('')
    // Scope the list to the board the user sees as active (the resolved snapshot
    // board, always one they own) — not the raw stored id, which can lag behind
    // for legacy state and would orphan the list to an un-owned board.
    const boardId = activeBoard.layoutId
    try {
      await createList(name, boardId)
    } catch (e) {
      toast.error('Could not create the list.', {
        description: e instanceof Error ? e.message : undefined,
        action: { label: 'Retry', onClick: retryAction(() => createList(name, boardId)) },
      })
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await refreshLists()
    } finally {
      setRefreshing(false)
    }
  }

  const header = (
    <div className="mb-3 flex items-center justify-between px-1">
      <h1 className="text-lg font-bold tracking-tight">Lists</h1>
      {signedIn && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh lists"
          disabled={refreshing}
          onClick={handleRefresh}
        >
          <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      )}
    </div>
  )

  // ── Signed out ──────────────────────────────────────────────────────────────
  if (!isRestoring && !signedIn) {
    return (
      <div className="flex flex-1 flex-col px-3" data-testid="lists-screen">
        {header}
        <div className="mt-6 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold">Sign in to save lists</h2>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Saved Lists sync with the Boardhang app across your devices.
          </p>
          <SignInPanel hideIntro />
        </div>
      </div>
    )
  }

  // ── Loading (initial) ───────────────────────────────────────────────────────
  if (isRestoring || (dataStatus === 'loading' && lists.length === 0)) {
    return (
      <div className="flex flex-1 flex-col px-3" data-testid="lists-screen">
        {header}
        <div className="mt-2 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col px-3" data-testid="lists-screen">
      {header}

      {/* Create */}
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void handleCreate()
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New list name"
          aria-label="New list name"
          maxLength={MAX_LIST_NAME}
        />
        <Button type="submit" disabled={trimListName(newName).length === 0}>
          Create
        </Button>
      </form>

      {/* Offline (cold pull failed, nothing cached) — distinct from "no lists". */}
      {dataStatus === 'offline' ? (
        <div
          className="mt-6 rounded-lg border border-dashed border-border p-6 text-center"
          data-testid="lists-offline"
        >
          <h2 className="text-sm font-semibold">Can’t reach your lists</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            You’re offline and your lists aren’t cached on this device yet.
          </p>
          <Button className="mt-3" variant="outline" size="sm" onClick={handleRefresh}>
            Retry
          </Button>
        </div>
      ) : lists.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
          <h2 className="text-sm font-semibold">Create your first list</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            Save catalog problems into named lists — projects, warmups, a session plan.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {lists.map((list) => (
            <ListRowItem
              key={list.id}
              list={list}
              count={counts.get(list.id) ?? 0}
              editing={editingId === list.id}
              onStartEdit={() => setEditingId(list.id)}
              onStopEdit={() => setEditingId(null)}
              onDelete={() => setPendingDelete(list)}
            />
          ))}
        </div>
      )}

      {error && dataStatus === 'error' && (
        <p className="mt-4 text-center text-xs text-destructive" role="alert">
          Couldn’t load your lists: {error}
        </p>
      )}

      {/* Delete confirm */}
      <Drawer open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Delete “{pendingDelete?.name}”?</DrawerTitle>
            <p className="text-sm text-muted-foreground">
              This removes the list and its saved problems. This can’t be undone here.
            </p>
          </DrawerHeader>
          <DrawerFooter className="flex-row gap-2 pt-4">
            <DrawerClose render={<Button variant="outline" className="flex-1">Cancel</Button>} />
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => {
                const target = pendingDelete
                setPendingDelete(null)
                if (target) {
                  void deleteList(target.id).catch((e) =>
                    toast.error('Could not delete the list.', {
                      description: e instanceof Error ? e.message : undefined,
                      action: { label: 'Retry', onClick: retryAction(() => deleteList(target.id)) },
                    }),
                  )
                }
              }}
            >
              Delete
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function ListRowItem({
  list,
  count,
  editing,
  onStartEdit,
  onStopEdit,
  onDelete,
}: {
  list: SavedList
  count: number
  editing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onDelete: () => void
}) {
  const board = boardByLayoutId(list.boardLayoutId)
  const label = boardShortLabel(board?.name ?? '')
  const [draft, setDraft] = useState(list.name)

  useEffect(() => {
    if (editing) setDraft(list.name)
  }, [editing, list.name])

  async function save() {
    const name = trimListName(draft)
    onStopEdit()
    if (!name || name === list.name) return
    try {
      await renameList(list.id, name)
    } catch (e) {
      toast.error('Could not rename the list.', {
        description: e instanceof Error ? e.message : undefined,
        action: { label: 'Retry', onClick: retryAction(() => renameList(list.id, name)) },
      })
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Rename ${list.name}`}
          autoFocus
          maxLength={MAX_LIST_NAME}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') onStopEdit()
          }}
        />
        <Button size="icon-sm" aria-label="Save name" onClick={() => void save()}>
          <Check className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Cancel rename" onClick={onStopEdit}>
          <X className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 border-b border-border/50 pr-2 last:border-b-0">
      <Link
        to="/lists/$listId"
        params={{ listId: list.id }}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
      >
        {board && (
          <div className="w-12 shrink-0">
            <CatalogBoard board={board} holds={[]} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{list.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {label} · {count} {count === 1 ? 'problem' : 'problems'}
          </div>
        </div>
      </Link>
      <Button variant="ghost" size="icon-sm" aria-label={`Rename ${list.name}`} onClick={onStartEdit}>
        <Pencil className="size-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${list.name}`} onClick={onDelete}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}
