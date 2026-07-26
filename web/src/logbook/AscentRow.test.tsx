import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { AscentRow } from './AscentRow'
import type { Ascent } from './ascents'

const board = boardByLayoutId(7)!

function ascent(over: Partial<Ascent> = {}): Ascent {
  return {
    id: 'x',
    date: '2026-01-01T00:00:00.000Z',
    sourceCatalogId: 'p1',
    userProblemId: null,
    problemName: 'Test Problem',
    problemGrade: '6B',
    votedGrade: '6B',
    tries: 1,
    stars: 0,
    comment: '',
    sent: true,
    boardLayoutId: 7,
    ...over,
  }
}

describe('AscentRow — sent vs attempt', () => {
  it('shows the green Sent check and no Attempt pill for a send', () => {
    render(<AscentRow ascent={ascent({ sent: true })} board={board} onEdit={vi.fn()} />)
    expect(screen.getByLabelText('Sent')).toBeInTheDocument()
    expect(screen.queryByText('Attempt')).toBeNull()
  })

  it('shows the Attempt pill and no Sent check for an attempt', () => {
    render(<AscentRow ascent={ascent({ sent: false })} board={board} onEdit={vi.fn()} />)
    expect(screen.getByText('Attempt')).toBeInTheDocument()
    expect(screen.queryByLabelText('Sent')).toBeNull()
  })
})

describe('AscentRow — Flash vs Session flash', () => {
  it('labels a 1-try send Flash without prior history', () => {
    render(<AscentRow ascent={ascent({ tries: 1, sent: true })} board={board} onEdit={vi.fn()} />)
    expect(screen.getByText('Flash')).toBeInTheDocument()
  })

  it('labels a 1-try send Session flash when the problem has prior history', () => {
    render(
      <AscentRow
        ascent={ascent({ tries: 1, sent: true })}
        board={board}
        onEdit={vi.fn()}
        hasPriorHistory
      />,
    )
    expect(screen.getByText('Session flash')).toBeInTheDocument()
    expect(screen.queryByText('Flash')).toBeNull()
  })
})
