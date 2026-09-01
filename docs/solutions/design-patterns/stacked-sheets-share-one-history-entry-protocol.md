---
title: Stacked sheets need a keyed, merged history-entry protocol
date: 2026-09-01
category: docs/solutions/design-patterns
module: web beta (player + view-all grid over the problem drawer)
problem_type: design_pattern
component: frontend_react
severity: medium
applies_when:
  - More than one overlay pushes its own history entry so the mobile back gesture closes it
  - Overlays can be open at the same time (stacked)
  - The app also has router-owned history entries underneath (TanStack Router)
tags:
  - history
  - popstate
  - back-gesture
  - stacked-sheets
  - drawer
  - tanstack-router
---

# Stacked sheets need a keyed, merged history-entry protocol

## Context

The problem drawer stacks sheets: the beta "view all" grid opens over the drawer, and the
player opens over the grid. Each pushes a history entry so the mobile back gesture closes
the topmost surface instead of popping the `?problem=` drawer. The single-sheet version of
this pattern lived inline in `BetaPlayerSheet` and worked — until a second stackable sheet
arrived.

## The problem

`popstate` is a window-level event: **every** open sheet hears **every** pop. The naive
per-sheet listener (`onpopstate = close`) collapsed the whole stack — one Back closed the
player *and* the grid under it. Found live in a browser pass; invisible to unit tests
written per-sheet.

Two subtler hazards surface once entries stack:

- `pushState({ myKey: true })` **replaces** the state object, so the entry above the grid's
  didn't carry `betaGrid`, and TanStack Router's own keys (`__TSR_index` …) vanished from
  the top entry.
- The UI-close cleanup (`if (history.state?.myKey) history.back()`) assumes its entry is on
  top — false for the lower sheet when several unmount in one commit; its entry leaks.

## The approach that worked

One shared hook, `web/src/beta/useHistoryBackClose.ts` — `useHistoryBackClose(open,
onClose, stateKey)` — with two rules:

1. **Merge on push**: `pushState({ ...window.history.state, [stateKey]: true }, '')`. Each
   entry inherits the router's keys and every lower sheet's key, so the stack's top entry
   describes the whole stack.
2. **Close only when your own key is gone**: the popstate handler checks
   `window.history.state?.[stateKey]` and closes only if absent. A pop from
   `{grid, player}` to `{grid}` closes the player and leaves the grid.

The latest `onClose` is read through a ref so the effect depends only on `open` — an
unstable parent callback would re-run the effect and fire a spurious `history.back()`
(React 18 StrictMode reproduces it on mount).

## What was tried that didn't work

- **Unconditional close on popstate** (the original single-sheet inline pattern): correct
  for one sheet, collapses a stack.
- **Raw (non-merged) state objects**: strands the lower sheet's cleanup and drops the
  router's index bookkeeping.

## Residual limit

The entries are still pushed with raw `history.pushState`, not through `router.history`, so
a router *replace*-navigation that flushes while a sheet entry is on top can still rewrite
that entry and delete the sheet key (timing-dependent; no known trigger today because the
modal sheets block paging). If a trigger appears, route the push/pop through
`router.history` the way `useProblemDrawer` does.

## References

- `web/src/beta/useHistoryBackClose.ts` (+ its test for the own-key guard)
- Consumers: `web/src/beta/BetaPlayerSheet.tsx`, `web/src/beta/BetaGridSheet.tsx`
- PR: boardhang/boardhang-app#138
