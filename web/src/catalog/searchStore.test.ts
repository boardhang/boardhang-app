import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { closeSearch, openSearch, setSearchQuery, useSearch } from './searchStore'

beforeEach(() => closeSearch())

describe('searchStore', () => {
  it('opens, tracks the query, and clears on close', () => {
    const { result } = renderHook(() => useSearch())
    expect(result.current).toEqual({ open: false, query: '' })

    act(() => openSearch())
    expect(result.current).toEqual({ open: true, query: '' })

    act(() => setSearchQuery('moon'))
    expect(result.current).toEqual({ open: true, query: 'moon' })

    act(() => closeSearch())
    expect(result.current).toEqual({ open: false, query: '' })
  })
})
