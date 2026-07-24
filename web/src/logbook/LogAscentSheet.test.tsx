import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogAscentSheet, type LogTarget } from './LogAscentSheet'
import type { Ascent } from './ascents'

// The sheet's saves hit the logbook store — swap it for spies plus a mutable row
// list so tests control the problem's logged history (edit-mode label derivation).
const ascentsMock = vi.hoisted(() => ({
  rows: [] as unknown[],
  createAscent: vi.fn(async () => {}),
  deleteAscent: vi.fn(async () => {}),
  updateAscent: vi.fn(async () => {}),
}))
vi.mock('./ascents', () => ({
  useAscents: () => ({ status: 'loaded', ascents: ascentsMock.rows, error: null }),
  createAscent: ascentsMock.createAscent,
  deleteAscent: ascentsMock.deleteAscent,
  updateAscent: ascentsMock.updateAscent,
}))

function ascent(over: Partial<Ascent> = {}): Ascent {
  return {
    id: 'x',
    date: '2026-07-20T10:00:00',
    sourceCatalogId: 'cat-1',
    userProblemId: null,
    problemName: 'MOON GIRL',
    problemGrade: '6B+',
    votedGrade: '6B+',
    tries: 1,
    stars: 0,
    comment: '',
    sent: true,
    boardLayoutId: 7,
    ...over,
  }
}

function createTarget(over: Partial<Extract<LogTarget, { kind: 'create' }>> = {}): LogTarget {
  return {
    kind: 'create',
    sourceCatalogId: 'cat-1',
    problemName: 'MOON GIRL',
    problemGrade: '6B+',
    boardLayoutId: 7,
    sent: true,
    tries: 1,
    ...over,
  }
}

function renderSheet(target: LogTarget) {
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()
  const utils = render(
    <LogAscentSheet open onOpenChange={onOpenChange} target={target} onSaved={onSaved} />,
  )
  return { ...utils, onOpenChange, onSaved }
}

beforeEach(() => {
  ascentsMock.rows = []
  vi.clearAllMocks()
})

describe('LogAscentSheet — absorb on save', () => {
  it('folds the seeded tries into the send and soft-deletes the absorbed attempt row', async () => {
    renderSheet(createTarget({ tries: 4, absorb: { id: 'att-1', tries: 3 }, earlierTriesToday: 3 }))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ascentsMock.createAscent).toHaveBeenCalledTimes(1))
    expect(ascentsMock.createAscent).toHaveBeenCalledWith(
      expect.objectContaining({ tries: 4, sent: true, sourceCatalogId: 'cat-1' }),
    )
    await waitFor(() => expect(ascentsMock.deleteAscent).toHaveBeenCalledWith('att-1'))
  })

  it('never deletes when there is no absorb target', async () => {
    renderSheet(createTarget({ tries: 2 }))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ascentsMock.createAscent).toHaveBeenCalledTimes(1))
    expect(ascentsMock.deleteAscent).not.toHaveBeenCalled()
  })

  it('skips the absorb delete when the send is re-dated off today', async () => {
    renderSheet(createTarget({ tries: 4, absorb: { id: 'att-1', tries: 3 }, earlierTriesToday: 3 }))

    // Backdate to yesterday: the absorb target belongs to TODAY's local day, so the
    // save must keep today's attempt row instead of erasing it. (The drawer portals
    // to document.body, so query the document, not the render container.)
    const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-07-23T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ascentsMock.createAscent).toHaveBeenCalledTimes(1))
    expect(ascentsMock.deleteAscent).not.toHaveBeenCalled()
  })
})

describe('LogAscentSheet — labels and breakdown', () => {
  it('labels a 1-try send Flash without history and Session flash with it', () => {
    const first = renderSheet(createTarget({ tries: 1, hasPriorHistory: false }))
    expect(screen.getByText('Flash')).toBeInTheDocument()
    first.unmount()

    renderSheet(createTarget({ tries: 1, hasPriorHistory: true }))
    expect(screen.getByText('Session flash')).toBeInTheDocument()
  })

  it('derives Session flash from earlier-dated rows in edit mode', () => {
    ascentsMock.rows = [ascent({ id: 'earlier', sent: false, tries: 2, date: '2026-07-19T10:00:00' })]
    renderSheet({ kind: 'edit', ascent: ascent({ id: 'later', tries: 1, date: '2026-07-20T10:00:00' }) })
    expect(screen.getByText('Session flash')).toBeInTheDocument()
  })

  it('renders the earlier-tries and prior-days breakdown lines', () => {
    renderSheet(createTarget({ tries: 4, earlierTriesToday: 3, priorDays: 2 }))
    expect(
      screen.getByText(/Includes 3 tries from earlier today · Tried on 2 earlier days/),
    ).toBeInTheDocument()
  })
})
