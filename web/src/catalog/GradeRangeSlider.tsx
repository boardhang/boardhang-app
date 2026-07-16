// The dual-thumb grade-range control, shared by the sticky header (always visible,
// above the list) and the filter sheet so both stay identical and read/write the same
// `gradeRange`. Ordinal [min, max] into FONT_GRADES; `value = null` means the full span
// (no filter). The endpoint labels flank the slider and track the drag live.
//
// Commit-on-release: the handles + labels follow the drag via local `draft` state, but the
// list (URL) only updates on release (onValueCommitted) — so dragging above a visible list
// doesn't re-filter on every pixel. `onCommit` collapses a full-span selection back to null
// (the "no grade filter" convention shared with catalogSearch/activeFilterChips).

import { useEffect, useState } from 'react'
import { FONT_GRADES } from '../board/grades'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

interface GradeRangeSliderProps {
  /** Committed range as ordinal [min, max], or null = full span (no filter). */
  value: [number, number] | null
  /** The slab's actual grade span [min, max] — the slider's bounds. */
  span: [number, number]
  /** Fires on release with the new range, or null when it equals the full span. */
  onCommit: (next: [number, number] | null) => void
  className?: string
}

export function GradeRangeSlider({ value, span, onCommit, className }: GradeRangeSliderProps) {
  const [lo, hi] = value ?? span
  // Local draft so the thumbs + endpoint labels track the drag live while the list
  // (URL) only updates on release. Re-sync when the committed range changes from
  // elsewhere — the other slider instance, or the header's clear-grade pill.
  const [draft, setDraft] = useState<[number, number]>([lo, hi])
  useEffect(() => {
    setDraft([lo, hi])
  }, [lo, hi])

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
        {FONT_GRADES[draft[0]]}
      </span>
      <Slider
        aria-label="Grade range"
        min={span[0]}
        max={span[1]}
        step={1}
        value={[draft[0], draft[1]]}
        onValueChange={(v) => {
          const [lo, hi] = v as number[]
          setDraft([lo, hi])
        }}
        onValueCommitted={(v) => {
          const [lo, hi] = v as number[]
          onCommit(lo === span[0] && hi === span[1] ? null : [lo, hi])
        }}
        className="flex-1"
      />
      <span className="w-9 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {FONT_GRADES[draft[1]]}
      </span>
    </div>
  )
}
