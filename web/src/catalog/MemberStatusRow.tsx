// One row of Sent / Attempted / Not-logged chips, for a single member's ascent status.
// Extracted from FilterControls so the Filters sheet can render one row per session member
// (self first) — or a single self row when there is no active session. The three chips are
// an accessible group named for whose status they are, so a screen reader announces e.g.
// "Alice's ascent status, Sent, not pressed". In a session the row is led by the member's
// avatar (initials), with the member's name (or "You") on hover.

import { MemberAvatar } from '../sessions/MemberAvatar'
import { STATUS_KEYS, STATUS_LABELS, type StatusKey } from './filters'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/** Row interaction state — distinct from a generic `disabled` so the UI can tell a
 *  loading projection (chips inert, aria-busy) apart from a signed-out gate (chips inert,
 *  sign-in hint) apart from a ready row. */
export type MemberRowState = 'loading' | 'ready' | 'signed-out'

interface MemberStatusRowProps {
  /** Whose row this is (e.g. "You", "Alice") — the avatar's hover tooltip + accessible name. */
  label?: string
  /** Member initials for the avatar. When set, the row is led by the member avatar. */
  initials?: string
  /** Accessible name for the chip group (e.g. "Your ascent status"). */
  ariaLabel: string
  selected: StatusKey[]
  onToggle: (k: StatusKey, active: boolean) => void
  rowState: MemberRowState
  /** id of a sign-in hint the disabled chips describe (signed-out only). */
  hintId?: string
  /** Mark the self row for a subtle visual distinction. */
  isSelf?: boolean
}

export function MemberStatusRow({
  label,
  initials,
  ariaLabel,
  selected,
  onToggle,
  rowState,
  hintId,
  isSelf,
}: MemberStatusRowProps) {
  const interactive = rowState === 'ready'
  return (
    <div className="flex items-center gap-2" role="group" aria-label={ariaLabel} aria-busy={rowState === 'loading'}>
      {initials && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={<span className="inline-flex shrink-0" aria-label={label} />}
            >
              <MemberAvatar initials={initials} isSelf={isSelf} />
            </TooltipTrigger>
            {label && <TooltipContent>{label}</TooltipContent>}
          </Tooltip>
        </TooltipProvider>
      )}
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
          >
            {STATUS_LABELS[k]}
          </Toggle>
        ))}
      </div>
    </div>
  )
}
