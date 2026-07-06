// Add-to-list sheet, opened from a problem's top-right action cluster. Shows the user's
// lists FOR THIS PROBLEM'S BOARD (KTD-I4), each with a membership checkmark that toggles
// add/remove optimistically, plus a "New list" row that creates a board-bound list and
// immediately saves the current problem into it (R3). Mirrors the LogAscentSheet Drawer
// shell. Sign-out is handled by the caller (ProblemDetail opens SignInDialog and reopens
// this sheet on success — KTD3 resume). Write failures roll back in the store and raise a
// sonner Retry toast (D3).

import { useEffect, useState } from 'react'
import { Bookmark, Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { CatalogBoardDef } from '../board/boards'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import {
  addProblem,
  createList,
  removeProblem,
  subscribeListProblemsChanged,
  useSavedLists,
} from './listsStore'
import { listIdsContaining } from './listsSync'
import { boardShortLabel, trimListName } from './listsTypes'

interface AddToListSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceCatalogId: string
  board: CatalogBoardDef
}

export function AddToListSheet({ open, onOpenChange, sourceCatalogId, board }: AddToListSheetProps) {
  const { lists } = useSavedLists()
  const boardLists = lists.filter((l) => l.boardLayoutId === board.layoutId)

  const [members, setMembers] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  // Keep the membership checkmarks in sync with the cache (initial read + after any
  // mutation nudges the problem cache).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Generation guard: overlapping reads from a burst of notifies can resolve out of
    // order and leave a stale checkmark set — only the latest issued read applies (#3).
    let latest = 0
    const read = () => {
      const seq = ++latest
      listIdsContaining(sourceCatalogId)
        .then((ids) => {
          if (!cancelled && seq === latest) setMembers(ids)
        })
        .catch(() => {
          /* best-effort */
        })
    }
    read()
    const unsub = subscribeListProblemsChanged(read)
    return () => {
      cancelled = true
      unsub()
    }
  }, [open, sourceCatalogId])

  async function toggle(listId: string, isMember: boolean) {
    // Optimistic checkmark; the store owns cache + rollback, and the subscription above
    // reconciles us afterward.
    setMembers((prev) => {
      const next = new Set(prev)
      if (isMember) next.delete(listId)
      else next.add(listId)
      return next
    })
    try {
      if (isMember) await removeProblem(listId, sourceCatalogId)
      else await addProblem(listId, sourceCatalogId, board.layoutId)
    } catch (e) {
      toast.error(isMember ? 'Could not remove from the list.' : 'Could not add to the list.', {
        description: e instanceof Error ? e.message : undefined,
        action: {
          label: 'Retry',
          onClick: () =>
            void (isMember
              ? removeProblem(listId, sourceCatalogId)
              : addProblem(listId, sourceCatalogId, board.layoutId)),
        },
      })
    }
  }

  async function handleCreate() {
    const name = trimListName(newName)
    if (!name || creating) return
    setCreating(true)
    setNewName('')
    try {
      const list = await createList(name, board.layoutId)
      await addProblem(list.id, sourceCatalogId, board.layoutId)
    } catch (e) {
      toast.error('Could not create the list.', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Save to list</DrawerTitle>
          <p className="text-sm text-muted-foreground">{boardShortLabel(board.name)}</p>
        </DrawerHeader>

        <div className="max-h-[60vh] space-y-1 overflow-y-auto px-3 pb-2">
          {boardLists.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <h2 className="text-sm font-semibold">Create your first list</h2>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                Lists are bound to {boardShortLabel(board.name)}.
              </p>
            </div>
          ) : (
            boardLists.map((list) => {
              const isMember = members.has(list.id)
              return (
                <button
                  key={list.id}
                  type="button"
                  aria-pressed={isMember}
                  onClick={() => void toggle(list.id, isMember)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border',
                      isMember ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                    )}
                  >
                    {isMember && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{list.name}</span>
                </button>
              )
            })
          )}
        </div>

        {/* New list — inline name → create + add the current problem. */}
        <form
          className="flex gap-2 border-t border-border px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Plus className="size-4" />
          </span>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New list name"
            aria-label="New list name"
            maxLength={60}
          />
          <Button type="submit" disabled={creating || trimListName(newName).length === 0}>
            <Bookmark className="size-4" />
            Save
          </Button>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
