// The top of both add-board steps: a back arrow, the progress indicator, and the
// step's question as the page heading.

import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STEPS = 2

interface AddBoardHeaderProps {
  /** 1-based step number. */
  step: 1 | 2
  title: string
  onBack: () => void
}

export function AddBoardHeader({ step, title, onBack }: AddBoardHeaderProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <div aria-hidden className="flex flex-1 gap-1">
          {Array.from({ length: STEPS }, (_, i) => (
            <div key={i} className={cn('h-1 flex-1 rounded-full', i < step ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>
        <span className="w-10 text-right text-xs text-muted-foreground">
          {step} of {STEPS}
        </span>
      </div>
      <h1 className="text-2xl font-semibold">{title}</h1>
    </>
  )
}
