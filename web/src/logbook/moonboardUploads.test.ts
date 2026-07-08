import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A chainable mock of the supabase client. `from()` → { insert→select→single, select→order,
// delete→eq }; `storage.from()` → { upload, remove }; `auth.getSession()`.
const m = vi.hoisted(() => {
  const single = vi.fn()
  const order = vi.fn()
  const eq = vi.fn()
  const insert = vi.fn(() => ({ select: () => ({ single }) }))
  const select = vi.fn(() => ({ order }))
  const del = vi.fn(() => ({ eq }))
  const update = vi.fn(() => ({ eq: () => ({ select: () => ({ single }) }) }))
  const from = vi.fn(() => ({ insert, select, delete: del, update }))
  const upload = vi.fn()
  const remove = vi.fn()
  const storageFrom = vi.fn(() => ({ upload, remove }))
  const getSession = vi.fn()
  const client = { from, storage: { from: storageFrom }, auth: { getSession } }
  return { client, single, order, eq, insert, select, del, update, from, upload, remove, storageFrom, getSession }
})

vi.mock('../supabase/client', () => ({ supabase: m.client, isConfigured: true }))

import {
  validateFile,
  uploadImport,
  listMyImports,
  removeImport,
  MAX_BYTES,
  BUCKET,
} from './moonboardUploads'

function fakeFile(name: string, size = 10, type = 'text/csv'): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

beforeEach(() => {
  m.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-A' } } } })
  m.upload.mockResolvedValue({ error: null })
  m.remove.mockResolvedValue({ error: null })
  m.single.mockResolvedValue({ data: { id: 'row-1' }, error: null })
  m.order.mockResolvedValue({ data: [], error: null })
  m.eq.mockResolvedValue({ error: null })
})

afterEach(() => vi.clearAllMocks())

describe('validateFile', () => {
  it('accepts each allowed extension, case-insensitively', () => {
    for (const ext of ['csv', 'json', 'zip', 'txt', 'xlsx', 'CSV', 'Json']) {
      expect(validateFile(fakeFile(`export.${ext}`)).ok).toBe(true)
    }
  })

  it('rejects a disallowed extension and an extensionless file', () => {
    expect(validateFile(fakeFile('clip.mp4')).ok).toBe(false)
    expect(validateFile(fakeFile('noext')).ok).toBe(false)
  })

  it('rejects a file over 25 MB and accepts one just under', () => {
    expect(validateFile(fakeFile('big.csv', MAX_BYTES + 1)).ok).toBe(false)
    expect(validateFile(fakeFile('ok.csv', MAX_BYTES - 1)).ok).toBe(true)
  })
})

describe('uploadImport', () => {
  it('inserts a pending row, uploads to the user folder, then marks it uploaded', async () => {
    const row = await uploadImport(fakeFile('moon.csv', 123, 'text/csv'))
    expect(m.storageFrom).toHaveBeenCalledWith(BUCKET)
    const [path] = m.upload.mock.calls[0]
    expect(path).toMatch(/^user-A\//)
    expect(m.from).toHaveBeenCalledWith('logbook_imports')
    const insertArg = m.insert.mock.calls[0][0]
    expect(insertArg).toMatchObject({
      user_id: 'user-A',
      original_filename: 'moon.csv',
      content_type: 'text/csv',
      size: 123,
      status: 'pending',
    })
    expect(insertArg.storage_path).toBe(path)
    // Bytes stored → the row is flipped to 'uploaded'.
    expect(m.update).toHaveBeenCalledWith({ status: 'uploaded' })
    expect(row).toMatchObject({ id: 'row-1' })
  })

  it('rejects an invalid file before touching storage', async () => {
    await expect(uploadImport(fakeFile('clip.mp4'))).rejects.toThrow(/Unsupported file type/)
    expect(m.upload).not.toHaveBeenCalled()
  })

  it('throws when signed out and does not upload', async () => {
    m.getSession.mockResolvedValue({ data: { session: null } })
    await expect(uploadImport(fakeFile('moon.csv'))).rejects.toThrow(/signed in/i)
    expect(m.upload).not.toHaveBeenCalled()
  })

  it('rolls back BOTH the object and the row when the upload fails', async () => {
    m.upload.mockResolvedValue({ error: new Error('storage boom') })
    await expect(uploadImport(fakeFile('moon.csv'))).rejects.toThrow('storage boom')
    const [path] = m.upload.mock.calls[0]
    // Remove the object too — it may have landed server-side despite the error response
    // (else it's an invisible orphan that eats the cap) — and delete the row.
    expect(m.remove).toHaveBeenCalledWith([path])
    expect(m.insert).toHaveBeenCalled()
    expect(m.eq).toHaveBeenCalledWith('id', 'row-1')
  })

  it('does not upload when the envelope insert fails (no orphan object possible)', async () => {
    m.single.mockResolvedValue({ data: null, error: new Error('insert boom') })
    await expect(uploadImport(fakeFile('moon.csv'))).rejects.toThrow('insert boom')
    expect(m.upload).not.toHaveBeenCalled()
  })
})

describe('listMyImports', () => {
  it('orders newest-first', async () => {
    m.order.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null })
    const rows = await listMyImports()
    expect(m.select).toHaveBeenCalledWith('*')
    expect(m.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(rows).toHaveLength(2)
  })
})

describe('removeImport', () => {
  it('removes the storage object then deletes the row', async () => {
    await removeImport({ id: 'row-1', storage_path: 'user-A/x.csv' })
    expect(m.remove).toHaveBeenCalledWith(['user-A/x.csv'])
    expect(m.del).toHaveBeenCalled()
    expect(m.eq).toHaveBeenCalledWith('id', 'row-1')
  })

  it('does not delete the row if the storage remove fails', async () => {
    m.remove.mockResolvedValue({ error: new Error('remove boom') })
    await expect(removeImport({ id: 'row-1', storage_path: 'user-A/x.csv' })).rejects.toThrow(
      'remove boom',
    )
    expect(m.del).not.toHaveBeenCalled()
  })
})
