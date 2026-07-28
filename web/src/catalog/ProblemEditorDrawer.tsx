// The problem authoring surface: a full-height drawer with a tap grid over the real
// board art. Built on the HoldFilterPicker pattern (plan KTD8) rather than the retired
// BoardGrid — tap targets are children of CatalogBoard, so they share its exact rendered
// box and register with the drawn holds at any aspect ratio, and only positions owned by
// an installed hold set are tappable.
//
// Interaction (KTD8): tapping an empty position cycles the common roles
// start → move (`right`) → end → empty. The brush palette sets an explicit role for the
// beta moves (left / right / match); with a brush active a tap assigns that role, and
// tapping a hold that already carries it removes it. Every target's aria-label names its
// position and current role — a five-state control can't be conveyed by aria-pressed.
//
// Light-up sends BLE directly and deliberately does NOT call `reportProblemLit`
// (KTD9/R3/AE5): an unsaved draft must never become a session's shared "on the wall"
// problem. The draft persists to localStorage on every change (KTD10) so it survives a
// reload at the wall.
//
// Save (R4/R5/AE1) collects name, grade and visibility in a sheet over the board. Signed
// out, the tap opens the SignInDialog and remembers the intent — the useAddToList resume
// pattern, but persisted rather than in-memory, because Google OAuth takes the whole page
// away and an in-memory flag doesn't survive that.
//
// Two modes, one component: a new draft (persisted, keyed by board+angle) and an edit of an
// already-saved problem (`editing`). An edit session is deliberately NOT persisted — see
// `persistDraft` below.

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'
import { bleClient, connectBoard, isConnected, setBleError, useBle } from '../ble/useBle'
import { describeBleError } from '../ble/moonboard'
import { useAuth } from '../auth/AuthProvider'
import { SignInDialog } from '../auth/SignInDialog'
import { getActiveHoldSetsRaw, getFlipped } from '../board/boardStore'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import { columnLabel } from '../board/geometry'
import { DEFAULT_GRADE, FONT_GRADES, GRADE_FILTER_FLOOR } from '../board/grades'
import { holdSetContext, setIdAt } from '../board/holdSetMembership'
import { center } from '../board/renderGeometry'
import { holdColor, holdLabel, type HoldType } from '../types'
import {
  clearDraft,
  readDraft,
  readSaveIntent,
  writeDraft,
  writeSaveIntent,
  type ProblemDraft,
  type Visibility,
} from './problemDraftStore'
import { createUserProblem, updateUserProblem } from './userProblemsStore'
import type { UserProblem } from './userProblemsTypes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Tap-target diameter as a fraction of a column's span — matches CatalogBoard's
 *  marker size so the target sits right on the drawn hold. */
const TARGET_COLUMN_RATIO = 0.9

/** The common-role tap cycle, matching the retired BuildScreen's: an empty position
 *  walks start → move → end → empty without ever touching the palette. */
const CYCLE: (HoldType | null)[] = [null, 'start', 'right', 'end']

/** Roles the palette paints. The cycle already reaches start and end; the palette exists
 *  for the beta moves, which have no place in a three-step cycle (KTD8). */
const BRUSH_ROLES: HoldType[] = ['left', 'right', 'match']

/** Grades an author can pick, floored at 6A+ like every other grade surface (issue #96). */
const AUTHORABLE_GRADES = FONT_GRADES.slice(GRADE_FILTER_FLOOR)

/** The Select's value→label map. base-ui renders the closed trigger from this, not from the
 *  open list's items — without it the trigger shows the raw value. */
const GRADE_LABELS: Record<string, string> = Object.fromEntries(
  AUTHORABLE_GRADES.map((g) => [g, g]),
)

/** Matches the `name` column's length in migration 0018. */
const MAX_NAME = 60

const VISIBILITIES: { value: Visibility; label: string }[] = [
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Public' },
]

function nextInCycle(current: HoldType | null): HoldType | null {
  const i = CYCLE.findIndex((t) => t === current)
  return CYCLE[(i + 1) % CYCLE.length]
}

/** The draft an edit session starts from — the saved row as the editor's working shape. */
function draftFrom(problem: UserProblem): ProblemDraft {
  return {
    holds: problem.holds,
    name: problem.name,
    grade: problem.grade,
    visibility: problem.visibility,
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface Pos {
  col: number
  row: number
  x: number
  y: number
}

interface ProblemEditorDrawerProps {
  board: CatalogBoardDef
  /** The slab's resolved angle — inherited from the URL, shown in the header, and part
   *  of the draft's storage key. */
  angle: number
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The already-saved problem being edited (`?edit=<id>`); omitted for a new draft. */
  editing?: UserProblem
  /** A save landed — the caller navigates to the problem's detail (R5). */
  onSaved: (sourceCatalogId: string) => void
}

type Busy = 'connecting' | 'sending' | null

export function ProblemEditorDrawer({
  board,
  angle,
  open,
  onOpenChange,
  editing,
  onSaved,
}: ProblemEditorDrawerProps) {
  const g = board.geometry
  const { state, error: connectionError } = useBle()
  const { status: authStatus, profile } = useAuth()
  const signedIn = authStatus !== 'signedOut'
  // AE3, client side: publishing needs a handle to attribute the problem to. The server
  // backstop is a later unit; this is the affordance, not the enforcement.
  const canPublish = Boolean(profile?.handle)

  // An edit session is in-memory only. The persisted draft is keyed by board+angle, so
  // writing an edit through it would clobber whatever new problem the author had parked on
  // that slab — and a stale persisted edit could later resurrect over a row that changed on
  // another device. An edit's durable copy is the saved row itself; reopening `?edit=<id>`
  // restores it.
  const persistDraft = editing === undefined
  const [draft, setDraft] = useState<ProblemDraft>(() =>
    editing ? draftFrom(editing) : readDraft(board.layoutId, angle),
  )
  const [brush, setBrush] = useState<HoldType | null>(null)
  // Dirty *since open* (KTD10): a restored draft alone must not demand a discard
  // confirmation — only edits made in this sitting do. In edit mode the state starts at the
  // loaded snapshot, so the same flag means "differs from what was loaded".
  const [dirty, setDirty] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)

  // ── Save sheet + sign-in gate (R4/AE1) ──────────────────────────────────────
  const [saveOpen, setSaveOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  // The pending save. Seeded from localStorage so it survives the OAuth full-page redirect;
  // it stays *pending* rather than opening the sheet outright because a real remount starts
  // signed out and restores the session a tick later.
  const [resume, setResume] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Restore on open (and on a board/angle/target switch), which is also the mount path when
  // the editor opens straight from a `?new=1` / `?edit=<id>` deep link.
  useEffect(() => {
    if (!open) return
    setDraft(editing ? draftFrom(editing) : readDraft(board.layoutId, angle))
    setBrush(null)
    setDirty(false)
    setSendError(null)
    setSaveError(null)
    setSaveOpen(false)
    setResume(editing === undefined && readSaveIntent(board.layoutId, angle))
  }, [open, board.layoutId, angle, editing])

  // The resume itself: once a session is present the sheet opens on the restored draft.
  useEffect(() => {
    if (signedIn && resume) {
      setResume(false)
      setSaveOpen(true)
    }
  }, [signedIn, resume])

  const { membership, active, visible } = useMemo(
    () => holdSetContext(board.membershipResource, getActiveHoldSetsRaw(board.layoutId)),
    [board],
  )

  // Tappable positions: those owned by an installed hold set. A board with no bundled
  // membership map allows every grid position — the same fail-open `isClimbable` takes,
  // so an unmapped board stays fully authorable rather than becoming untappable.
  const positions = useMemo<Pos[]>(() => {
    const noMembership = Object.keys(membership.membership).length === 0
    const out: Pos[] = []
    for (let col = 0; col < g.numColumns; col++) {
      for (let row = 1; row <= g.rowTop; row++) {
        if (!noMembership) {
          const id = setIdAt(membership, col, row)
          if (id === undefined || !active.has(id)) continue
        }
        const { x, y } = center(g, col, row)
        out.push({ col, row, x, y })
      }
    }
    return out
  }, [g, membership, active])

  const roleAt = useMemo(() => {
    const map = new Map<string, HoldType>()
    for (const h of draft.holds) map.set(`${h.c}-${h.r}`, h.t)
    return map
  }, [draft.holds])

  const targetPct = ((1 - g.leftMargin - g.rightMargin) / g.numColumns) * TARGET_COLUMN_RATIO * 100

  /** The one write path for the draft: state, dirty flag, and (create mode) localStorage.
   *  Every field rides it, so name/grade/visibility are as reload-proof as the holds. */
  function update(patch: Partial<ProblemDraft>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    setDirty(true)
    if (persistDraft) writeDraft(board.layoutId, angle, next)
  }

  function tap(col: number, row: number) {
    const current = roleAt.get(`${col}-${row}`) ?? null
    // With a brush down the tap is an assignment; tapping the brush's own role lifts it
    // again, so the palette can both paint and erase without a separate eraser mode.
    const next = brush ? (current === brush ? null : brush) : nextInCycle(current)
    if (next === null) {
      update({ holds: draft.holds.filter((h) => !(h.c === col && h.r === row)) })
      return
    }
    // Replace in place when the position already had a role, so re-roling a hold doesn't
    // reorder the draft under the author.
    update({
      holds:
        current === null
          ? [...draft.holds, { c: col, r: row, t: next }]
          : draft.holds.map((h) => (h.c === col && h.r === row ? { ...h, t: next } : h)),
    })
  }

  function requestClose() {
    if (dirty) {
      setConfirmingDiscard(true)
      return
    }
    closeEditor()
  }

  /** Leave the editor, dropping any pending save so an unrelated later sign-in can't
   *  resurrect the sheet. In create mode the draft itself stays parked. */
  function closeEditor() {
    if (persistDraft) writeSaveIntent(board.layoutId, angle, false)
    setResume(false)
    setSignInOpen(false)
    setSaveOpen(false)
    onOpenChange(false)
  }

  function discard() {
    if (persistDraft) {
      clearDraft(board.layoutId, angle)
      setDraft(readDraft(board.layoutId, angle))
    } else if (editing) {
      // An edit discards back to the saved row, which is untouched — nothing to clear.
      setDraft(draftFrom(editing))
    }
    setDirty(false)
    setConfirmingDiscard(false)
    closeEditor()
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  /** The Save button. Signed out on a new problem, this is a sign-in prompt that remembers
   *  what it was for (AE1); an edit is only ever reached by its owner, so it goes straight
   *  through. */
  function requestSave() {
    setSaveError(null)
    if (persistDraft) writeSaveIntent(board.layoutId, angle, true)
    if (persistDraft && !signedIn) {
      setResume(true)
      setSignInOpen(true)
      return
    }
    setSaveOpen(true)
  }

  function closeSaveSheet() {
    setSaveOpen(false)
    setSaveError(null)
    if (persistDraft) writeSaveIntent(board.layoutId, angle, false)
  }

  async function save() {
    if (saving || !trimmedName) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = editing
        ? await updateUserProblem(editing.sourceCatalogId, {
            name: trimmedName,
            grade,
            holds: draft.holds,
          })
        : await createUserProblem({
            layoutId: board.layoutId,
            angle,
            name: trimmedName,
            grade,
            holds: draft.holds,
            visibility: draft.visibility,
          })
      // Only now is the draft expendable: a failed save leaves it parked for a retry.
      if (persistDraft) clearDraft(board.layoutId, angle)
      setDirty(false)
      closeEditor()
      onSaved(saved.sourceCatalogId)
    } catch (err) {
      // Inline, beside the button that failed — the author stays in the sheet and retries.
      setSaveError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  // Direct BLE send, connect-if-needed — modeled on useLightUp but WITHOUT its session
  // pointer write (KTD9). Failures read inline here rather than as a toast: the editor is
  // a working surface the author stays on, so the error belongs beside the button.
  async function lightUp() {
    if (busy) return
    setSendError(null)
    setBleError(null)
    if (!isConnected()) {
      setBusy('connecting')
      await connectBoard()
      if (!isConnected()) {
        setBusy(null)
        return // cancelled, or the connection error is already in the shared BLE state
      }
    }
    setBusy('sending')
    try {
      await bleClient.send(
        draft.holds.map((h) => ({ col: h.c, row: h.r, type: h.t })),
        { rows: g.numRows, flipped: getFlipped(board.layoutId), showBeta: true },
      )
    } catch (err) {
      setSendError(describeBleError(err))
    } finally {
      setBusy(null)
    }
  }

  const shownError = sendError ?? connectionError
  const holdCount = draft.holds.length
  const holdSummary = `${holdCount} hold${holdCount === 1 ? '' : 's'}`
  const trimmedName = draft.name.trim()
  // A draft carries no grade until the author opens the sheet; 6A+ (the scale's filter
  // floor) is the offered default rather than a blank the Select can't render.
  const grade = draft.grade || DEFAULT_GRADE
  const title = editing ? 'Edit problem' : 'New problem'

  return (
    <>
      <Drawer open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())} showSwipeHandle>
        {/* Nearly full-height so the whole board is visible without scrolling — the
            author needs every row reachable in one view. */}
        <DrawerContent style={{ '--drawer-height': 'calc(100dvh - 4rem)' } as CSSProperties}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
              <div className="min-w-0">
                <DrawerTitle>{title}</DrawerTitle>
                <div className="truncate text-xs text-muted-foreground">
                  {board.name} · {angle}°
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={holdCount === 0}
                  onClick={() => update({ holds: [] })}
                >
                  Clear
                </Button>
                <Button variant="ghost" size="sm" onClick={requestClose}>
                  Cancel
                </Button>
              </div>
            </div>

            {/* Role palette. No brush = the tap cycle; a brush paints its role directly. */}
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 pb-3">
              <Button
                variant={brush === null ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={brush === null}
                onClick={() => setBrush(null)}
              >
                Cycle
              </Button>
              {BRUSH_ROLES.map((role) => (
                <Button
                  key={role}
                  variant={brush === role ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-label={`${holdLabel[role]} brush`}
                  aria-pressed={brush === role}
                  className="gap-2"
                  onClick={() => setBrush(brush === role ? null : role)}
                >
                  <span
                    aria-hidden
                    className="size-3 rounded-full border"
                    style={{ backgroundColor: `${holdColor[role]}59`, borderColor: holdColor[role] }}
                  />
                  {holdLabel[role]}
                </Button>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3">
              {/* Height-driven so every row stays visible; width follows the aspect ratio.
                  The tap targets are children of CatalogBoard, so they share its exact
                  rendered box and stay aligned on any board aspect ratio. */}
              <div
                className="flex h-full max-w-full items-center justify-center"
                style={{ aspectRatio: `${g.width} / ${g.height}` }}
              >
                <CatalogBoard board={board} holds={draft.holds} showBeta visibleHoldSetIds={visible}>
                  {positions.map(({ col, row, x, y }) => {
                    const role = roleAt.get(`${col}-${row}`) ?? null
                    return (
                      <button
                        key={`${col}-${row}`}
                        type="button"
                        aria-label={`${columnLabel(col)}${row}, ${role ? `${holdLabel[role].toLowerCase()} hold` : 'empty'}`}
                        onClick={() => tap(col, row)}
                        className="absolute rounded-full"
                        style={{
                          left: `${x * 100}%`,
                          top: `${y * 100}%`,
                          width: `${targetPct}%`,
                          aspectRatio: '1',
                          transform: 'translate(-50%, -50%)',
                          // Transparent but hit-testable: the role marker itself is drawn
                          // by CatalogBoard underneath.
                          backgroundColor: 'transparent',
                        }}
                      />
                    )
                  })}
                </CatalogBoard>
              </div>
            </div>

            {shownError && (
              <p className="shrink-0 px-4 pt-2 text-center text-xs text-destructive" role="alert">
                {shownError}
              </p>
            )}

            <div className="shrink-0 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <p className="pb-2 text-center text-xs text-muted-foreground">
                {holdCount === 0 ? 'Tap holds to build your problem' : holdSummary}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={holdCount === 0 || busy !== null}
                  onClick={() => void lightUp()}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {busy === 'connecting' ? 'Connecting…' : busy === 'sending' ? 'Sending…' : 'Light up'}
                </Button>
                <Button className="flex-1" disabled={holdCount === 0} onClick={requestSave}>
                  Save
                </Button>
              </div>
              {state !== 'connected' && (
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  Light up connects to your board first.
                </p>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* The save sheet. A dialog over the board rather than a nested drawer: the board
          stays put behind it, so the author can read what they drew while naming it. */}
      <Dialog open={saveOpen} onOpenChange={(next) => !next && closeSaveSheet()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Save changes' : 'Save problem'}</DialogTitle>
            <DialogDescription>
              {board.name} · {angle}° · {holdSummary}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="problem-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="problem-name"
                value={draft.name}
                maxLength={MAX_NAME}
                autoComplete="off"
                placeholder="Name your problem"
                // text-base on mobile so iOS doesn't zoom the page on focus.
                className="text-base md:text-sm"
                // maxLength stops typing past the limit; the slice also covers a paste and
                // a draft restored from an older/hand-edited entry.
                onChange={(e) => update({ name: e.target.value.slice(0, MAX_NAME) })}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Grade</span>
              <Select
                items={GRADE_LABELS}
                value={grade}
                onValueChange={(v) => update({ grade: v as string })}
              >
                <SelectTrigger aria-label="Grade" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTHORABLE_GRADES.map((gr) => (
                    <SelectItem key={gr} value={gr}>
                      {gr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Visibility is set once, at authoring time; changing it later belongs to the
                problem's own screen, so an edit doesn't repeat the choice here. */}
            {!editing && (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Visibility</span>
                <div className="flex gap-2">
                  {VISIBILITIES.map(({ value, label }) => (
                    <Button
                      key={value}
                      type="button"
                      variant={draft.visibility === value ? 'secondary' : 'outline'}
                      className="flex-1"
                      aria-pressed={draft.visibility === value}
                      disabled={value === 'public' && !canPublish}
                      onClick={() => update({ visibility: value })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {!canPublish && (
                  <p className="text-xs text-muted-foreground">
                    Pick a handle in your profile to share problems with other climbers.
                  </p>
                )}
              </div>
            )}

            {saveError && (
              <p className="text-sm text-destructive" role="alert">
                {saveError}
              </p>
            )}
          </div>

          <div className="flex flex-row gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={closeSaveSheet}>
              Back
            </Button>
            <Button
              className="flex-1"
              disabled={saving || trimmedName.length === 0}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editing ? 'Save changes' : 'Save problem'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SignInDialog
        open={signInOpen}
        onOpenChange={(o) => {
          setSignInOpen(o)
          // Dismissed WITHOUT a session: drop the pending save, here and on disk, so a
          // later unrelated sign-in never reopens the sheet on its own.
          if (!o && !signedIn) {
            setResume(false)
            writeSaveIntent(board.layoutId, angle, false)
          }
        }}
        title="Sign in to save your problem"
      />

      <Dialog open={confirmingDiscard} onOpenChange={(next) => !next && setConfirmingDiscard(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Discard your changes?' : 'Discard this problem?'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {editing
              ? 'Your edits will be lost and the saved problem stays as it was.'
              : 'Your placed holds will be lost. This can’t be undone.'}
          </p>
          <div className="flex flex-row gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmingDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" className="flex-1" onClick={discard}>
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
