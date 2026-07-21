// A two-option public/private selector, shared by onboarding (ProfileSetup) and the one-time
// existing-user notice (PrivacyChoiceNotice). No pre-selected default — the caller starts it at
// null and gates its action on a non-null value, so the choice is always explicit (KTD9).

import { Lock, Globe } from 'lucide-react'

export type Privacy = 'public' | 'private'

export function PrivacyChoice({
  value,
  onChange,
}: {
  value: Privacy | null
  onChange: (v: Privacy) => void
}) {
  return (
    <div role="radiogroup" aria-label="Account privacy" className="flex flex-col gap-2">
      <Option
        selected={value === 'public'}
        onSelect={() => onChange('public')}
        icon={<Globe className="size-4" />}
        title="Public"
        description="Anyone can follow you and see your climbs."
      />
      <Option
        selected={value === 'private'}
        onSelect={() => onChange('private')}
        icon={<Lock className="size-4" />}
        title="Private"
        description="You approve each follower before they see your climbs."
      />
    </div>
  )
}

function Option({
  selected,
  onSelect,
  icon,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex items-start gap-3 rounded-lg border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
      }`}
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
