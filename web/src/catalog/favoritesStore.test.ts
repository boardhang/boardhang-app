import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getFavoriteIds,
  isFavorite,
  pruneFavorites,
  toggleFavorite,
  useFavorites,
} from './favoritesStore'

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // refresh the module snapshot
})

describe('favoritesStore', () => {
  it('toggles membership and persists', () => {
    expect(isFavorite('a')).toBe(false)
    toggleFavorite('a')
    expect(isFavorite('a')).toBe(true)
    expect(getFavoriteIds().has('a')).toBe(true)
    toggleFavorite('a')
    expect(isFavorite('a')).toBe(false)
  })

  it('re-renders subscribers via useFavorites', () => {
    const { result } = renderHook(() => useFavorites())
    expect(result.current.favoriteIds.size).toBe(0)
    act(() => result.current.toggleFavorite('x'))
    expect(result.current.favoriteIds.has('x')).toBe(true)
  })

  it('prunes dangling ids and re-renders subscribers', () => {
    const { result } = renderHook(() => useFavorites())
    act(() => {
      result.current.toggleFavorite('user:gone')
      result.current.toggleFavorite('keep')
    })
    act(() => pruneFavorites(['user:gone', 'never-was-a-favorite']))
    expect(result.current.favoriteIds.has('user:gone')).toBe(false)
    expect(result.current.favoriteIds.has('keep')).toBe(true)
  })

  it('picks up a favorite written by another tab via the storage event', () => {
    const { result } = renderHook(() => useFavorites())
    // Simulate another tab writing directly, then the browser firing 'storage'.
    localStorage.setItem('catalogFavorites', JSON.stringify(['fromOtherTab']))
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'catalogFavorites' })))
    expect(result.current.favoriteIds.has('fromOtherTab')).toBe(true)
  })
})
