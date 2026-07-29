import { beforeEach, describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT,
  clearAllProblemDrafts,
  clearDraft,
  readDraft,
  readSaveIntent,
  writeDraft,
  writeSaveIntent,
} from './problemDraftStore'

beforeEach(() => {
  localStorage.clear()
})

describe('problemDraftStore', () => {
  it('round-trips a draft per board+angle', () => {
    const draft = {
      holds: [{ c: 0, r: 1, t: 'start' as const }],
      name: 'Crimpy',
      grade: '6C',
      visibility: 'public' as const,
    }
    writeDraft(7, 40, draft)

    expect(readDraft(7, 40)).toEqual(draft)
    // A different slab has its own draft — switching angle or board never inherits one.
    expect(readDraft(7, 25)).toEqual(EMPTY_DRAFT)
    expect(readDraft(5, 40)).toEqual(EMPTY_DRAFT)
  })

  it('clears a draft', () => {
    writeDraft(7, 40, { ...EMPTY_DRAFT, holds: [{ c: 1, r: 2, t: 'end' }] })
    clearDraft(7, 40)
    expect(readDraft(7, 40)).toEqual(EMPTY_DRAFT)
  })

  it('clears every slab’s draft and intent, leaving unrelated storage alone', () => {
    writeDraft(7, 40, { ...EMPTY_DRAFT, name: 'A' })
    writeSaveIntent(7, 40, true)
    writeDraft(5, 25, { ...EMPTY_DRAFT, name: 'B' })
    localStorage.setItem('catalogRecents_7_40', JSON.stringify(['user:x']))

    clearAllProblemDrafts()

    expect(readDraft(7, 40)).toEqual(EMPTY_DRAFT)
    expect(readSaveIntent(7, 40)).toBe(false)
    expect(readDraft(5, 25)).toEqual(EMPTY_DRAFT)
    expect(localStorage.getItem('catalogRecents_7_40')).toBe(JSON.stringify(['user:x']))
  })

  it('fills the fields a draft written by an earlier build is missing', () => {
    // The save sheet's fields joined the shape after the editor shipped; a holds-only
    // entry must still restore rather than blanking the author's work.
    localStorage.setItem('problemDraft_7_40', JSON.stringify({ holds: [{ c: 2, r: 3, t: 'left' }] }))
    expect(readDraft(7, 40)).toEqual({
      holds: [{ c: 2, r: 3, t: 'left' }],
      name: '',
      grade: '',
      visibility: 'private',
    })
  })

  it('degrades a corrupt or hand-edited entry to no draft instead of throwing', () => {
    localStorage.setItem('problemDraft_7_40', 'not json')
    expect(readDraft(7, 40)).toEqual(EMPTY_DRAFT)

    localStorage.setItem('problemDraft_7_40', JSON.stringify({ holds: 'nope' }))
    expect(readDraft(7, 40).holds).toEqual([])

    // Individual malformed holds are dropped; valid siblings survive.
    localStorage.setItem(
      'problemDraft_7_40',
      JSON.stringify({ holds: [{ c: 0, r: 1, t: 'bogus' }, null, { c: 1, r: 2, t: 'match' }] }),
    )
    expect(readDraft(7, 40).holds).toEqual([{ c: 1, r: 2, t: 'match' }])
  })
})
