import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CatalogBoardDef } from '../board/boards'
import { SessionBarPill } from './SessionBarPill'

// The queue drawer drags in stores/drawer plumbing irrelevant to the pill's own
// behavior under test (tap targets and fallbacks).
vi.mock('../sessions/QueueDrawer', () => ({
  QueueDrawer: () => <button aria-label="Queue" />,
}))

const board = { layoutId: 1, name: 'Test Board' } as CatalogBoardDef

function renderPill(overrides: Partial<Parameters<typeof SessionBarPill>[0]> = {}) {
  const onExpand = vi.fn()
  const onShare = vi.fn()
  const onOpenProblem = vi.fn()
  const utils = render(
    <SessionBarPill
      board={board}
      sessionName="Mini · Jul 22"
      rosterCount={3}
      litProblemId="p1"
      litProblem={{ id: 'p1', name: 'Carafes', grade: '6A+' } as never}
      onExpand={onExpand}
      onShare={onShare}
      onOpenProblem={onOpenProblem}
      {...overrides}
    />,
  )
  const mainButton = (
    overrides.litProblemId === null
      ? // Unlit: the text area shows the session name (the chevron shares its aria-label).
        (screen.getByText('Mini · Jul 22').closest('button') as HTMLElement)
      : screen.getByRole('button', { name: 'Open the problem that’s on the wall' })
  ) as HTMLElement
  return { ...utils, mainButton, onExpand, onShare, onOpenProblem }
}

describe('SessionBarPill', () => {
  it('opens the lit problem on tap', () => {
    const { mainButton, onOpenProblem } = renderPill()
    fireEvent.click(mainButton)
    expect(onOpenProblem).toHaveBeenCalledWith('p1')
  })

  it('expands on tap when nothing is lit', () => {
    const { mainButton, onExpand } = renderPill({ litProblemId: null, litProblem: null })
    fireEvent.click(mainButton)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('expands via the chevron and shares via the share button', () => {
    const { onExpand, onShare } = renderPill()
    fireEvent.click(screen.getByRole('button', { name: 'Expand session details' }))
    expect(onExpand).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Share session' }))
    expect(onShare).toHaveBeenCalledTimes(1)
  })
})
