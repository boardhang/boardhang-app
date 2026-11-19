import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BOARDS, boardByLayoutId } from '../board/boards'
import { BoardTile } from './BoardTile'

const board = boardByLayoutId(3)! // MoonBoard 2024

function renderTile(over: Partial<React.ComponentProps<typeof BoardTile>> = {}) {
  const onSelect = vi.fn()
  const onCorner = vi.fn()
  render(
    <BoardTile
      board={board}
      title="MB 2024"
      angle={40}
      active={false}
      label="Switch to MoonBoard 2024"
      onSelect={onSelect}
      corner={{ icon: <svg />, label: 'Edit MoonBoard 2024', onClick: onCorner }}
      {...over}
    />,
  )
  return { onSelect, onCorner }
}

describe('BoardTile', () => {
  it('shows the title, second line and angle it is given', () => {
    renderTile({ subtitle: 'Back wall', angle: 25 })
    expect(screen.getByText('MB 2024')).toBeInTheDocument()
    expect(screen.getByText('Back wall')).toBeInTheDocument()
    expect(screen.getByText('25°')).toBeInTheDocument()
  })

  it('shows "Browse" on the active tile only', () => {
    renderTile({ active: true })
    expect(screen.getByText('Browse')).toBeInTheDocument()
  })

  it('does not show "Browse" on an inactive tile', () => {
    renderTile()
    expect(screen.queryByText('Browse')).toBeNull()
  })

  it('tapping the tile body calls the main handler only', () => {
    const { onSelect, onCorner } = renderTile()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to MoonBoard 2024' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onCorner).not.toHaveBeenCalled()
  })

  it('tapping the corner button calls the corner handler only', () => {
    const { onSelect, onCorner } = renderTile()
    fireEvent.click(screen.getByRole('button', { name: 'Edit MoonBoard 2024' }))
    expect(onCorner).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not nest the corner button inside the tile body', () => {
    renderTile()
    const body = screen.getByRole('button', { name: 'Switch to MoonBoard 2024' })
    expect(body.querySelector('button')).toBeNull()
  })

  it('renders the dot only when the flag is set, with the text "New benchmarks"', () => {
    renderTile({ dot: true })
    expect(screen.getByTestId('new-benchmarks-dot-3')).toHaveTextContent('New benchmarks')
  })

  it('renders no dot by default', () => {
    renderTile()
    expect(screen.queryByTestId('new-benchmarks-dot-3')).toBeNull()
  })

  it('marks the active tile with aria-current', () => {
    renderTile({ active: true, label: 'Browse MoonBoard 2024' })
    expect(screen.getByRole('button', { name: 'Browse MoonBoard 2024' })).toHaveAttribute('aria-current', 'true')
  })

  it('leaves aria-current off an inactive tile', () => {
    renderTile()
    expect(screen.getByRole('button', { name: 'Switch to MoonBoard 2024' })).not.toHaveAttribute('aria-current')
  })

  it('renders with no corner action', () => {
    renderTile({ corner: undefined })
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('renders every registry board', () => {
    for (const b of BOARDS) {
      const { unmount } = render(
        <BoardTile board={b} title={b.name} angle={b.angles[0]} active={false} label={b.name} onSelect={() => {}} />,
      )
      expect(screen.getByRole('button', { name: b.name })).toBeInTheDocument()
      unmount()
    }
  })
})
