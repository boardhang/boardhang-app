import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { usePullToRefresh } from './usePullToRefresh'

// A host that mounts the hook with an anchor inside a `.app-scroll` scroller — the same
// structure AppLayout provides — and surfaces the pull state as data attributes.
function Host({ onRefresh, enabled = true }: { onRefresh: () => Promise<unknown>; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const pull = usePullToRefresh(ref, onRefresh, enabled)
  return (
    <div className="app-scroll">
      <div ref={ref} data-testid="anchor" data-distance={pull.distance} data-refreshing={String(pull.refreshing)} />
    </div>
  )
}

// jsdom lacks a constructable TouchEvent; fake one carrying just what the hook reads.
function touch(type: string, clientY: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: [{ clientY }] })
  return e
}

function scrollerOf(container: HTMLElement): HTMLElement {
  return container.querySelector('.app-scroll') as HTMLElement
}

describe('usePullToRefresh', () => {
  it('fires onRefresh when the pull passes the threshold', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<Host onRefresh={onRefresh} />)
    const scroller = scrollerOf(container)

    await act(async () => {
      scroller.dispatchEvent(touch('touchstart', 0))
      scroller.dispatchEvent(touch('touchmove', 400)) // dy=400 → capped pull ≥ threshold
      scroller.dispatchEvent(touch('touchend', 400))
    })

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire when the pull is short of the threshold', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<Host onRefresh={onRefresh} />)
    const scroller = scrollerOf(container)

    await act(async () => {
      scroller.dispatchEvent(touch('touchstart', 0))
      scroller.dispatchEvent(touch('touchmove', 20)) // dy=20 → pull=10px, below threshold
      scroller.dispatchEvent(touch('touchend', 20))
    })

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('does not engage when the scroller is not at the top', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<Host onRefresh={onRefresh} />)
    const scroller = scrollerOf(container)
    Object.defineProperty(scroller, 'scrollTop', { value: 200, configurable: true })

    await act(async () => {
      scroller.dispatchEvent(touch('touchstart', 0))
      scroller.dispatchEvent(touch('touchmove', 400))
      scroller.dispatchEvent(touch('touchend', 400))
    })

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('detaches while disabled (drawer open) so a pull never fires', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<Host onRefresh={onRefresh} enabled={false} />)
    const scroller = scrollerOf(container)

    await act(async () => {
      scroller.dispatchEvent(touch('touchstart', 0))
      scroller.dispatchEvent(touch('touchmove', 400))
      scroller.dispatchEvent(touch('touchend', 400))
    })

    expect(onRefresh).not.toHaveBeenCalled()
  })
})
