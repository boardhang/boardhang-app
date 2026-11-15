// Benchmark progress for the Logbook: a ring with the share of the board's benchmarks
// the user has sent. "Show grades" expands one bar per grade (sent of total), hardest
// grade on top; collapsed by default so the Logbook's ascents stay near the top.
//
// Expanded, the card has two modes. "All grades" (the default): the ring and count cover
// every benchmark on the board, while the bars stop at the user's hardest send — the grades
// above it are all empty and would only make the card long. "Custom": a slider that looks
// like the catalog filter's sets a grade range, and the ring, count and bars all follow it.
// The mode and the expanded state are remembered per device, the custom range per board.
//
// Totals come from the cached catalog slab for the board's current angle — a cache read
// only, the Logbook never starts a slab download. With no cached slab (or no benchmarks)
// the card renders nothing.

import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { gradeBadgeCls } from '../board/gradeBadge'
import { FONT_GRADES } from '../board/grades'
import { defaultAngle, hasAngleChoice, type CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle } from '../board/boardStore'
import { holdSetContext, isClimbable } from '../board/holdSetMembership'
import { CATALOG_SEARCH_DEFAULTS, filtersToSearch } from '../catalog/catalogSearch'
import { readSlab, type CatalogProblem } from '../catalog/catalogSync'
import { DEFAULT_FILTERS } from '../catalog/filters'
import {
  benchmarkRows,
  clampRange,
  defaultRange,
  gradeSpan,
  loadExpanded,
  loadMode,
  loadRange,
  rowsInRange,
  saveExpanded,
  saveMode,
  saveRange,
  summarize,
  type GradeRange,
  type RangeMode,
} from './benchmarkProgress'

const RING_RADIUS = 24
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
/** Shortest track, in percent, so a grade with very few benchmarks is still visible. */
const MIN_TRACK = 6

interface Props {
  board: CatalogBoardDef
  /** The user's sent problem ids on this board. */
  sentIds: ReadonlySet<string>
}

const MODES: { value: RangeMode; label: string }[] = [
  { value: 'all', label: 'All grades' },
  { value: 'custom', label: 'Custom' },
]

/** Render with `key={board.layoutId}` so the custom range reloads on a board switch. */
export function BenchmarkProgressCard({ board, sentIds }: Props) {
  const navigate = useNavigate()
  const gradesId = useId()
  const angle = getAngle(board)
  const activeHoldSetsRaw = getActiveHoldSetsRaw(board.layoutId)

  // The slab's benchmarks, tagged with the slab they belong to so a board/angle switch
  // never counts the previous slab's rows while the new one loads.
  const slabKey = `${board.layoutId}_${angle}`
  const [slab, setSlab] = useState<{ key: string; benchmarks: CatalogProblem[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    readSlab(board.layoutId, angle)
      .then((problems) => {
        if (!cancelled) setSlab({ key: slabKey, benchmarks: problems.filter((p) => p.is_benchmark) })
      })
      .catch(() => {
        /* no cache → no card */
      })
    return () => {
      cancelled = true
    }
  }, [board.layoutId, angle, slabKey])

  const allRows = useMemo(() => {
    if (!slab || slab.key !== slabKey) return []
    const { membership, active } = holdSetContext(board.membershipResource, activeHoldSetsRaw)
    return benchmarkRows(slab.benchmarks, sentIds, (holds) => isClimbable(membership, holds, active))
  }, [slab, slabKey, board.membershipResource, activeHoldSetsRaw, sentIds])

  const [expanded, setExpanded] = useState(loadExpanded)
  const [mode, setMode] = useState<RangeMode>(loadMode)
  const [picked, setPicked] = useState<GradeRange | null>(() => loadRange(board.layoutId))

  const span = gradeSpan(allRows)
  const upToHardest = defaultRange(allRows)
  if (!span || !upToHardest) return null

  // A custom range starts out as "up to my hardest send" until the slider is moved.
  const custom = clampRange(picked, span) ?? upToHardest
  const isCustom = mode === 'custom'
  // The bars: the custom range, or only up to the hardest send.
  const rows = rowsInRange(allRows, isCustom ? custom : upToHardest)
  const maxTotal = summarize(rows).maxTotal
  // The ring and count: the custom range, or the whole board.
  const summary = summarize(isCustom ? rows : allRows)
  // Say what a smaller total covers, so it isn't mistaken for the whole board.
  const rangeNote =
    !isCustom || (custom[0] === span[0] && custom[1] === span[1])
      ? ''
      : custom[0] === custom[1]
        ? ` · ${FONT_GRADES[custom[0]]}`
        : ` · ${FONT_GRADES[custom[0]]} to ${FONT_GRADES[custom[1]]}`

  function toggleExpanded() {
    saveExpanded(!expanded)
    setExpanded(!expanded)
  }

  function changeMode(next: RangeMode) {
    saveMode(next)
    setMode(next)
  }

  function changeRange(next: GradeRange) {
    setPicked(next)
    saveRange(board.layoutId, next)
  }

  /** Open the catalog on this grade's benchmarks the user hasn't sent yet. */
  function openUnsent(ordinal: number) {
    void navigate({
      to: '/board/$layoutId/catalog',
      params: { layoutId: String(board.layoutId) },
      search: {
        ...CATALOG_SEARCH_DEFAULTS,
        ...filtersToSearch({
          ...DEFAULT_FILTERS,
          benchmarkOnly: true,
          gradeRange: [ordinal, ordinal],
          statusFilters: ['attempted', 'unlogged'],
        }),
        angle: angle === defaultAngle(board) ? 0 : angle,
      },
    })
  }

  return (
    <section aria-label="Benchmark progress" className="mb-4 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <div
          role="img"
          aria-label={`${summary.percent}% of benchmarks sent`}
          className="relative size-14 shrink-0"
        >
          <svg viewBox="0 0 56 56" className="size-14 -rotate-90" aria-hidden>
            <circle cx="28" cy="28" r={RING_RADIUS} fill="none" strokeWidth="6" className="stroke-muted" />
            {/* Skipped at 0%: a zero-length dash with a round cap would still draw a dot. */}
            {summary.percent > 0 && (
              <circle
                cx="28"
                cy="28"
                r={RING_RADIUS}
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(RING_LENGTH * summary.percent) / 100} ${RING_LENGTH}`}
                className="stroke-primary"
              />
            )}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
            {summary.percent}%
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {hasAngleChoice(board) ? `Benchmarks at ${angle}°` : 'Benchmarks'}
          </h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {summary.sent} of {summary.total} sent
            {rangeNote}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label={expanded ? 'Hide grades' : 'Show grades'}
          aria-expanded={expanded}
          aria-controls={gradesId}
          onClick={toggleExpanded}
        >
          <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} aria-hidden />
        </Button>
      </div>

      {expanded && (
        <div id={gradesId} className="mt-3">
          {span[0] < span[1] && (
            <div className="mb-3 space-y-3">
              <ToggleGroup
                aria-label="Grades shown"
                variant="outline"
                size="sm"
                spacing={0}
                value={[mode]}
                // Single-select base-ui group returns a one-item array; ignore an empty
                // array so the current choice can't be toggled off (one is always chosen).
                onValueChange={(value) => {
                  const next = value[0] as RangeMode | undefined
                  if (next) changeMode(next)
                }}
                className="w-full"
              >
                {MODES.map(({ value, label }) => (
                  <ToggleGroupItem key={value} value={value} className="flex-1 text-xs">
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              {/* Custom: same look as the catalog filter's grade slider. */}
              {isCustom && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Grade</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <span className={gradeBadgeCls}>{FONT_GRADES[custom[0]]}</span>
                      {custom[1] !== custom[0] && (
                        <>
                          <span className="text-xs text-muted-foreground">to</span>
                          <span className={gradeBadgeCls}>{FONT_GRADES[custom[1]]}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="px-0.5">
                    <Slider
                      aria-label="Grade range"
                      min={span[0]}
                      max={span[1]}
                      step={1}
                      value={custom}
                      onValueChange={(value) => {
                        const [lo, hi] = value as number[]
                        changeRange([lo, hi])
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Hardest grade on top, like a pyramid. Track length = this grade's share of the
              largest visible grade; fill = sent / total. */}
          <ul className="space-y-0.5">
            {[...rows].reverse().map((row) => (
              <li key={row.ordinal}>
                <button
                  type="button"
                  onClick={() => openUnsent(row.ordinal)}
                  aria-label={`${row.grade}: ${row.sent} of ${row.total} sent. Show the ones left in the catalog`}
                  className="grid w-full grid-cols-[2rem_1fr_3rem] items-center gap-2 rounded-md py-1.5 text-xs text-muted-foreground tabular-nums transition-colors hover:text-foreground"
                >
                  <span className="text-left">{row.grade}</span>
                  <span className="block">
                    <span
                      className="block h-2 overflow-hidden rounded-full bg-muted"
                      style={{ width: `${Math.max((row.total / maxTotal) * 100, MIN_TRACK)}%` }}
                    >
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(row.sent / row.total) * 100}%` }}
                      />
                    </span>
                  </span>
                  <span className="text-right">
                    {row.sent}/{row.total}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
