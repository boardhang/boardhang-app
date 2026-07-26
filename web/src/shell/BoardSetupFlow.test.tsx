import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { BoardInstance, SharedBoardMirror } from '../board/boardInstance'
import {
  addBoard,
  getActiveHoldSetsRaw,
  getAddedInstanceIds,
  getAngle,
  instanceById,
} from '../board/boardStore'
import { BoardSetupFlow } from './BoardSetupFlow'

const masters = boardByLayoutId(5)! // angles [40, 25], 7 hold sets

const mirror = (over: Partial<SharedBoardMirror> = {}): SharedBoardMirror => ({
  boardId: 'b1',
  role: 'member',
  name: 'Gym wall',
  layoutId: 5,
  angleMode: 'fixed',
  canonicalAngle: 25,
  canonicalHoldSetsRaw: '17|18',
  ...over,
})

/** Seed a shared instance directly in storage and return it. */
function seedShared(over: Partial<SharedBoardMirror> = {}): BoardInstance {
  const m = mirror(over)
  localStorage.setItem('addedBoards', 'S:b1')
  localStorage.setItem('activeBoardId', 'S:b1')
  localStorage.setItem('sharedBoard__S:b1', JSON.stringify(m))
  window.dispatchEvent(new StorageEvent('storage'))
  return instanceById('S:b1')!
}

/** The angle / hold-set toggles currently rendered. */
const toggles = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
const angleToggle = (deg: number) => screen.getByRole('button', { name: `${deg}°` })

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage'))
})

describe('BoardSetupFlow — guided add', () => {
  it('walks layout to angle to hold sets, then adds the board with those choices', () => {
    const onClose = vi.fn()
    render(<BoardSetupFlow sharingAvailable={false} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /MoonBoard Masters 2019/ }))
    expect(screen.getByText('What angle is it set at?')).toBeInTheDocument()
    fireEvent.click(angleToggle(25))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Which hold sets are installed?')).toBeInTheDocument()
    // Drop one hold set, so the committed value is genuinely the user's choice.
    fireEvent.click(toggles()[0])
    fireEvent.click(screen.getByRole('button', { name: 'Add board' }))

    expect(getAddedInstanceIds()).toEqual(['5'])
    const created = instanceById('5')!
    expect(created.shared).toBeUndefined() // private, no sharing involved
    expect(getAngle(created)).toBe(25)
    expect(getActiveHoldSetsRaw(created)).not.toBe('') // a real subset was stored
    expect(onClose).toHaveBeenCalled()
  })

  it('skips the angle step for a single-angle board, which has no choice to make', () => {
    render(<BoardSetupFlow sharingAvailable={false} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Mini MoonBoard 2025/ }))
    expect(screen.queryByText('What angle is it set at?')).toBeNull()
    expect(screen.getByText('Which hold sets are installed?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add board' }))
    expect(getAngle(instanceById('7')!)).toBe(40) // its one bundled angle
  })

  it('writes nothing when abandoned before the final step', () => {
    const onClose = vi.fn()
    render(<BoardSetupFlow sharingAvailable={false} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /MoonBoard Masters 2019/ }))
    fireEvent.click(angleToggle(25))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(toggles()[0])

    // Abandon: no instance, and no per-instance keys left behind either.
    expect(getAddedInstanceIds()).toEqual([])
    expect(localStorage.getItem('angle_5')).toBeNull()
    expect(localStorage.getItem('activeHoldSets_5')).toBeNull()
  })

  it('restores the prior step’s selection when stepping back', () => {
    render(<BoardSetupFlow sharingAvailable={false} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /MoonBoard Masters 2019/ }))
    fireEvent.click(angleToggle(25))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('What angle is it set at?')).toBeInTheDocument()
    expect(angleToggle(25)).toHaveAttribute('aria-pressed', 'true') // choice survived
    expect(angleToggle(40)).toHaveAttribute('aria-pressed', 'false')
  })

  it('steps back past a skipped angle step, straight to the layout picker', () => {
    render(<BoardSetupFlow sharingAvailable={false} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Mini MoonBoard 2025/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Which board do you have?')).toBeInTheDocument()
  })

  it('refuses to empty the installed hold sets, disabling the last one on', () => {
    render(<BoardSetupFlow sharingAvailable={false} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Mini MoonBoard 2025/ }))
    expect(toggles()).toHaveLength(4)

    fireEvent.click(toggles()[0])
    fireEvent.click(toggles()[1])
    fireEvent.click(toggles()[2])
    const stillOn = toggles().filter((t) => t.getAttribute('aria-pressed') === 'true')
    expect(stillOn).toHaveLength(1)
    expect(stillOn[0]).toBeDisabled()
  })

  it('ends after hold sets while sharing is unavailable — no share step is reachable', () => {
    render(<BoardSetupFlow sharingAvailable={false} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Mini MoonBoard 2025/ }))
    expect(screen.getByRole('button', { name: 'Add board' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull() // no name field to fill
  })

  it('offers only boards the device does not already hold', () => {
    addBoard(7)
    render(<BoardSetupFlow sharingAvailable={false} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /Mini MoonBoard 2025/ })).toBeNull()
    expect(screen.getByRole('button', { name: /MoonBoard Masters 2019/ })).toBeInTheDocument()
  })

  it('moves focus to each step’s heading, so the step change is announced', () => {
    render(<BoardSetupFlow sharingAvailable={false} onClose={() => {}} />)
    expect(screen.getByText('Which board do you have?')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: /MoonBoard Masters 2019/ }))
    expect(screen.getByText('What angle is it set at?')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Which hold sets are installed?')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('What angle is it set at?')).toHaveFocus()
  })
})

describe('BoardSetupFlow — configuring a local board', () => {
  it('edits the angle in place, without a step to walk', () => {
    addBoard(5)
    const instance = instanceById('5')!
    render(<BoardSetupFlow instance={instance} sharingAvailable={false} onClose={() => {}} />)

    expect(screen.getByText(masters.name)).toBeInTheDocument()
    expect(angleToggle(40)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(angleToggle(25))
    expect(getAngle(instanceById('5')!)).toBe(25)
  })

  it('omits the angle control for a single-angle board', () => {
    addBoard(7)
    render(<BoardSetupFlow instance={instanceById('7')!} sharingAvailable={false} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: '40°' })).toBeNull()
    expect(toggles()).toHaveLength(4) // just the hold sets
  })

  it('removes the board only on a second, deliberate tap', () => {
    addBoard(5)
    const onClose = vi.fn()
    render(<BoardSetupFlow instance={instanceById('5')!} sharingAvailable={false} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove board' }))
    expect(getAddedInstanceIds()).toEqual(['5']) // first tap only arms it
    fireEvent.click(screen.getByRole('button', { name: /Confirm — remove/ }))
    expect(getAddedInstanceIds()).toEqual([])
    expect(onClose).toHaveBeenCalled()
  })

  it('offers no detach action on a board nobody else owns', () => {
    addBoard(5)
    render(<BoardSetupFlow instance={instanceById('5')!} sharingAvailable={false} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /Make this my own board/ })).toBeNull()
  })
})

describe('BoardSetupFlow — configuring a board someone else owns', () => {
  it('states a fixed board’s angle and hold sets as read-only, with no controls', () => {
    const instance = seedShared({ angleMode: 'fixed', canonicalAngle: 25 })
    render(<BoardSetupFlow instance={instance} sharingAvailable={false} onClose={() => {}} />)

    expect(screen.getByText('Gym wall')).toBeInTheDocument()
    expect(toggles()).toHaveLength(0)
    expect(screen.getByText(/fixed by the board’s owner/)).toBeInTheDocument()
    expect(screen.getByText(/set by the board’s owner/)).toBeInTheDocument()
  })

  it('lets a member pick the angle on an adjustable wall, but still not the hold sets', () => {
    const instance = seedShared({ angleMode: 'adjustable', canonicalAngle: 40 })
    render(<BoardSetupFlow instance={instance} sharingAvailable={false} onClose={() => {}} />)

    expect(angleToggle(40)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(angleToggle(25))
    expect(getAngle(instanceById('S:b1')!)).toBe(25) // device-local, canonical untouched
    expect(instanceById('S:b1')!.shared!.canonicalAngle).toBe(40)
    expect(screen.getByText(/set by the board’s owner/)).toBeInTheDocument()
  })

  it('offers detach, which keeps the board and its setup but stops following the owner', () => {
    const instance = seedShared({ angleMode: 'fixed', canonicalAngle: 25 })
    const onClose = vi.fn()
    render(<BoardSetupFlow instance={instance} sharingAvailable={false} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /Make this my own board/ }))
    expect(instanceById('S:b1')!.shared).toBeDefined() // first tap only arms it
    fireEvent.click(screen.getByRole('button', { name: /Confirm — stop following/ }))

    const after = instanceById('S:b1')!
    expect(after.shared).toBeUndefined() // now a plain local board
    expect(after.instanceId).toBe('S:b1') // id was not re-keyed
    expect(getAngle(after)).toBe(25) // kept what it was browsing at
    expect(getActiveHoldSetsRaw(after)).toBe('17|18')
    expect(onClose).toHaveBeenCalled()
  })

  it('gives the owner of a shared board the full controls', () => {
    const instance = seedShared({ role: 'owner', angleMode: 'fixed', canonicalAngle: 25 })
    render(<BoardSetupFlow instance={instance} sharingAvailable={false} onClose={() => {}} />)

    expect(angleToggle(25)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/fixed by the board’s owner/)).toBeNull()
    expect(screen.queryByText(/set by the board’s owner/)).toBeNull()
    // Their own board is not something to detach from.
    expect(screen.queryByRole('button', { name: /Make this my own board/ })).toBeNull()
  })

  it('renders no share affordance while sharing is unavailable', () => {
    const instance = seedShared()
    render(<BoardSetupFlow instance={instance} sharingAvailable={false} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /rotate|revoke|leave/i })).toBeNull()
  })
})
