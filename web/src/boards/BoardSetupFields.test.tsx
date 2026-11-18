import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BOARDS, boardByLayoutId } from '../board/boards'
import { BoardSetupFields } from './BoardSetupFields'

/** The fields driven by local state, as the add flow drives them. */
function Harness({ layoutId, onRaw }: { layoutId: number; onRaw?: (raw: string) => void }) {
  const board = boardByLayoutId(layoutId)!
  const [angle, setAngle] = useState(board.angles[0])
  const [raw, setRaw] = useState('')
  return (
    <BoardSetupFields
      board={board}
      angle={angle}
      holdSetsRaw={raw}
      onAngle={setAngle}
      onHoldSetsRaw={(next) => {
        onRaw?.(next)
        setRaw(next)
      }}
    />
  )
}

const holdSetToggles = () =>
  within(screen.getByRole('group', { name: 'Hold sets on the wall' })).getAllByRole('button')

describe('BoardSetupFields', () => {
  it('hides the angle group for a single-angle board', () => {
    render(<Harness layoutId={6} />) // Mini MoonBoard 2020: 40° only
    expect(screen.queryByRole('group', { name: 'Angle' })).toBeNull()
  })

  it('shows the angle group for a two-angle board and reports the chosen angle', () => {
    render(<Harness layoutId={3} />)
    const angles = screen.getByRole('group', { name: 'Angle' })
    expect(within(angles).getByRole('button', { name: '40°' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(angles).getByRole('button', { name: '25°' }))
    expect(within(angles).getByRole('button', { name: '25°' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(angles).getByRole('button', { name: '40°' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('starts with every hold set selected when the raw string is empty', () => {
    render(<Harness layoutId={7} />)
    expect(holdSetToggles().every((t) => t.getAttribute('aria-pressed') === 'true')).toBe(true)
  })

  it('reports the selection when a hold set is toggled off and on again', () => {
    const onRaw = vi.fn()
    render(<Harness layoutId={7} onRaw={onRaw} />) // sets 28, 29, 30, 31
    fireEvent.click(screen.getByRole('button', { name: 'Hold Set F' })) // 28 off
    expect(onRaw).toHaveBeenLastCalledWith('29|30|31')
    fireEvent.click(screen.getByRole('button', { name: 'Hold Set F' })) // back on = all
    expect(onRaw).toHaveBeenLastCalledWith('')
  })

  it('disables the last selected hold set', () => {
    render(<Harness layoutId={7} />)
    const [a, b, c] = holdSetToggles()
    fireEvent.click(a)
    fireEvent.click(b)
    fireEvent.click(c)
    const stillOn = holdSetToggles().filter((t) => t.getAttribute('aria-pressed') === 'true')
    expect(stillOn).toHaveLength(1)
    expect(stillOn[0]).toBeDisabled()
  })

  it('renders every registry board', () => {
    for (const b of BOARDS) {
      const { unmount } = render(<Harness layoutId={b.layoutId} />)
      expect(holdSetToggles().length).toBeGreaterThan(0)
      unmount()
    }
  })
})
