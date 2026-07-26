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
  absorbAttemptRow: vi.fn(async () => {}),
  addAttemptTries: vi.fn(async () => {}),
}))
vi.mock('./ascents', () => ({
  useAscents: () => ({ status: 'loaded', ascents: ascentsMock.rows, error: null }),
  createAscent: ascentsMock.createAscent,
  deleteAscent: ascentsMock.deleteAscent,
  updateAscent: ascentsMock.updateAscent,
  absorbAttemptRow: ascentsMock.absorbAttemptRow,
  addAttemptTries: ascentsMock.addAttemptTries,
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
    await waitFor(() => expect(ascentsMock.absorbAttemptRow).toHaveBeenCalledWith('att-1', 3))
  })

  it('never deletes when there is no absorb target', async () => {
    renderSheet(createTarget({ tries: 2 }))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ascentsMock.createAscent).toHaveBeenCalledTimes(1))
    expect(ascentsMock.absorbAttemptRow).not.toHaveBeenCalled()
  })

  it('re-dated off today: keeps the attempt row and drops its tries from the send', async () => {
    // Seed = 3 earlier-today tries (all on the persisted attempt row) + this send.
    renderSheet(createTarget({ tries: 4, absorb: { id: 'att-1', tries: 3 }, earlierTriesToday: 3 }))

    // Backdate to a past day: those 3 tries belong to TODAY, so the save must keep
    // today's attempt row AND not carry its tries onto the backdated send (no double
    // count). (The drawer portals to document.body — query the document.)
    const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-07-23T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ascentsMock.createAscent).toHaveBeenCalledTimes(1))
    // The send carries only its own try (4 − 3 earlier), not the folded-in total.
    expect(ascentsMock.createAscent).toHaveBeenCalledWith(expect.objectContaining({ tries: 1 }))
    // Today's persisted attempt row is untouched (all 3 tries already live on it).
    expect(ascentsMock.absorbAttemptRow).not.toHaveBeenCalled()
    expect(ascentsMock.addAttemptTries).not.toHaveBeenCalled()
  })

  it('re-dated off today: flushes the inline-only tries onto today, not the send', async () => {
    // Seed = 3 earlier-today tries, but only 1 is on a persisted attempt row; the other
    // 2 are inline-stepper tries that were folded into the seed but never written.
    renderSheet(createTarget({ tries: 4, absorb: { id: 'att-1', tries: 1 }, earlierTriesToday: 3 }))

    const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-07-23T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ascentsMock.createAscent).toHaveBeenCalledTimes(1))
    // Send keeps only its own try (4 − 3 earlier).
    expect(ascentsMock.createAscent).toHaveBeenCalledWith(expect.objectContaining({ tries: 1 }))
    // The 2 never-persisted inline tries land on today's attempt row so they aren't lost.
    await waitFor(() =>
      expect(ascentsMock.addAttemptTries).toHaveBeenCalledWith(
        expect.objectContaining({ addTries: 2, sourceCatalogId: 'cat-1' }),
      ),
    )
    expect(ascentsMock.absorbAttemptRow).not.toHaveBeenCalled()
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

  it('renders the earlier-tries and prior-days breakdown lines, making the send explicit', () => {
    renderSheet(createTarget({ tries: 4, earlierTriesToday: 3, priorDays: 2 }))
    expect(
      screen.getByText(/3 tries from earlier today \+ this send · Tried on 2 earlier days/),
    ).toBeInTheDocument()
  })

  it('re-dating off today drops the earlier tries from the display and notes they stay put', () => {
    renderSheet(createTarget({ tries: 4, earlierTriesToday: 3, absorb: { id: 'att-1', tries: 3 } }))
    // On today: total folds in the 3 earlier tries and says so.
    expect(screen.getByText(/3 tries from earlier today \+ this send/)).toBeInTheDocument()

    const dateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-07-23T10:00' } })

    // Off today: the earlier tries no longer ride along — the send shows as its own
    // one-try Flash, and a note explains today's tries are kept separately.
    expect(screen.queryByText(/from earlier today/)).not.toBeInTheDocument()
    expect(screen.getByText('Flash')).toBeInTheDocument()
    expect(screen.getByText(/Today's 3 tries stay as a separate entry/)).toBeInTheDocument()
  })
})
