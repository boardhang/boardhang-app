import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecents, getRecentIds, pruneRecents, recordRecent } from './recentsStore'

beforeEach(() => localStorage.clear())

describe('recentsStore', () => {
  it('records views most-recent-first, deduped and capped at 5', () => {
    expect(getRecentIds(7, 40)).toEqual([])
    for (const id of ['a', 'b', 'c']) recordRecent(7, 40, id)
    expect(getRecentIds(7, 40)).toEqual(['c', 'b', 'a'])

    recordRecent(7, 40, 'a') // re-view moves to front, no duplicate
    expect(getRecentIds(7, 40)).toEqual(['a', 'c', 'b'])

    for (const id of ['d', 'e', 'f']) recordRecent(7, 40, id)
    expect(getRecentIds(7, 40)).toEqual(['f', 'e', 'd', 'a', 'c']) // capped at 5
  })

  it('is scoped per board+angle', () => {
    recordRecent(7, 40, 'mini')
    recordRecent(5, 25, 'masters')
    expect(getRecentIds(7, 40)).toEqual(['mini'])
    expect(getRecentIds(5, 25)).toEqual(['masters'])
  })

  it('clears a slab without touching others', () => {
    recordRecent(7, 40, 'a')
    recordRecent(5, 25, 'b')
    clearRecents(7, 40)
    expect(getRecentIds(7, 40)).toEqual([])
    expect(getRecentIds(5, 25)).toEqual(['b'])
  })

  it('prunes a dangling id from every slab, leaving the rest of each history', () => {
    // A deleted custom problem can sit in more than one slab's history and the caller
    // generally knows only its id, so the sweep is board-agnostic.
    recordRecent(7, 40, 'user:gone')
    recordRecent(7, 40, 'keep')
    recordRecent(5, 25, 'user:gone')
    recordRecent(5, 25, 'also-keep')

    pruneRecents(['user:gone'])

    expect(getRecentIds(7, 40)).toEqual(['keep'])
    expect(getRecentIds(5, 25)).toEqual(['also-keep'])
  })

  it('frees the capped slot a dangling id was holding', () => {
    // Five dangling ids resolve to nothing, so the Recents sheet — and the FAB that opens
    // it — reads as empty while the history still looks full to the store.
    for (const id of ['user:g1', 'user:g2', 'user:g3', 'user:g4', 'user:g5']) {
      recordRecent(7, 40, id)
    }
    pruneRecents(['user:g1', 'user:g2', 'user:g3', 'user:g4', 'user:g5'])
    expect(getRecentIds(7, 40)).toEqual([])

    recordRecent(7, 40, 'live')
    expect(getRecentIds(7, 40)).toEqual(['live'])
  })
})
