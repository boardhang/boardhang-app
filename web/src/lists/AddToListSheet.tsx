// Add-to-list sheet, opened from a problem's top-right action cluster. Shows the user's
// lists FOR THIS PROBLEM'S BOARD (KTD-I4), each with a membership checkmark that toggles
// add/remove optimistically, plus a "New list" row that creates a board-bound list and
// immediately saves the current problem into it (R3). Mirrors the LogAscentSheet Drawer
// shell. Sign-out is handled by the caller (ProblemDetail opens SignInDialog and reopens
// this sheet on success — KTD3 resume). Write failures roll back in the store and raise a
// sonner Retry toast (D3).

import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bookmark, CalendarDays, Check, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import type { CatalogBoardDef } from '../board/boards'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Toggle } from '@/components/ui/toggle'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import {
  addProblem,
  createList,
  loadLists,
  removeProblem,
  subscribeListProblemsChanged,
  useSavedLists,
} from './listsStore'
import { listIdsContaining } from './listsSync'
import { retryAction } from './retryAction'
import { MAX_LIST_NAME, formatListDate, trimListName } from './listsTypes'

/** Common list names offered as quick-fill pills under the new-list input. */
const NAME_SUGGESTIONS = ['Projects', 'Warmups', 'Ticklist', 'To try'] as const

interface AddToListSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceCatalogId: string
  board: CatalogBoardDef
}

export function AddToListSheet({ open, onOpenChange, sourceCatalogId, board }: AddToListSheetProps) {
  const { status } = useAuth()
  const signedIn = status !== 'signedOut'
  const { lists } = useSavedLists()
  const boardLists = lists.filter((l) => l.boardLayoutId === board.layoutId)

  const [members, setMembers] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  // Synchronous re-entrancy lock for create — the `creating` STATE flips a render later,
  // so a same-tick double-submit (fast double-Enter / autofill+Enter) would pass a
  // `creating`-state guard twice and make two duplicate lists. The ref is read/set
  // synchronously, same as the membership toggle's pendingRef.
  const creatingRef = useRef(false)
  // Date-picker pill: open state + the selected day (defaults to tomorrow, the common
  // "plan the next session" case). Picking a day fills the name field via formatListDate.
  const [dateOpen, setDateOpen] = useState(false)
  const [pickedDate, setPickedDate] = useState<Date>(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 1)
    return d
  })
  // Membership rows with a mutation in flight — blocks a concurrent double-fire and dims
  // the row (BUG B). The ref is the synchronous guard (a second click in the same tick
  // reads it before React re-renders); the state mirror drives the disabled UI.
  const pendingRef = useRef<Set<string>>(new Set())
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  // Hydrate the store when the sheet opens (BUG A). Outside the Lists screens nothing
  // calls loadLists, so opening the sheet from the catalog — the default landing surface —
  // would otherwise show an empty "Create your first list" despite having cloud lists.
  // loadLists is cached-first: instant from IndexedDB when warm, one pull when cold.
  useEffect(() => {
    if (open && signedIn) void loadLists()
  }, [open, signedIn])

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
    // In-flight lock (BUG B): ignore a second toggle for a list whose mutation hasn't
    // settled — a fast double-click would otherwise fire two concurrent adds for the same
    // never-added problem and one loses the partial unique index (23505). The ref check is
    // synchronous, so it catches a same-tick double-fire the optimistic state can't.
    if (pendingRef.current.has(listId)) return
    pendingRef.current.add(listId)
    setPendingIds(new Set(pendingRef.current))
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
          onClick: retryAction(() =>
            isMember
              ? removeProblem(listId, sourceCatalogId)
              : addProblem(listId, sourceCatalogId, board.layoutId),
          ),
        },
      })
    } finally {
      pendingRef.current.delete(listId)
      setPendingIds(new Set(pendingRef.current))
    }
  }

  async function handleCreate() {
    const name = trimListName(newName)
    if (!name || creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    setNewName('')
    // Two distinct failures, two distinct toasts (#7): a create that fails never created
    // the list; a create that succeeds but whose follow-up add fails DID create the list,
    // so the toast must say "couldn't add" (with Retry), not "couldn't create".
    let list
    try {
      list = await createList(name, board.layoutId)
    } catch (e) {
      toast.error('Could not create the list.', {
        description: e instanceof Error ? e.message : undefined,
      })
      creatingRef.current = false
      setCreating(false)
      return
    }
    try {
      await addProblem(list.id, sourceCatalogId, board.layoutId)
    } catch (e) {
      toast.error('List created, but the problem wasn’t added.', {
        description: e instanceof Error ? e.message : undefined,
        action: { label: 'Retry', onClick: retryAction(() => addProblem(list.id, sourceCatalogId, board.layoutId)) },
      })
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle>Save to list</DrawerTitle>
          {/* Only meaningful when there ARE lists to pick — with none, the create form
              below is the whole story, so we drop the description and let its heading
              ("Create your first list") stand alone. */}
          {boardLists.length > 0 && (
            <DrawerDescription>Pick a list to add this problem to.</DrawerDescription>
          )}
        </DrawerHeader>

        {/* The membership list — omitted entirely when this board has no lists yet, so the
            create form isn't double-stacked under an empty-state placeholder. */}
        {boardLists.length > 0 && (
          <div className="max-h-[60vh] space-y-1 overflow-y-auto px-3 pb-2">
            {boardLists.map((list) => {
              const isMember = members.has(list.id)
              const isPending = pendingIds.has(list.id)
              return (
                <div
                  key={list.id}
                  className={cn(
                    'flex items-center rounded-md pr-1 transition-colors hover:bg-accent/50',
                    isPending && 'opacity-60',
                  )}
                >
                  {/* Tapping the row (checkmark + name) toggles membership — the sheet's
                      primary job. */}
                  <button
                    type="button"
                    aria-pressed={isMember}
                    aria-label={isMember ? `Remove from ${list.name}` : `Add to ${list.name}`}
                    disabled={isPending}
                    onClick={() => void toggle(list.id, isMember)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
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
                  {/* The chevron opens the list itself; closing the sheet first so it
                      doesn't linger over the destination route. */}
                  <Link
                    to="/lists/$listId"
                    params={{ listId: list.id }}
                    onClick={() => onOpenChange(false)}
                    aria-label={`Open ${list.name}`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </div>
              )
            })}
          </div>
        )}

        {/* New list — inline name → create + add the current problem. */}
        <form
          className="flex flex-col gap-3 border-t border-border px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
        >
          {/* With no lists yet this form IS the empty state, so it owns the "create your
              first list" heading; once lists exist it's the secondary "or make a new one"
              path below them. */}
          <span className="text-xs font-medium text-muted-foreground">
            {boardLists.length === 0 ? 'Create your first list' : 'Or save to a new list'}
          </span>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New list name"
              aria-label="New list name"
              maxLength={MAX_LIST_NAME}
            />
            <Button type="submit" disabled={creating || trimListName(newName).length === 0}>
              <Bookmark className="size-4" />
              Save
            </Button>
          </div>

          {/* Quick-fill suggestions — a single-select group under the input, built from the
              same shadcn Toggle as MyBoards' hold-set picker. Tapping a pill fills the input
              (doesn't submit) and presses it; tapping the active pill clears it. Typing a
              custom name leaves every pill unpressed. Pills stay visible regardless of input
              so the group reads as a persistent chooser. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Suggestions</span>
            <div className="flex flex-wrap gap-1.5">
              {NAME_SUGGESTIONS.map((s) => {
                const selected = trimListName(newName) === s
                return (
                  <Toggle
                    key={s}
                    size="sm"
                    variant="outline"
                    pressed={selected}
                    onPressedChange={() => setNewName(selected ? '' : s)}
                  >
                    {s}
                  </Toggle>
                )
              })}
              {/* Date pill — a sibling chip whose click opens the shadcn Calendar; picking a
                  day writes a "Tue, Jul 7" name into the field. Pressed while the popover is
                  open so it reads like the other pills. */}
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger
                  render={
                    <Toggle size="sm" variant="outline" pressed={dateOpen} aria-label="Name the list by date">
                      <CalendarDays className="size-4" />
                      Date
                    </Toggle>
                  }
                />
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    required
                    selected={pickedDate}
                    defaultMonth={pickedDate}
                    onSelect={(d) => {
                      setPickedDate(d)
                      setNewName(formatListDate(d))
                      setDateOpen(false)
                    }}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
