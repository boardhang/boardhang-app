import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearSearch, setSearchQuery, useSearchQuery } from './searchStore'

beforeEach(() => clearSearch())

describe('searchStore', () => {
  it('tracks the query and clears it', () => {
    const { result } = renderHook(() => useSearchQuery())
    expect(result.current).toBe('')

    act(() => setSearchQuery('moon'))
    expect(result.current).toBe('moon')

    act(() => clearSearch())
    expect(result.current).toBe('')
  })
})
