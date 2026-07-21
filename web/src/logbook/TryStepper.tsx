// The inline "Log try" stepper — a bordered pill `[ − label + ]`, mirroring
// iOS `TryStepper`. Center label: 0 → "Log try", 1 → "1 try", n → "n tries". Minus is
// disabled at 0 so the count never goes negative.

import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TryStepperProps {
  count: number
  onRemove: () => void
  onAdd: () => void
}

export function TryStepper({ count, onRemove, onAdd }: TryStepperProps) {
  const label = count === 0 ? 'Log try' : count === 1 ? '1 try' : `${count} tries`
  const removeDisabled = count === 0

  return (
    <div className="flex h-11 flex-1 items-center justify-between rounded-xl border border-border px-1">
      <button
        type="button"
        aria-label="Remove a try"
        disabled={removeDisabled}
        onClick={onRemove}
        className={cn(
          'flex size-9 items-center justify-center rounded-lg transition-colors',
          removeDisabled ? 'text-muted-foreground/35' : 'text-foreground hover:bg-muted',
        )}
      >
        <Minus className="size-4" />
      </button>
      <span className="text-sm font-medium tabular-nums">{label}</span>
      <button
        type="button"
        aria-label="Log a try"
        onClick={onAdd}
        className="flex size-9 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
