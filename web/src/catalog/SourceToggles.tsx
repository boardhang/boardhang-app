// The source facet's picker (R8/R16): "Mine" | "Community", mutually exclusive. Shared by the
// filter sheet's section and the pinned control's popover so the two surfaces can't drift —
// the same reason MemberStatusRow is one component for the sheet and the popover.
//
// Tapping the selected value clears the facet (the toggles behave like a radio group you can
// deselect), which is the only way to get back to "both" without opening the sheet's Clear.

import { SOURCE_KEYS, SOURCE_LABELS, type SourceFacet } from './filters'
import { Toggle } from '@/components/ui/toggle'

interface SourceTogglesProps {
  value: SourceFacet | null
  onChange: (next: SourceFacet | null) => void
  /** Definitively signed out — "Mine" can't match anything, so it's offered but inert. */
  signedOut?: boolean
  /** Id of the sign-in hint, described by the disabled "Mine" toggle. */
  hintId?: string
}

export function SourceToggles({ value, onChange, signedOut = false, hintId }: SourceTogglesProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SOURCE_KEYS.map((key) => {
        const disabled = signedOut && key === 'mine'
        return (
          <Toggle
            key={key}
            variant="outline"
            size="sm"
            pressed={value === key}
            disabled={disabled}
            aria-describedby={disabled ? hintId : undefined}
            onPressedChange={(on) => onChange(on ? key : null)}
          >
            {SOURCE_LABELS[key]}
          </Toggle>
        )
      })}
    </div>
  )
}
