import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Chainable supabase.storage mock: storage.from() → { upload, remove, getPublicUrl }.
const m = vi.hoisted(() => {
  const upload = vi.fn<(path: string, blob: unknown, opts?: unknown) => Promise<{ error: unknown }>>()
  const remove = vi.fn<(paths: string[]) => Promise<{ error: unknown }>>()
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/avatars/${path}` },
  }))
  const storageFrom = vi.fn(() => ({ upload, remove, getPublicUrl }))
  const client = { storage: { from: storageFrom } }
  return { client, upload, remove, getPublicUrl, storageFrom }
})

vi.mock('../supabase/client', () => ({ supabase: m.client, isConfigured: true }))

import {
  AVATARS_BUCKET,
  avatarPublicUrl,
  deleteAvatarObject,
  isAvatarPath,
  uploadAvatar,
} from './avatarStorage'

const UID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  m.upload.mockResolvedValue({ error: null })
  m.remove.mockResolvedValue({ error: null })
})

afterEach(() => vi.clearAllMocks())

describe('isAvatarPath', () => {
  it('accepts null (no avatar) and a valid {uid}/{uuid}.webp path', () => {
    expect(isAvatarPath(null)).toBe(true)
    expect(isAvatarPath(`${UID}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp`)).toBe(true)
  })

  it('rejects an external URL and a folderless name', () => {
    expect(isAvatarPath('https://evil.example/pixel.webp')).toBe(false)
    expect(isAvatarPath('not-a-path.webp')).toBe(false)
    expect(isAvatarPath(`${UID}/x.png`)).toBe(false)
  })
})

describe('avatarPublicUrl', () => {
  it('derives the public URL from a stored path', () => {
    const path = `${UID}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp`
    expect(avatarPublicUrl(path)).toBe(
      `https://proj.supabase.co/storage/v1/object/public/avatars/${path}`,
    )
    expect(m.storageFrom).toHaveBeenCalledWith(AVATARS_BUCKET)
  })

  it('returns null for a null path (renders initials)', () => {
    expect(avatarPublicUrl(null)).toBeNull()
    expect(m.getPublicUrl).not.toHaveBeenCalled()
  })
})

describe('uploadAvatar', () => {
  it('uploads to {uid}/{uuid}.webp with the blob content type and returns the path', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })
    const { path } = await uploadAvatar(UID, blob)
    expect(m.storageFrom).toHaveBeenCalledWith(AVATARS_BUCKET)
    const [uploadedPath, uploadedBlob, opts] = m.upload.mock.calls[0]
    expect(uploadedPath).toMatch(new RegExp(`^${UID}/[0-9a-f-]{36}\\.webp$`, 'i'))
    expect(uploadedPath).toBe(path)
    expect(uploadedBlob).toBe(blob)
    expect(opts).toMatchObject({ contentType: 'image/webp', upsert: false })
  })

  it('throws when the upload errors', async () => {
    m.upload.mockResolvedValue({ error: new Error('storage boom') })
    const blob = new Blob(['x'], { type: 'image/webp' })
    await expect(uploadAvatar(UID, blob)).rejects.toThrow('storage boom')
  })
})

describe('deleteAvatarObject', () => {
  it('best-effort removes the object', async () => {
    await deleteAvatarObject(`${UID}/x.webp`)
    expect(m.remove).toHaveBeenCalledWith([`${UID}/x.webp`])
  })

  it('swallows a remove error (orphan is harmless)', async () => {
    m.remove.mockRejectedValue(new Error('remove boom'))
    await expect(deleteAvatarObject(`${UID}/x.webp`)).resolves.toBeUndefined()
  })
})
