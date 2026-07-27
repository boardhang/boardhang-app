// The SOLO self row of Sent / Tried / Not-logged chips in the Filters sheet — used only when no
// collab session targets the board. (In a session the sheet and the pinned nav control both
// render SessionStatusRows instead, which owns its own avatar-and-name member line.) The chips
// are an accessible group named for whose status they are, so a screen reader announces
// "Your ascent status, Sent, not pressed".

import { STATUS_KEYS, STATUS_LABELS, STATUS_SHORT_LABELS, type StatusKey } from './filters'
import { Toggle } from '@/components/ui/toggle'

/** Row interaction state — distinct from a generic `disabled` so the UI can tell a
 *  loading projection (chips inert, aria-busy) apart from a signed-out gate (chips inert,
 *  sign-in hint) apart from a ready row. */
export type MemberRowState = 'loading' | 'ready' | 'signed-out'

interface MemberStatusRowProps {
  /** Accessible name for the chip group (e.g. "Your ascent status"). */
  ariaLabel: string
  selected: StatusKey[]
  onToggle: (k: StatusKey, active: boolean) => void
  rowState: MemberRowState
  /** id of a sign-in hint the disabled chips describe (signed-out only). */
  hintId?: string
}

export function MemberStatusRow({
  ariaLabel,
  selected,
  onToggle,
  rowState,
  hintId,
}: MemberStatusRowProps) {
  const interactive = rowState === 'ready'
  return (
    <div className="flex items-center gap-2" role="group" aria-label={ariaLabel} aria-busy={rowState === 'loading'}>
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_KEYS.map((k) => (
          <Toggle
            key={k}
            variant="outline"
            size="sm"
            disabled={!interactive}
            aria-describedby={rowState === 'signed-out' ? hintId : undefined}
            pressed={selected.includes(k)}
            onPressedChange={(active) => onToggle(k, active)}
            // Shared picker wording (see STATUS_SHORT_LABELS) so this row and the per-member
            // session rows never word an option differently; canonical form on the title.
            title={STATUS_LABELS[k]}
          >
            {STATUS_SHORT_LABELS[k]}
          </Toggle>
        ))}
      </div>
    </div>
  )
}
