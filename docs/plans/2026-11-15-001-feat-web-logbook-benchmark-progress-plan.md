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
sent: a ring with the overall share, and one progress bar per grade (sent of total). A grade
range filter, hidden behind a filter button on the card, narrows the card to the grades the
user cares about. Tier: **Standard** (new component inside the existing logbook pattern; reads
only; no schema, no BLE, no geometry).

## Decisions (mocked up and chosen 2026-11-15)

- **Layout A**: ring + headline, then a bar per grade, hardest grade on top. Each track's length
  is that grade's benchmark total relative to the largest visible grade; the fill is sent / total.
- **Grade filter**: a funnel icon button in the card's top right toggles a two-thumb slider. The
  slider is hidden by default. When a range is set the button shows a dot and the range is
  appended to the count line. The ring and count are computed over the selected range only.
- **The range is remembered per board** (localStorage), clamped to the grades that have
  benchmarks.
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

1. `web/src/logbook/benchmarkProgress.ts` — pure: per-grade rows, range summary, range
   clamp, range storage. Unit tests.
2. `web/src/logbook/BenchmarkProgressCard.tsx` — the card. Component tests (render, hidden
   when no slab, filter toggle, tap-through target).
3. `web/src/logbook/LogbookScreen.tsx` — render the card above the pyramid.
4. `docs/data-model-and-logging.md` — note the card next to the pyramid.

## Out of scope

- Any change to the Boards tab.
- Progress for non-benchmark problems, or across angles.
- iOS.
