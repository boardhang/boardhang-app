import { act, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  DRAG_SLOP,
  EST_ROW_HEIGHT,
  computeTargetIndex,
  reorderIds,
  useDragReorder,
} from './useDragReorder'

// ─── Index math, tested directly (the reorder crux — no DOM drag needed) ───────

describe('computeTargetIndex', () => {
  // A drag shifts the index one slot per row of travel, crossing at the half-row threshold.
  it('stays put below the half-row threshold', () => {
    // startIndex 0, count 3, half of 44 is 22 — a 20px drag has not crossed it.
    expect(computeTargetIndex(0, 20, 44, 3)).toBe(0)
    expect(computeTargetIndex(1, -20, 44, 3)).toBe(1)
  })

  it('shifts one slot once the drag crosses the half-row threshold', () => {
    expect(computeTargetIndex(0, 30, 44, 3)).toBe(1) // downward, past 22px
    expect(computeTargetIndex(2, -30, 44, 3)).toBe(1) // upward, past 22px
  })

  it('shifts multiple slots for a multi-row drag', () => {
    expect(computeTargetIndex(0, 100, 44, 3)).toBe(2) // ~2.3 rows down
  })

  it('clamps to the list bounds', () => {
    expect(computeTargetIndex(0, 1000, 44, 3)).toBe(2)
    expect(computeTargetIndex(2, -1000, 44, 3)).toBe(0)
  })

  it('is a no-op when the row height is unknown', () => {
    expect(computeTargetIndex(1, 200, 0, 3)).toBe(1)
  })
})

describe('reorderIds', () => {
  it('moves an item from one index to another', () => {
    expect(reorderIds(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(reorderIds(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('returns the same array reference for a same-slot move (no-op)', () => {
    const ids = ['a', 'b', 'c']
    expect(reorderIds(ids, 1, 1)).toBe(ids)
  })
})

// ─── Wired to a list element, simulating raw touch events ──────────────────────

// jsdom has no constructable TouchEvent; fake one carrying just clientX/clientY, mirroring
// usePullToRefresh.test.tsx / useSwipeToQueue.test.ts.
function touch(type: string, x: number, y: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: [{ clientX: x, clientY: y }] })
  return e
}

function Host({ ids, onReorder }: { ids: string[]; onReorder: (o: string[]) => void }) {
  const ref = useRef<HTMLUListElement>(null)
  useDragReorder(ref, { ids, onReorder, enabled: true })
  return createElement(
    'ul',
    { ref, 'data-testid': 'list' },
    ids.map((id) =>
      createElement(
        'li',
        { key: id },
        createElement('span', { 'data-queue-drag-handle': '', 'data-item-id': id }, 'H'),
      ),
    ),
  )
}

function handleFor(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-item-id="${id}"]`) as HTMLElement
}

/** Press the handle of `id` and drag it by `dy` px (dispatched on the handle, bubbling up). */
async function dragHandle(handle: HTMLElement, dy: number, startY = 100) {
  await act(async () => {
    handle.dispatchEvent(touch('touchstart', 20, startY))
    handle.dispatchEvent(touch('touchmove', 20, startY + dy / 2))
    handle.dispatchEvent(touch('touchmove', 20, startY + dy))
    handle.dispatchEvent(touch('touchend', 20, startY + dy))
  })
}

describe('useDragReorder (wired)', () => {
  it('emits the new id order when a drop crosses into another slot', async () => {
    const onReorder = vi.fn()
    const { container } = render(createElement(Host, { ids: ['a', 'b', 'c'], onReorder }))
    // Drag the first row down past two rows (jsdom rows measure 0 → EST_ROW_HEIGHT fallback).
    await dragHandle(handleFor(container, 'a'), EST_ROW_HEIGHT * 2 + 4)
    expect(onReorder).toHaveBeenCalledTimes(1)
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('does NOT reorder when the drop lands back on the same slot', async () => {
    const onReorder = vi.fn()
    const { container } = render(createElement(Host, { ids: ['a', 'b', 'c'], onReorder }))
    // Below the half-row threshold → target index equals the start index → no-op.
    await dragHandle(handleFor(container, 'b'), DRAG_SLOP + 2)
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('does NOT reorder on a handle press with no movement (a tap, not a drag)', async () => {
    const onReorder = vi.fn()
    const { container } = render(createElement(Host, { ids: ['a', 'b', 'c'], onReorder }))
    await act(async () => {
      const h = handleFor(container, 'a')
      h.dispatchEvent(touch('touchstart', 20, 100))
      h.dispatchEvent(touch('touchend', 20, 100))
    })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('suppresses the tap-open click after a real drag, but not after a still tap', async () => {
    const onReorder = vi.fn()
    const { container } = render(createElement(Host, { ids: ['a', 'b', 'c'], onReorder }))

    // A real drag: the synthesized click on the list is swallowed (drag must not open a problem).
    await dragHandle(handleFor(container, 'a'), EST_ROW_HEIGHT * 2)
    const afterDrag = new Event('click', { bubbles: true, cancelable: true })
    container.querySelector('[data-testid="list"]')!.dispatchEvent(afterDrag)
    expect(afterDrag.defaultPrevented).toBe(true)

    // A still tap on the handle: the click passes through (tap-to-open stays reachable).
    await act(async () => {
      const h = handleFor(container, 'b')
      h.dispatchEvent(touch('touchstart', 20, 100))
      h.dispatchEvent(touch('touchend', 20, 100))
    })
    const afterTap = new Event('click', { bubbles: true, cancelable: true })
    container.querySelector('[data-testid="list"]')!.dispatchEvent(afterTap)
    expect(afterTap.defaultPrevented).toBe(false)
  })

  it('ignores a touch that does not start on a drag handle (scroll / tap elsewhere)', async () => {
    const onReorder = vi.fn()
    const { container } = render(createElement(Host, { ids: ['a', 'b', 'c'], onReorder }))
    const list = container.querySelector('[data-testid="list"]') as HTMLElement
    await act(async () => {
      list.dispatchEvent(touch('touchstart', 20, 100))
      list.dispatchEvent(touch('touchmove', 20, 100 + EST_ROW_HEIGHT * 2))
      list.dispatchEvent(touch('touchend', 20, 100 + EST_ROW_HEIGHT * 2))
    })
    expect(onReorder).not.toHaveBeenCalled()
  })
})
