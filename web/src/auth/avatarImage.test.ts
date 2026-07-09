import { afterEach, describe, expect, it, vi } from 'vitest'
import { AVATAR_SIZE, AvatarImageError, computeCropRect, processAvatarFile } from './avatarImage'

describe('computeCropRect', () => {
  it('centers a square crop on a landscape image', () => {
    // 1000×400 → 400px square, horizontally centered: sx = (1000-400)/2 = 300.
    expect(computeCropRect(1000, 400)).toEqual({ sx: 300, sy: 0, side: 400, target: AVATAR_SIZE })
  })

  it('centers a square crop on a portrait image', () => {
    // 400×1000 → 400px square, vertically centered: sy = (1000-400)/2 = 300.
    expect(computeCropRect(400, 1000)).toEqual({ sx: 0, sy: 300, side: 400, target: AVATAR_SIZE })
  })

  it('is a no-offset full crop on a square image', () => {
    expect(computeCropRect(512, 512)).toEqual({ sx: 0, sy: 0, side: 512, target: AVATAR_SIZE })
  })

  it('honors a custom target size', () => {
    expect(computeCropRect(200, 100, 64)).toEqual({ sx: 50, sy: 0, side: 100, target: 64 })
  })
})

describe('processAvatarFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects a non-image file without attempting to decode', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' })
    await expect(processAvatarFile(file)).rejects.toBeInstanceOf(AvatarImageError)
    expect(decode).not.toHaveBeenCalled()
  })

  it('wraps a decode failure (e.g. undecodable HEIC) in AvatarImageError', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('unsupported image type')),
    )
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.heic', { type: 'image/heic' })
    await expect(processAvatarFile(file)).rejects.toBeInstanceOf(AvatarImageError)
  })
})
