// Benchmark progress for the Logbook: a ring with the share of the board's benchmarks
// the user has sent. "Show grades" expands one bar per grade (sent of total), hardest
// grade on top; collapsed by default so the Logbook's ascents stay near the top. A
// grade-range slider, hidden behind the filter button and styled like the catalog
// filter's, narrows the card to the grades the user cares about. The range is remembered
// per board, the expanded state per device.
//
// Totals come from the cached catalog slab for the board's current angle — a cache read
// only, the Logbook never starts a slab download. With no cached slab (or no benchmarks)
// the card renders nothing.

import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { gradeBadgeCls } from '../board/gradeBadge'
import { defaultAngle, hasAngleChoice, type CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle } from '../board/boardStore'
import { FONT_GRADES } from '../board/grades'
import { holdSetContext, isClimbable } from '../board/holdSetMembership'
import { CATALOG_SEARCH_DEFAULTS, filtersToSearch } from '../catalog/catalogSearch'
import { readSlab, type CatalogProblem } from '../catalog/catalogSync'
import { DEFAULT_FILTERS } from '../catalog/filters'
import {
  benchmarkRows,
  clampRange,
  gradeSpan,
  loadExpanded,
  loadRange,
  saveExpanded,
  saveRange,
  summarize,
  type GradeRange,
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

/** Render with `key={board.layoutId}` so the remembered range reloads on a board switch. */
export function BenchmarkProgressCard({ board, sentIds }: Props) {
  const navigate = useNavigate()
  const sliderId = useId()
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

  const rows = useMemo(() => {
    if (!slab || slab.key !== slabKey) return []
    const { membership, active } = holdSetContext(board.membershipResource, activeHoldSetsRaw)
    return benchmarkRows(slab.benchmarks, sentIds, (holds) => isClimbable(membership, holds, active))
  }, [slab, slabKey, board.membershipResource, activeHoldSetsRaw, sentIds])

  const [stored, setStored] = useState<GradeRange | null>(() => loadRange(board.layoutId))
  const [filterOpen, setFilterOpen] = useState(false)
  const [expanded, setExpanded] = useState(loadExpanded)
  const gradesId = useId()

  function toggleExpanded() {
    setExpanded((was) => {
      saveExpanded(!was)
      return !was
    })
  }

  const span = gradeSpan(rows)
  if (!span) return null

  const range = clampRange(stored, span)
  const filtered = range[0] !== span[0] || range[1] !== span[1]
  const summary = summarize(rows, range)
  const rangeLabel =
    range[0] === range[1]
      ? FONT_GRADES[range[0]]
      : `${FONT_GRADES[range[0]]} to ${FONT_GRADES[range[1]]}`

  function changeRange(next: GradeRange) {
    const whole = next[0] === span![0] && next[1] === span![1]
    setStored(whole ? null : next)
    saveRange(board.layoutId, whole ? null : next)
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
            {filtered && ` · ${rangeLabel}`}
          </p>
        </div>

        {span[0] < span[1] && (
          <Button
            variant="outline"
            size="icon-sm"
            className="relative shrink-0 self-start"
            aria-label="Filter grades"
            aria-expanded={filterOpen}
            aria-controls={sliderId}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <ListFilter aria-hidden />
            {filtered && (
              <span
                data-testid="grade-filter-active"
                className="absolute -top-1 -right-1 size-2 rounded-full bg-primary ring-2 ring-background"
              />
            )}
          </Button>
        )}
      </div>

      {filterOpen && span[0] < span[1] && (
        // Same look as the catalog filter's grade slider: label, min/max badges, slider.
        <div id={sliderId} className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Grade</span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className={gradeBadgeCls}>{FONT_GRADES[range[0]]}</span>
              {range[1] !== range[0] && (
                <>
                  <span className="text-xs text-muted-foreground">to</span>
                  <span className={gradeBadgeCls}>{FONT_GRADES[range[1]]}</span>
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
              value={range}
              onValueChange={(value) => {
                const [lo, hi] = value as number[]
                changeRange([lo, hi])
              }}
            />
          </div>
        </div>
      )}

      {/* The per-grade bars are tucked away by default so the card stays one line tall. */}
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 -ml-2 text-muted-foreground"
        aria-expanded={expanded}
        aria-controls={gradesId}
        onClick={toggleExpanded}
      >
        {expanded ? 'Hide grades' : 'Show grades'}
        <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} aria-hidden />
      </Button>

      {/* Hardest grade on top, like a pyramid. Track length = this grade's share of the
          largest visible grade; fill = sent / total. */}
      {expanded && (
      <ul id={gradesId} className="mt-1 space-y-0.5">
        {[...summary.rows].reverse().map((row) => (
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
                  style={{ width: `${Math.max((row.total / summary.maxTotal) * 100, MIN_TRACK)}%` }}
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
      )}
    </section>
  )
}
