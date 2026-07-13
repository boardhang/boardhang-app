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

  it('keeps the name-line check as a fallback until self is actually in the pill', () => {
    // Session active but the projection has not (yet) placed self — empty senders (loading/stale):
    // the local self-check stays on the name line so a known send is never hidden with no home.
    const { rerender, container } = render(<CatalogRow problem={problem()} board={board} isSent senders={[]} />)
    expect(screen.getByLabelText('Sent')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="avatar-group"]')).toBeNull()
    // Projection lists another member but not self yet: name-line check STILL shows, pill shows them.
    rerender(<CatalogRow problem={problem()} board={board} isSent senders={[sender('a', 'Alice')]} />)
    expect(screen.getByLabelText('Sent')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="avatar-group"]')!.parentElement!.getAttribute('aria-label')).toBe(
      'Sent by Alice',
    )
    // Once self is in the pill, the name-line check is suppressed — the pill is the sole home.
    rerender(<CatalogRow problem={problem()} board={board} isSent senders={[sender('me', 'You', true)]} />)
    expect(screen.queryByLabelText('Sent')).toBeNull()
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

  it('renders a one-avatar sends pill labeled as a single accessible unit', () => {
    const { container } = render(<CatalogRow problem={problem()} board={board} senders={[sender('a', 'Alice')]} />)
    const pill = container.querySelector('[data-slot="avatar-group"]')!.parentElement!
    // The pill is one labeled unit (role=img) so AT announces "Sent by Alice", not its children.
    expect(pill.getAttribute('role')).toBe('img')
    expect(pill.getAttribute('aria-label')).toBe('Sent by Alice')
    // The green check is decorative inside the labeled pill (no redundant "Sent" for AT).
    expect(pill.querySelector('[aria-label="Sent"]')).toBeNull()
    expect(pill.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1)
    expect(container.querySelector('[data-slot="avatar-group-count"]')).toBeNull()
  })

  it('renders self ringed, labeled "You", at xxs size', () => {
    const { container } = render(<CatalogRow problem={problem()} board={board} senders={[sender('me', 'You', true)]} />)
    expect(screen.getByTitle('You')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="avatar-group"]')!.parentElement!.getAttribute('aria-label')).toBe(
      'Sent by You',
    )
    const avatar = container.querySelector('[data-slot="avatar"]')!
    expect(avatar.getAttribute('data-size')).toBe('xxs')
    expect(avatar.querySelector('[data-slot="avatar-fallback"]')!.className).toContain('ring-primary') // self ring
  })

  it('caps at three avatars and shows a +K overflow count', () => {
    const senders = ['a', 'b', 'c', 'd', 'e'].map((id) => sender(id, id.toUpperCase()))
    const { container } = render(<CatalogRow problem={problem()} board={board} senders={senders} />)
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3)
    const count = container.querySelector('[data-slot="avatar-group-count"]')!
    expect(count.textContent).toBe('+2')
    expect(container.querySelector('[data-slot="avatar-group"]')!.parentElement!.getAttribute('aria-label')).toBe(
      'Sent by A, B, C, +2',
    )
  })

  it('renders no sends pill when senders is absent or empty', () => {
    const { container, rerender } = render(<CatalogRow problem={problem()} board={board} />)
    expect(container.querySelector('[data-slot="avatar-group"]')).toBeNull()
    rerender(<CatalogRow problem={problem()} board={board} senders={[]} />)
    expect(container.querySelector('[data-slot="avatar-group"]')).toBeNull()
  })

  it('dims the sends pill when sendersDimmed', () => {
    const { container, rerender } = render(
      <CatalogRow problem={problem()} board={board} senders={[sender('a', 'Alice')]} />,
    )
    const pillClass = () => container.querySelector('[data-slot="avatar-group"]')!.parentElement!.className
    expect(pillClass()).not.toContain('opacity-50')
    rerender(<CatalogRow problem={problem()} board={board} senders={[sender('a', 'Alice')]} sendersDimmed />)
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
