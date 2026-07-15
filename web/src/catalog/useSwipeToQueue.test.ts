import { act, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SWIPE_AXIS_LOCK,
  SWIPE_TRIGGER,
  resolveSwipeAxis,
  shouldQueueSwipe,
  useSwipeToQueue,
} from './useSwipeToQueue'

// The gesture calls the queue store's addProblem; the toast is fire-and-forget feedback.
const addProblem = vi.fn().mockResolvedValue('ok' as const)
vi.mock('../sessions/queueStore', () => ({ addProblem: (...a: unknown[]) => addProblem(...a) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

// ─── Gesture math, tested directly (the disambiguation crux) ───────────────────

describe('resolveSwipeAxis', () => {
  it('is "none" within the axis-lock (a tap, not a swipe)', () => {
    expect(resolveSwipeAxis(-4, 3)).toBe('none')
    expect(resolveSwipeAxis(SWIPE_AXIS_LOCK - 1, -(SWIPE_AXIS_LOCK - 1))).toBe('none')
  })

  it('commits to the dominant axis past the lock', () => {
    expect(resolveSwipeAxis(-80, 5)).toBe('horizontal')
    expect(resolveSwipeAxis(-5, 80)).toBe('vertical')
  })

  it('treats a diagonal drag whose vertical delta dominates as vertical (scroll, not queue)', () => {
    // Large leftward dx, but even larger downward dy → this is a scroll, must NOT be horizontal.
    expect(resolveSwipeAxis(-90, 200)).toBe('vertical')
  })
})

describe('shouldQueueSwipe', () => {
  it('fires for a dominant leftward swipe past the trigger', () => {
    expect(shouldQueueSwipe(-(SWIPE_TRIGGER + 1), 4)).toBe(true)
  })

  it('does not fire for a leftward swipe short of the trigger', () => {
    expect(shouldQueueSwipe(-(SWIPE_TRIGGER - 1), 4)).toBe(false)
  })

  it('does not fire for a vertical drag (scroll)', () => {
    expect(shouldQueueSwipe(-5, 200)).toBe(false)
  })

  it('does not fire for a diagonal drag dominated by vertical travel', () => {
    expect(shouldQueueSwipe(-90, 200)).toBe(false)
  })

  it('does not fire for a downward pull (pull-to-refresh territory)', () => {
    expect(shouldQueueSwipe(-2, 220)).toBe(false)
  })

  it('does not fire for a rightward swipe', () => {
    expect(shouldQueueSwipe(SWIPE_TRIGGER + 20, 4)).toBe(false)
  })
})

// ─── Wired to a row element, simulating raw touch events ───────────────────────

// jsdom has no constructable TouchEvent; fake one carrying just clientX/clientY, mirroring
// usePullToRefresh.test.tsx.
function touch(type: string, x: number, y: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: [{ clientX: x, clientY: y }] })
  return e
}

function Host({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const s = useSwipeToQueue(ref, { sourceCatalogId: 'p1', boardLayoutId: 7, enabled })
  return createElement('div', {
    ref,
    'data-testid': 'row',
    'data-offset': s.offset,
    'data-armed': String(s.armed),
  })
}

function rowOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="row"]') as HTMLElement
}

async function gesture(row: HTMLElement, moves: [number, number][], start: [number, number] = [200, 100]) {
  await act(async () => {
    row.dispatchEvent(touch('touchstart', start[0], start[1]))
    for (const [x, y] of moves) row.dispatchEvent(touch('touchmove', x, y))
    row.dispatchEvent(touch('touchend', 0, 0))
  })
}

describe('useSwipeToQueue (wired)', () => {
  beforeEach(() => addProblem.mockClear())
  afterEach(() => vi.useRealTimers())

  it('adds the row on a dominant leftward swipe past the threshold', async () => {
    const { container } = render(createElement(Host))
    // start x=200 → x=110 gives dx=-90 (past trigger), dy=+5 (horizontal dominant).
    await gesture(rowOf(container), [
      [180, 103],
      [110, 105],
    ])
    expect(addProblem).toHaveBeenCalledTimes(1)
    expect(addProblem).toHaveBeenCalledWith('p1', 7)
  })

  it('does NOT add on a vertical drag (falls through to scroll)', async () => {
    const { container } = render(createElement(Host))
    // dx small, dy large → vertical.
    await gesture(rowOf(container), [
      [198, 180],
      [196, 320],
    ])
    expect(addProblem).not.toHaveBeenCalled()
  })

  it('does NOT add on a diagonal drag dominated by vertical travel', async () => {
    const { container } = render(createElement(Host))
    // dx=-90 (past trigger on its own) but dy=+200 dominates → scroll, not queue.
    await gesture(rowOf(container), [
      [155, 200],
      [110, 300],
    ])
    expect(addProblem).not.toHaveBeenCalled()
  })

  it('does NOT add on a downward pull (leaves pull-to-refresh alone)', async () => {
    const { container } = render(createElement(Host))
    await gesture(rowOf(container), [
      [199, 200],
      [198, 420],
    ])
    expect(addProblem).not.toHaveBeenCalled()
  })

  it('does NOT add on a tap (no movement past the axis-lock)', async () => {
    const { container } = render(createElement(Host))
    await gesture(rowOf(container), [
      [199, 101],
      [198, 102],
    ])
    expect(addProblem).not.toHaveBeenCalled()
  })

  it('is inert with no active session on this board (enabled=false)', async () => {
    const { container } = render(createElement(Host, { enabled: false }))
    await gesture(rowOf(container), [
      [180, 103],
      [110, 105],
    ])
    expect(addProblem).not.toHaveBeenCalled()
  })
})
