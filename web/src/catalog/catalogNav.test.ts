import { beforeEach, describe, expect, it } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { catalogNavTarget, catalogNavTargetForList } from './catalogNav'

beforeEach(() => {
  localStorage.clear()
})

describe('catalogNavTargetForList', () => {
  it('targets the list’s board catalog and sets the list filter', () => {
    const board = boardByLayoutId(5)!
    const t = catalogNavTargetForList(board, 'list-1')
    expect(t.to).toBe('/board/$layoutId/catalog')
    expect(t.params).toEqual({ layoutId: '5' })
    expect(t.search.list).toBe('list-1')
  })

  it('replaces the seed’s list value with the given id (does not merge)', () => {
    const board = boardByLayoutId(5)!
    // Seed carries a different list; the explicit id must win (spread override, R7).
    localStorage.setItem(`catalogFilters_5_40`, JSON.stringify({ listFilter: ['stale'] }))
    const t = catalogNavTargetForList(board, 'only-this')
    expect(t.search.list).toBe('only-this')
  })

  it('preserves other seeded facets from catalogNavTarget (only list differs)', () => {
    const board = boardByLayoutId(5)!
    const base = catalogNavTarget(board)
    const t = catalogNavTargetForList(board, 'list-1')
    expect({ ...t.search, list: base.search.list }).toEqual(base.search)
  })
})
