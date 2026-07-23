---
title: Drag DOM elements via imperative compositor transforms, not per-move React state
date: 2026-07-23
category: docs/solutions/design-patterns
module: web catalog (draggable session pill)
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - A DOM element follows the pointer continuously (drag-to-move, swipe-to-dismiss, resize handles)
  - The dragged element or its surroundings are visually expensive (backdrop-filter, shadows, large paint areas)
  - Drag feel is described as janky, laggy, or stuttering despite correct logic
tags:
  - drag
  - pointer-events
  - translate3d
  - will-change
  - backdrop-filter
  - layout-thrash
  - react
  - performance
---

# Drag DOM elements via imperative compositor transforms, not per-move React state

## Context

The catalog's floating session pill (`web/src/catalog/SessionBarPill.tsx`) is drag-to-reposition. The first implementation did the obvious React thing on every `pointermove`: measure bounds (`querySelector` + `getBoundingClientRect` — forced synchronous reflows), `setState` the new position (full re-render of the pill subtree), and reposition via `left/top` — all while the pill's `backdrop-filter` re-blurred its backdrop each frame. At 60–120 input events per second the drag visibly stuttered.

## Guidance

Split the gesture into three phases so the per-move hot path does no layout reads, no React work, and no layout-triggering styles:

1. **Measure once at drag start** (when the movement threshold is crossed): cache the clamp bounds and the element's origin. Also set `will-change: transform` and suspend expensive paint effects for the gesture — e.g. `backdrop-filter: none` when the background is already near-opaque.
2. **Per move, write only a compositor transform, directly in the handler**: `el.style.transform = translate3d(dx, dy, 0)` with the delta clamped against the cached bounds. No `setState`, no DOM reads, no `left/top`. Do **not** add a `requestAnimationFrame` hop — browsers already frame-align `pointermove` delivery, so the rAF only adds up to a frame of finger-to-element lag.
3. **Commit on release**: clear the gesture styles, take one fresh bounds measurement (the viewport or the element's size may have changed mid-gesture), clamp, then `setState` + persist once. In React, discrete-event updates flush before the next paint, so clearing the transform and committing `left/top` in the same handler cannot flash the pre-drag position.

Gesture-state hardening that review found necessary:

- **Gate the whole gesture on its `pointerId`** (captured at pointerdown). Without it, a second finger computes deltas from the first finger's start coordinates, steals the pointer capture, and — if the end handler filters on `isPrimary` — its release is ignored, freezing the imperative styles on the element.
- **Reset the post-drag click-swallow flag on the next `pointerdown`**, because touch drags beyond the tap slop fire no trailing `click` to consume it.
- **Drop dead gestures when `e.buttons === 0`** in the move handler: a press released off-element before capture leaves stale gesture state that would otherwise make the element chase the bare cursor on hover.
- **Never re-clamp/re-base the committed position while a drag is active** (resize handlers, `ResizeObserver`): shifting the base `left/top` under a standing transform makes the element jump. Freeze during the gesture; reconcile with the fresh measurement at release.

## Why This Matters

Every per-move `setState` re-renders the component subtree; every per-move `getBoundingClientRect` after a style write forces a synchronous reflow; `left/top` changes trigger layout; and a moving `backdrop-filter` element makes the GPU re-sample and re-blur its backdrop each frame. Any one of these can eat the frame budget on a phone — combined, the drag stutters no matter how correct the logic is. `transform` is compositor-only, so the hot path costs a style write per input event and nothing else. On this app the difference was "definitely janky" to 1:1 finger tracking (PRs #107/#110).

## When to Apply

- Any continuous pointer-follow interaction where the element must track input at frame rate
- Especially when the element carries `backdrop-filter`/heavy shadows, or lives inside a subtree that is expensive to re-render
- Not needed for discrete moves (snap-to-slot on drop only) — plain state commits are fine there

## Examples

Before (janky — per-move state + layout reads):

```tsx
const onPointerMove = (e) => {
  // querySelector + getBoundingClientRect per event → forced reflow
  setPos(clampToMeasuredBounds(origin.x + dx, origin.y + dy)) // re-render per event
}
```

After (smooth — measure once, transform per move, commit on release):

```tsx
// threshold crossed: d.bounds = measureBounds(el)  ← the gesture's ONE layout read
//                    el.style.willChange = 'transform'; el.style.backdropFilter = 'none'
const onPointerMove = (e) => {
  if (e.pointerId !== d.pointerId) return
  const t = clampTo(d.bounds, d.originX + dx, d.originY + dy)
  el.style.transform = `translate3d(${t.x - d.originX}px, ${t.y - d.originY}px, 0)`
}
const endDrag = (e) => {
  if (d && e.pointerId !== d.pointerId) return
  el.style.transform = ''; el.style.willChange = ''; el.style.backdropFilter = ''
  const final = clampTo(measureBounds(el), d.originX + d.dx, d.originY + d.dy) // fresh
  setPos(final); persistPos(final)
}
```

Full implementation with tests (drag threshold, click swallowing, two-finger gating, mid-drag rotation): `web/src/catalog/SessionBarPill.tsx` + `SessionBarPill.test.tsx`.

## Related

- `docs/navigation-and-ui-flows.md` — the header z-30/40/50 stacking convention (a `backdrop-filter` ancestor is also the containing block for `position: fixed` descendants, which is why the pill positions wrapper-relative `absolute` instead of `fixed`)
- boardhang/boardhang-app#107, boardhang/boardhang-app#110 — the PRs where the pattern was built and hardened
