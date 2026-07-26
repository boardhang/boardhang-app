import { describe, expect, it } from 'vitest'
import { triesLabel, tryBucket } from './tryBucket'

describe('tryBucket', () => {
  it('buckets by attempt count', () => {
    expect(tryBucket(1)).toBe('Flash')
    expect(tryBucket(2)).toBe('2nd')
    expect(tryBucket(3)).toBe('3rd')
    expect(tryBucket(7)).toBe('4+ tries')
  })
})

describe('triesLabel', () => {
  it('labels a one-try send Flash only on a never-tried problem', () => {
    expect(triesLabel(1, true)).toBe('Flash')
    expect(triesLabel(1, true, true)).toBe('Session flash')
  })

  it('never labels an unsent attempt Flash', () => {
    expect(triesLabel(1, false)).toBe('1 try')
    expect(triesLabel(1, false, true)).toBe('1 try')
  })

  it('shows plain counts past one try', () => {
    expect(triesLabel(4, true)).toBe('4 tries')
    expect(triesLabel(4, true, true)).toBe('4 tries')
  })
})
