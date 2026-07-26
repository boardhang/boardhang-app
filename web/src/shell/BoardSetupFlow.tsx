// Adding a board and configuring one, in a single surface.
//
// Adding is *guided*: pick the layout, set the angle, choose which hold sets are actually
// installed — one decision per step, with the board art updating as you go, and nothing
// written until the last step is confirmed. Abandoning halfway leaves no trace.
//
// Configuring an existing board is not stepped: you already know what you came to change,
// so its controls sit on one screen. A board someone else owns shows its definition as
// read-only, because that definition is a fact about their wall, not a preference.

import { useEffect, useRef, useState } from 'react'
import { BOARDS, defaultAngle, hasAngleChoice, type CatalogBoardDef } from '../board/boards'
import {
  canSetAngle,
  canSetHoldSets,
  instanceName,
  isSharedInstance,
  type BoardInstance,
} from '../board/boardInstance'
import {
  addBoard,
  demoteInstanceToLocal,
  getActiveHoldSetsRaw,
  getAngle,
  instanceByLayoutId,
  removeBoard,
  setActiveHoldSetsRaw,
  setAngle,
} from '../board/boardStore'
import {
  activeCsv,
  holdSetContext,
  visibleSetIds,
  type HoldSetContext,
} from '../board/holdSetMembership'
import { CatalogBoard } from '../board/CatalogBoard'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Toggle } from '@/components/ui/toggle'

/** Height cap for the preview art, so the controls below stay reachable in the sheet. */
const PREVIEW_HEIGHT_CAP = '40vh'

type AddStep = 'layout' | 'angle' | 'holdSets'

interface BoardSetupFlowProps {
  /** The board to configure. Omit to run the guided add flow instead. */
  instance?: BoardInstance
  /** Whether the sharing loop exists yet. False means no share step and no share action. */
  sharingAvailable: boolean
  onClose: () => void
}

export function BoardSetupFlow({ instance, sharingAvailable, onClose }: BoardSetupFlowProps) {
  return (
    <Drawer open onOpenChange={(open) => !open && onClose()} showSwipeHandle>
      <DrawerContent>
        {instance ? (
          <ConfigureBoard instance={instance} onClose={onClose} />
        ) : (
          <AddBoardFlow sharingAvailable={sharingAvailable} onClose={onClose} />
        )}
      </DrawerContent>
    </Drawer>
  )
}

// ─── Guided add ───────────────────────────────────────────────────────────────

function AddBoardFlow({
  sharingAvailable,
  onClose,
}: {
  sharingAvailable: boolean
  onClose: () => void
}) {
  const [step, setStep] = useState<AddStep>('layout')
  const [layout, setLayout] = useState<CatalogBoardDef | null>(null)
  const [angle, setAngle_] = useState<number | null>(null)
  // Installed hold sets, held in component state so abandoning writes nothing. Null until
  // the hold-set step initialises it to "everything installed", the sane starting point.
  const [installed, setInstalled] = useState<Set<number> | null>(null)

  const addable = BOARDS.filter((b) => instanceByLayoutId(b.layoutId) === undefined)
  const heading = useStepFocus(step)

  function pickLayout(next: CatalogBoardDef) {
    setLayout(next)
    setAngle_(defaultAngle(next))
    setInstalled(null)
    // A single-angle board has no angle to choose, so don't ask — it is implicitly fixed
    // at the one angle it bundles.
    setStep(hasAngleChoice(next) ? 'angle' : 'holdSets')
  }

  function finish() {
    if (!layout) return
    addBoard(layout.layoutId)
    const created = instanceByLayoutId(layout.layoutId)
    if (created) {
      if (angle !== null) setAngle(created, angle)
      if (installed !== null) {
        const ctx = holdSetContext(layout.membershipResource, '')
        setActiveHoldSetsRaw(created, activeCsv(installed, ctx.membership))
      }
    }
    onClose()
  }

  if (step === 'layout') {
    return (
      <>
        <DrawerHeader>
          <DrawerTitle ref={heading} tabIndex={-1} className="outline-none">
            Which board do you have?
          </DrawerTitle>
        </DrawerHeader>
        <div className="space-y-2 px-4 pb-8">
          {addable.map((board) => (
            <button
              key={board.layoutId}
              type="button"
              onClick={() => pickLayout(board)}
              className="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent/50"
            >
              <span className="w-10 shrink-0">
                <CatalogBoard board={board} holds={[]} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{board.name}</span>
            </button>
          ))}
          {addable.length === 0 && (
            <p className="text-sm text-muted-foreground">You’ve added every board this app supports.</p>
          )}
        </div>
      </>
    )
  }

  if (layout === null) return null // unreachable: every step past 'layout' has one

  if (step === 'angle') {
    return (
      <>
        <DrawerHeader>
          <DrawerTitle ref={heading} tabIndex={-1} className="outline-none">
            What angle is it set at?
          </DrawerTitle>
        </DrawerHeader>
        <div className="space-y-5 px-4 pb-8">
          <BoardPreview board={layout} />
          <div className="flex gap-1.5">
            {layout.angles.map((a) => (
              <Toggle
                key={a}
                size="sm"
                variant="outline"
                pressed={angle === a}
                onPressedChange={() => setAngle_(a)}
              >
                {a}°
              </Toggle>
            ))}
          </div>
          <StepActions
            onBack={() => setStep('layout')}
            primaryLabel="Next"
            onPrimary={() => setStep('holdSets')}
          />
        </div>
      </>
    )
  }

  // Hold sets — the last step while sharing doesn't exist, so its primary action commits.
  const ctx = holdSetContext(layout.membershipResource, '')
  const current = installed ?? new Set(ctx.filterable)
  return (
    <>
      <DrawerHeader>
        <DrawerTitle ref={heading} tabIndex={-1} className="outline-none">
          Which hold sets are installed?
        </DrawerTitle>
      </DrawerHeader>
      <div className="space-y-5 px-4 pb-8">
        <BoardPreview board={layout} visible={visibleSetIds(current, ctx.membership)} />
        <HoldSetToggles ctx={ctx} installed={current} onChange={setInstalled} />
        <StepActions
          onBack={() => setStep(hasAngleChoice(layout) ? 'angle' : 'layout')}
          primaryLabel="Add board"
          onPrimary={finish}
        />
        {/* The share step lands here once sharing exists; until then the flow ends. */}
        {sharingAvailable && null}
      </div>
    </>
  )
}

// ─── Configure an existing board ──────────────────────────────────────────────

function ConfigureBoard({ instance, onClose }: { instance: BoardInstance; onClose: () => void }) {
  const board = instance.layout
  const angle = getAngle(instance)
  const ctx = holdSetContext(board.membershipResource, getActiveHoldSetsRaw(instance))
  const editableAngle = canSetAngle(instance)
  const editableHoldSets = canSetHoldSets(instance)

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{instanceName(instance)}</DrawerTitle>
      </DrawerHeader>
      <div className="space-y-5 px-4 pb-8">
        <BoardPreview board={board} visible={ctx.visible} />

        {hasAngleChoice(board) && (
          <Field label="Angle">
            {editableAngle ? (
              <div className="flex gap-1.5">
                {board.angles.map((a) => (
                  <Toggle
                    key={a}
                    size="sm"
                    variant="outline"
                    pressed={angle === a}
                    onPressedChange={() => setAngle(instance, a)}
                  >
                    {a}°
                  </Toggle>
                ))}
              </div>
            ) : (
              // The store refuses this write anyway, so state it rather than offering a
              // control that silently does nothing.
              <p className="text-sm">
                {angle}° <span className="text-muted-foreground">— fixed by the board’s owner</span>
              </p>
            )}
          </Field>
        )}

        {ctx.filterable.length > 0 && (
          <Field label="Installed hold sets">
            {editableHoldSets ? (
              <HoldSetToggles
                ctx={ctx}
                installed={ctx.active}
                onChange={(next) => setActiveHoldSetsRaw(instance, activeCsv(next, ctx.membership))}
              />
            ) : (
              <p className="text-sm">
                {[...ctx.active].map((id) => setNameIn(ctx, id)).join(', ')}{' '}
                <span className="text-muted-foreground">— set by the board’s owner</span>
              </p>
            )}
          </Field>
        )}

        {isSharedInstance(instance) && !editableHoldSets && (
          <DetachAction instance={instance} onDone={onClose} />
        )}

        <ConfirmingButton
          idleLabel="Remove board"
          confirmLabel="Confirm — remove this board"
          onConfirm={() => {
            removeBoard(instance.instanceId)
            onClose()
          }}
        />
      </div>
    </>
  )
}

/**
 * Turn a shared board into a plain local one, keeping its current configuration.
 *
 * This exists for the case the automatic path can't reach: signed out or offline, whether
 * the board is still shared with you can't be checked, yet the definition stays locked —
 * which would leave a board you can neither edit nor escape. No network call, by design.
 */
function DetachAction({ instance, onDone }: { instance: BoardInstance; onDone: () => void }) {
  return (
    <div className="space-y-1.5">
      <ConfirmingButton
        idleLabel="Make this my own board"
        confirmLabel="Confirm — stop following the owner’s setup"
        onConfirm={() => {
          demoteInstanceToLocal(instance.instanceId)
          onDone()
        }}
      />
      <p className="text-xs text-muted-foreground">
        Keeps this board and its current setup, but stops following the owner’s changes.
      </p>
    </div>
  )
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

/**
 * Board art, height-capped via an aspect-derived max-width so a tall board letterboxes
 * narrower instead of pushing the controls out of the sheet.
 */
function BoardPreview({ board, visible }: { board: CatalogBoardDef; visible?: Set<number> }) {
  return (
    <div
      className="mx-auto w-full"
      style={{ maxWidth: `calc(${PREVIEW_HEIGHT_CAP} * ${board.geometry.width} / ${board.geometry.height})` }}
    >
      <CatalogBoard board={board} holds={[]} visibleHoldSetIds={visible} />
    </div>
  )
}

function HoldSetToggles({
  ctx,
  installed,
  onChange,
}: {
  ctx: HoldSetContext
  installed: Set<number>
  onChange: (next: Set<number>) => void
}) {
  function toggle(id: number) {
    const next = new Set(installed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (next.size === 0) return // empty means "all installed", so never let it empty
    onChange(next)
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {ctx.filterable.map((id) => (
        <Toggle
          key={id}
          size="sm"
          variant="outline"
          pressed={installed.has(id)}
          disabled={installed.size === 1 && installed.has(id)}
          onPressedChange={() => toggle(id)}
        >
          {setNameIn(ctx, id)}
        </Toggle>
      ))}
    </div>
  )
}

function StepActions({
  onBack,
  primaryLabel,
  onPrimary,
}: {
  onBack: () => void
  primaryLabel: string
  onPrimary: () => void
}) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" className="flex-1" onClick={onBack}>
        Back
      </Button>
      <Button className="flex-1" onClick={onPrimary}>
        {primaryLabel}
      </Button>
    </div>
  )
}

/** A destructive action that needs a second, deliberate tap. */
function ConfirmingButton({
  idleLabel,
  confirmLabel,
  onConfirm,
}: {
  idleLabel: string
  confirmLabel: string
  onConfirm: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <Button
      variant={confirming ? 'destructive' : 'outline'}
      className="w-full"
      onClick={() => (confirming ? onConfirm() : setConfirming(true))}
      onBlur={() => setConfirming(false)}
    >
      {confirming ? confirmLabel : idleLabel}
    </Button>
  )
}

/** Move focus to the new step's heading, so the change is announced rather than silent. */
function useStepFocus(step: string) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [step])
  return ref
}

function setNameIn(ctx: HoldSetContext, id: number): string {
  return ctx.membership.sets.find((s) => s.id === id)?.name ?? `Set ${id}`
}
