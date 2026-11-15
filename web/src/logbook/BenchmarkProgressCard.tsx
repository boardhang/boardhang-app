// Benchmark progress for the Logbook: a ring with the share of the board's benchmarks
// the user has sent. "Show grades" expands one bar per grade (sent of total), hardest
// grade on top; collapsed by default so the Logbook's ascents stay near the top.
//
// By default the card covers the grades up to the user's hardest send — the ring, the
// count and the bars all leave out the grades above it. "Show all grades" brings those
// back. Both toggles are remembered on this device.
//
// Totals come from the cached catalog slab for the board's current angle — a cache read
// only, the Logbook never starts a slab download. With no cached slab (or no benchmarks)
// the card renders nothing.

import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { defaultAngle, hasAngleChoice, type CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle } from '../board/boardStore'
import { holdSetContext, isClimbable } from '../board/holdSetMembership'
import { CATALOG_SEARCH_DEFAULTS, filtersToSearch } from '../catalog/catalogSearch'
import { readSlab, type CatalogProblem } from '../catalog/catalogSync'
import { DEFAULT_FILTERS } from '../catalog/filters'
import {
  benchmarkRows,
  loadAllGrades,
  loadExpanded,
  rowsUpToHardestSend,
  saveAllGrades,
  saveExpanded,
  summarize,
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
  const [allGrades, setAllGrades] = useState(loadAllGrades)

  if (allRows.length === 0) return null

  const reached = rowsUpToHardestSend(allRows)
  /** Grades above the hardest send exist, so there is something to hide or show. */
  const canTrim = reached.length < allRows.length
  const rows = allGrades ? allRows : reached
  const summary = summarize(rows)

  function toggleExpanded() {
    saveExpanded(!expanded)
    setExpanded(!expanded)
  }

  function toggleAllGrades() {
    saveAllGrades(!allGrades)
    setAllGrades(!allGrades)
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
            {/* Say what the smaller total covers, so it isn't mistaken for the whole board. */}
            {canTrim && !allGrades && ` · up to ${rows[rows.length - 1].grade}`}
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
          {canTrim && (
            <Button
              variant="link"
              size="xs"
              className="mt-1 h-auto px-0 text-muted-foreground"
              onClick={toggleAllGrades}
            >
              {allGrades ? 'Only up to my hardest send' : 'Show all grades'}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
