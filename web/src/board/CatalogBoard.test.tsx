import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CatalogHold } from '../catalog/catalogSync'
import { boardByLayoutId } from './boards'
import { CatalogBoard } from './CatalogBoard'

const mini = boardByLayoutId(7)! // 4 hold sets, mini geometry
const standard = boardByLayoutId(2)! // MoonBoard 2016: 3 hold sets, 18-row geometry
const hold = (c: number, r: number, t: CatalogHold['t']): CatalogHold => ({ c, r, t })

function topPercent(el: HTMLElement): number {
  return parseFloat(el.style.top)
}

function leftPercent(el: HTMLElement): number {
  return parseFloat(el.style.left)
}

describe('CatalogBoard', () => {
  it('renders one marker per hold (R17)', () => {
    render(<CatalogBoard board={mini} holds={[hold(0, 1, 'start'), hold(5, 6, 'left')]} />)
    expect(screen.getAllByTestId('hold-marker')).toHaveLength(2)
  })

  it('draws the background and every hold-set overlay by default', () => {
    const { container } = render(<CatalogBoard board={mini} holds={[]} />)
    const imgs = container.querySelectorAll('img')
    // 1 background + 4 mini hold-set overlays.
    expect(imgs).toHaveLength(5)
    expect(container.querySelector('img[src*="minimoonboard-bg"]')).not.toBeNull()
  })

  it('omits overlays for uninstalled hold sets (R10 render side)', () => {
    const { container } = render(
      <CatalogBoard board={mini} holds={[]} visibleHoldSetIds={new Set([28, 29])} />,
    )
    // 1 background + 2 visible overlays.
    expect(container.querySelectorAll('img')).toHaveLength(3)
    expect(container.querySelector('[data-holdset="30"]')).toBeNull()
    expect(container.querySelector('[data-holdset="28"]')).not.toBeNull()
  })

  it('draws only the background when no hold sets are visible', () => {
    // Empty set (nothing installed) differs from undefined (all shown).
    const { container } = render(<CatalogBoard board={mini} holds={[]} visibleHoldSetIds={new Set()} />)
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('img[src*="minimoonboard-bg"]')).not.toBeNull()
  })

  it('renders a full 18-row standard board too', () => {
    const { container } = render(<CatalogBoard board={standard} holds={[hold(0, 18, 'end')]} />)
    // 1 background + 3 MoonBoard 2016 overlays.
    expect(container.querySelectorAll('img')).toHaveLength(4)
    expect(screen.getAllByTestId('hold-marker')).toHaveLength(1)
  })

  it('places row 1 below the top row (R18 bottom-origin)', () => {
    render(<CatalogBoard board={mini} holds={[hold(0, 1, 'start'), hold(0, 12, 'end')]} />)
    const [row1, rowTop] = screen.getAllByTestId('hold-marker')
    expect(topPercent(row1)).toBeGreaterThan(topPercent(rowTop))
  })

  it('places column A left of column K (R18 left-to-right)', () => {
    render(<CatalogBoard board={mini} holds={[hold(0, 6, 'left'), hold(10, 6, 'right')]} />)
    const [colA, colK] = screen.getAllByTestId('hold-marker')
    expect(leftPercent(colA)).toBeLessThan(leftPercent(colK))
  })

  it('collapses move roles to blue when beta is off (default)', () => {
    render(<CatalogBoard board={mini} holds={[hold(5, 6, 'left')]} />)
    expect(screen.getByTestId('hold-marker').dataset.role).toBe('right')
  })

  it('keeps distinct move roles when beta is on', () => {
    render(<CatalogBoard board={mini} holds={[hold(5, 6, 'left')]} showBeta />)
    expect(screen.getByTestId('hold-marker').dataset.role).toBe('left')
  })

  it('exposes no edit affordance (R13 read-only)', () => {
    render(<CatalogBoard board={mini} holds={[hold(0, 1, 'start')]} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTestId('hold-marker').tagName).toBe('DIV')
  })
})
