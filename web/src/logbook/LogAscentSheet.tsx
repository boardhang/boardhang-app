// Sheet for logging a new ascent or editing an existing one — the web mirror of iOS
// `LogAscentSheet`. Opened from the logbook (edit) and from problem detail (new send /
// new attempt). Sends get a random id; unsent same-day attempts get the deterministic
// attempt id so they merge with any existing attempt row (iOS or web).
//
// A send ABSORBS the day's unsent attempt row (target.absorb): the caller folds its
// tries into the seeded count and the sheet soft-deletes the row after saving, so a
// day of tries + a send lands as one logbook entry carrying the total.

import { useEffect, useState } from 'react'
import { Minus, Plus, Star, Trash2 } from 'lucide-react'
import { FONT_GRADES } from '../board/grades'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { attemptId } from './attemptId'
import { createAscent, deleteAscent, updateAscent, useAscents, type Ascent } from './ascents'
import { ascentIdentity } from './problemHistory'
import { localDayKey } from './sessions'

/** What the sheet is operating on. */
export type LogTarget =
  | {
      kind: 'create'
      sourceCatalogId: string | null
      userProblemId?: string | null
      problemName: string
      problemGrade: string
      boardLayoutId: number
      /** Preselect send vs attempt. From problem detail's "Log ascent" this is a send. */
      sent: boolean
      /** Pre-seed the tries stepper (e.g. from the inline try count). Defaults to 1. */
      tries?: number
      /** Same-day unsent attempt row this send absorbs: its tries are already folded
       *  into `tries` by the caller, and the row is soft-deleted after the send saves —
       *  so the day ends up with ONE logbook entry carrying the total. */
      absorb?: { id: string; tries: number }
      /** Tries logged earlier today (absorbed row + inline stepper) — breakdown line. */
      earlierTriesToday?: number
      /** Distinct earlier local days with logged history — context line. */
      priorDays?: number
      /** Any logged history for this problem (drives Flash vs Session flash). */
      hasPriorHistory?: boolean
    }
  | { kind: 'edit'; ascent: Ascent }

interface LogAscentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: LogTarget | null
  /** Called after a successful save (not on cancel), so a caller can clear pending state. */
  onSaved?: () => void
}

/** ISO → local `YYYY-MM-DDTHH:mm` for <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local datetime-local string → ISO (UTC). */
function fromLocalInput(local: string): string {
  return new Date(local).toISOString()
}

export function LogAscentSheet({ open, onOpenChange, target, onSaved }: LogAscentSheetProps) {
  const { ascents } = useAscents()
  const editing = target?.kind === 'edit' ? target.ascent : null
  const problemGrade =
    target?.kind === 'edit' ? target.ascent.problemGrade : (target?.problemGrade ?? '')
  const problemName =
    target?.kind === 'edit' ? target.ascent.problemName : (target?.problemName ?? '')

  const [dateLocal, setDateLocal] = useState('')
  const [votedGrade, setVotedGrade] = useState('')
  const [tries, setTries] = useState(1)
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form each time the sheet opens on a new target.
  useEffect(() => {
    if (!open || !target) return
    setError(null)
    if (target.kind === 'edit') {
      const a = target.ascent
      setDateLocal(toLocalInput(a.date))
      setVotedGrade(a.votedGrade)
      setTries(a.tries)
      setStars(a.stars)
      setComment(a.comment)
      setSent(a.sent)
    } else {
      setDateLocal(toLocalInput(new Date().toISOString()))
      setVotedGrade(target.problemGrade)
      setTries(Math.max(target.tries ?? 1, 1))
      setStars(0)
      setComment('')
      setSent(target.sent)
    }
  }, [open, target])

  if (!target) return null

  const title = editing ? 'Edit log' : sent ? 'Log send' : 'Log attempt'

  // "Flash" is reserved for problems with no logged history at all; a one-try send on
  // a problem tried (or sent) before reads "Session flash". Create targets carry the
  // flag from the caller; edit targets derive it from earlier-dated rows in the store.
  const hasPriorHistory = editing
    ? ascents.some(
        (a) =>
          a.id !== editing.id &&
          ascentIdentity(a) === ascentIdentity(editing) &&
          a.date < editing.date,
      )
    : target.kind === 'create' && (target.hasPriorHistory ?? false)
  const earlierTriesToday = target.kind === 'create' ? (target.earlierTriesToday ?? 0) : 0
  const priorDays = target.kind === 'create' ? (target.priorDays ?? 0) : 0

  async function handleSave() {
    if (!target) return
    setSaving(true)
    setError(null)
    // An attempt has no meaningful voted grade — keep it equal to the problem grade so
    // it never renders a vote arrow (mirrors iOS).
    const resolvedGrade = sent ? votedGrade : problemGrade
    const dateIso = fromLocalInput(dateLocal)
    try {
      if (target.kind === 'edit') {
        await updateAscent(target.ascent.id, {
          date: dateIso,
          votedGrade: resolvedGrade,
          tries,
          stars,
          comment,
          sent,
        })
      } else {
        const id = sent
          ? crypto.randomUUID()
          : await attemptId(ascentIdentity(target), new Date(dateIso))
        await createAscent({
          id,
          date: dateIso,
          sourceCatalogId: target.sourceCatalogId,
          userProblemId: target.userProblemId ?? null,
          problemName: target.problemName,
          problemGrade: target.problemGrade,
          votedGrade: resolvedGrade,
          tries,
          stars,
          comment,
          sent,
          boardLayoutId: target.boardLayoutId,
        })
        if (sent && target.absorb && localDayKey(new Date(dateIso)) === localDayKey(new Date())) {
          // The absorbed tries now live on the send row — drop today's attempt row so
          // the day shows ONE logbook entry. Only when the send still lands on TODAY:
          // the absorb target was captured for today's local day at sheet-open, so a
          // send the user re-dated to another day must not erase today's tries.
          // Best-effort: the send is already saved, and surfacing a cleanup failure
          // would invite a retry that duplicates it.
          await deleteAscent(target.absorb.id).catch(() => {})
        }
      }
      onSaved?.()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      await deleteAscent(editing.id)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <p className="text-sm text-muted-foreground">
            {problemName} · {problemGrade}
          </p>
        </DrawerHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-4 py-3">
          {/* Sent toggle — only when editing (create sets it via the entry point). */}
          {editing && (
            <label className="flex items-center justify-between">
              <span className="text-sm font-medium">Sent</span>
              <input
                type="checkbox"
                checked={sent}
                onChange={(e) => setSent(e.target.checked)}
                className="size-5 accent-primary"
              />
            </label>
          )}

          {sent && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Voted grade</span>
              <Select value={votedGrade} onValueChange={(v) => setVotedGrade(v as string)}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_GRADES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Tries</span>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Fewer tries"
                  disabled={tries <= 1}
                  onClick={() => setTries((t) => Math.max(1, t - 1))}
                >
                  <Minus className="size-4" />
                </Button>
                <span className="min-w-14 whitespace-nowrap text-center text-sm tabular-nums text-muted-foreground">
                  {sent && tries === 1 ? (hasPriorHistory ? 'Session flash' : 'Flash') : tries}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="More tries"
                  disabled={tries >= 99}
                  onClick={() => setTries((t) => Math.min(99, t + 1))}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
            {(earlierTriesToday > 0 || priorDays > 0) && (
              <p className="text-right text-xs text-muted-foreground">
                {earlierTriesToday > 0 &&
                  `Includes ${earlierTriesToday} ${earlierTriesToday === 1 ? 'try' : 'tries'} from earlier today`}
                {earlierTriesToday > 0 && priorDays > 0 && ' · '}
                {priorDays > 0 && `Tried on ${priorDays} earlier day${priorDays === 1 ? '' : 's'}`}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Rating</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  aria-pressed={n <= stars}
                  onClick={() => setStars((s) => (s === n ? 0 : n))}
                >
                  <Star
                    className={n <= stars ? 'size-6 fill-benchmark text-benchmark' : 'size-6 text-muted-foreground'}
                  />
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Comment</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-input/30 px-3 py-2 text-base outline-none md:text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>

          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Date</span>
            <input
              type="datetime-local"
              value={dateLocal}
              max={toLocalInput(new Date().toISOString())}
              onChange={(e) => setDateLocal(e.target.value)}
              className="rounded-md border border-input bg-input/30 px-2.5 py-1.5 text-base outline-none md:text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>

          {editing && (
            <Button
              variant="destructive"
              className="w-full"
              disabled={saving}
              onClick={handleDelete}
            >
              <Trash2 className="size-4" />
              Delete log
            </Button>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DrawerFooter className="flex-row gap-2">
          <DrawerClose
            render={
              <Button variant="outline" className="flex-1" disabled={saving}>
                Cancel
              </Button>
            }
          />
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
