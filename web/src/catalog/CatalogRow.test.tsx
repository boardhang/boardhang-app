import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { CatalogRow } from './CatalogRow'
import type { CatalogProblem } from './catalogSync'
import type { SenderChip } from './useMemberSenders'

const board = boardByLayoutId(7)!

function sender(userId: string, label: string, isSelf = false): SenderChip {
  return { userId, isSelf, label, initials: label.slice(0, 2).toUpperCase(), avatarUrl: null }
}

function problem(over: Partial<CatalogProblem> = {}): CatalogProblem {
  return {
    source_catalog_id: 'p1',
    layout_id: 7,
    angle: 40,
    name: 'Test Problem',
    grade: '6B',
    user_grade: null,
    setter: 'Alice',
    stars: 0,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds: [{ c: 0, r: 1, t: 'start' }],
    ...over,
  }
}

describe('CatalogRow', () => {
  it('renders name, grade pill, and setter subtitle', () => {
    render(<CatalogRow problem={problem()} board={board} />)
    expect(screen.getByText('Test Problem')).toBeInTheDocument()
    expect(screen.getByText('6B')).toBeInTheDocument()
    expect(screen.getByText('by Alice')).toBeInTheDocument()
  })

  it('falls back to hold count when the setter is empty', () => {
    render(<CatalogRow problem={problem({ setter: '', holds: [{ c: 0, r: 1, t: 'start' }] })} board={board} />)
    expect(screen.getByText('1 holds')).toBeInTheDocument()
  })

  it('shows stars/repeats only when greater than zero', () => {
    const { rerender } = render(<CatalogRow problem={problem({ stars: 0, repeats: 0 })} board={board} />)
    expect(screen.queryByText('0')).toBeNull()
    rerender(<CatalogRow problem={problem({ stars: 3, repeats: 12 })} board={board} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('shows the method label when present', () => {
    render(<CatalogRow problem={problem({ method: 'Footless' })} board={board} />)
    expect(screen.getByText('Footless')).toBeInTheDocument()
  })

  it('shows benchmark and favorite badges conditionally', () => {
    const { rerender } = render(<CatalogRow problem={problem()} board={board} />)
    expect(screen.queryByLabelText('Benchmark')).toBeNull()
    expect(screen.queryByLabelText('Favorite')).toBeNull()
    rerender(<CatalogRow problem={problem({ is_benchmark: true })} board={board} isFavorite />)
    expect(screen.getByLabelText('Benchmark')).toBeInTheDocument()
    expect(screen.getByLabelText('Favorite')).toBeInTheDocument()
  })

  it('shows the name-line sent check only when isSent (solo, no session)', () => {
    const { rerender } = render(<CatalogRow problem={problem()} board={board} />)
    expect(screen.queryByLabelText('Sent')).toBeNull()
    rerender(<CatalogRow problem={problem()} board={board} isSent />)
    expect(screen.getByLabelText('Sent')).toBeInTheDocument()
  })

  it('suppresses the name-line check in a session — send status moves to the pill', () => {
    // In a session with no pill for this row (you have not sent it), no "Sent" mark shows at all.
    const { rerender, container } = render(
      <CatalogRow problem={problem()} board={board} isSent sessionActive />,
    )
    expect(screen.queryByLabelText('Sent')).toBeNull()
    expect(container.querySelector('[data-slot="avatar-group"]')).toBeNull()
    // With a pill (you are a sender), the check lives inside the pill instead.
    rerender(
      <CatalogRow problem={problem()} board={board} isSent sessionActive senders={[sender('me', 'You', true)]} />,
    )
    const group = container.querySelector('[data-slot="avatar-group"]')!
    expect(group.parentElement!.querySelector('[aria-label="Sent"]')).not.toBeNull()
  })

  it('renders the board thumbnail only when enabled', () => {
    const { rerender, container } = render(<CatalogRow problem={problem()} board={board} />)
    expect(container.querySelector('.catalog-board')).toBeNull()
    rerender(<CatalogRow problem={problem()} board={board} showThumbnail />)
    expect(container.querySelector('.catalog-board')).not.toBeNull()
  })

  it('calls onSelect with the problem when clicked', () => {
    const onSelect = vi.fn()
    const p = problem()
    render(<CatalogRow problem={p} board={board} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith(p)
  })

  it('renders a one-avatar sends pill with no overflow and an accessible summary', () => {
    const { container } = render(
      <CatalogRow problem={problem()} board={board} sessionActive senders={[sender('a', 'Alice')]} />,
    )
    const pill = container.querySelector('[data-slot="avatar-group"]')!.parentElement!
    expect(pill.getAttribute('aria-label')).toBe('Sent by Alice')
    expect(pill.querySelector('[aria-label="Sent"]')).not.toBeNull() // green check label
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1)
    expect(container.querySelector('[data-slot="avatar-group-count"]')).toBeNull()
  })

  it('caps at three avatars and shows a +K overflow count', () => {
    const senders = ['a', 'b', 'c', 'd', 'e'].map((id) => sender(id, id.toUpperCase()))
    const { container } = render(<CatalogRow problem={problem()} board={board} sessionActive senders={senders} />)
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3)
    const count = container.querySelector('[data-slot="avatar-group-count"]')!
    expect(count.textContent).toBe('+2')
    expect(container.querySelector('[data-slot="avatar-group"]')!.parentElement!.getAttribute('aria-label')).toBe(
      'Sent by A, B, C, +2',
    )
  })

  it('renders no sends pill when senders is absent or empty', () => {
    const { container, rerender } = render(<CatalogRow problem={problem()} board={board} sessionActive />)
    expect(container.querySelector('[data-slot="avatar-group"]')).toBeNull()
    rerender(<CatalogRow problem={problem()} board={board} sessionActive senders={[]} />)
    expect(container.querySelector('[data-slot="avatar-group"]')).toBeNull()
  })

  it('dims the sends pill when sendersDimmed', () => {
    const { container, rerender } = render(
      <CatalogRow problem={problem()} board={board} sessionActive senders={[sender('a', 'Alice')]} />,
    )
    const pillClass = () => container.querySelector('[data-slot="avatar-group"]')!.parentElement!.className
    expect(pillClass()).not.toContain('opacity-50')
    rerender(
      <CatalogRow problem={problem()} board={board} sessionActive senders={[sender('a', 'Alice')]} sendersDimmed />,
    )
    expect(pillClass()).toContain('opacity-50')
  })

  it('gives each sender avatar a native title and keeps the row a single clickable button', () => {
    const onSelect = vi.fn()
    const p = problem()
    render(<CatalogRow problem={p} board={board} senders={[sender('a', 'Alice')]} onSelect={onSelect} />)
    expect(screen.getByTitle('Alice')).toBeInTheDocument()
    // No nested button inside the row button.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onSelect).toHaveBeenCalledWith(p)
  })
})
