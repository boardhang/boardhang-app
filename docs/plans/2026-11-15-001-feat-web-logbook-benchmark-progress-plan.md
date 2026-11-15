---
title: Benchmark progress card on the web Logbook - Plan
type: feat
date: 2026-11-15
topic: web-logbook-benchmark-progress
execution: code
---

# Benchmark progress card on the web Logbook - Plan

## Goal

Show, at the top of the web Logbook, how many of the active board's benchmarks the user has
sent: a ring with the share sent, and one progress bar per grade (sent of total) on demand,
covering the grades up to the user's hardest send. Tier: **Standard** (new component inside the existing logbook pattern; reads
only; no schema, no BLE, no geometry).

## Decisions (mocked up, previewed and revised 2026-11-15)

- **One row by default**: a ring with the share sent, the title and the count. A chevron in the
  card's top right expands the rest.
- **Expanded**: a grade-range slider, then one bar per grade, hardest grade on top. Each track's
  length is that grade's benchmark total relative to the largest visible grade; the fill is
  sent / total.
- **The card covers a grade range**: the ring, the count and the bars all follow it, and the
  count line names it ("8 of 116 sent · 7A to 7A+") unless it is the whole board.
- **Default range = easiest grade up to the hardest send.** Grades above the hardest send are
  left out; a grade with no sends below it is a gap worth seeing and stays. With no sends at
  all, the default is every grade. The default moves up as the user sends harder grades.
- **The slider sets any range**, so the user can see what is left in a specific band. It uses
  the catalog filter's look ("Grade" label, min/max badges, blue range) via the shared
  `web/src/board/gradeBadge.ts` style. A picked range is remembered per board; dragging back
  to the default clears it so the range goes on following the hardest send.
- **No filter button.** The slider lives in the expanded area, so the collapsed card carries no
  filter control.
- **Existing sends pyramid stays** below the card, unchanged.
- **Tap a grade row** to open the catalog on that board + angle filtered to benchmarks at that
  grade the user has not sent (`bench=1`, `grade=n-n`, `status=attempted,unlogged`).

## Data

- **Total**: the cached catalog slab for the active board at its current angle (`readSlab`),
  `is_benchmark` rows that are climbable with the installed hold sets (`isClimbable`). Cache
  read only: the Logbook does not start a slab download. No cached slab, or no benchmarks, means
  the card is not rendered.
- **Sent**: the board-scoped sent ids `LogbookScreen` already derives.
- **Grades**: bucketed by `FONT_GRADES` ordinal, floored at `GRADE_FILTER_FLOOR` to match the
  catalog's grade filter, so a row's tap-through shows the same problems the row counted.
  Unknown grades are skipped.

## Units

1. `web/src/logbook/benchmarkProgress.ts` — pure: per-grade rows, default and picked grade
   range, summary, remembered range and expanded state. Unit tests.
2. `web/src/logbook/BenchmarkProgressCard.tsx` — the card. Component tests (render, hidden
   when no slab, expand, grade slider, tap-through target).
3. `web/src/logbook/LogbookScreen.tsx` — render the card above the pyramid.
4. `docs/data-model-and-logging.md` — note the card next to the pyramid.

## Out of scope

- Any change to the Boards tab.
- Progress for non-benchmark problems, or across angles.
- iOS.
