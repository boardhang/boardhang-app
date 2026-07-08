import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// Auth is mockable per test; SignInPanel is stubbed (it has its own auth wiring).
const auth = vi.hoisted(() => ({ status: 'signedInWithProfile' as string, isRestoring: false }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }))
vi.mock('../auth/SignInPanel', () => ({
  SignInPanel: () => <div data-testid="signin-panel">sign in</div>,
}))

// Keep the real validateFile (pure); mock the async storage ops.
vi.mock('./moonboardUploads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./moonboardUploads')>()
  return { ...actual, uploadImport: vi.fn(), listMyImports: vi.fn(), removeImport: vi.fn() }
})

import * as uploads from './moonboardUploads'
import { UploadPanel } from './UploadPanel'

const uploadImport = vi.mocked(uploads.uploadImport)
const listMyImports = vi.mocked(uploads.listMyImports)
const removeImport = vi.mocked(uploads.removeImport)

function fakeFile(name: string, size = 10, type = 'text/csv'): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function pick(file: File) {
  const input = screen.getByLabelText(/choose your moonboard export/i)
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  auth.status = 'signedInWithProfile'
  auth.isRestoring = false
  listMyImports.mockResolvedValue([])
  uploadImport.mockResolvedValue({ id: 'row-1' } as never)
  removeImport.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('UploadPanel — auth gate', () => {
  it('shows the sign-in panel when signed out', () => {
    auth.status = 'signedOut'
    render(<UploadPanel />)
    expect(screen.getByTestId('signin-panel')).toBeInTheDocument()
    expect(screen.queryByLabelText(/choose your moonboard export/i)).toBeNull()
  })
})

describe('UploadPanel — uploader', () => {
  it('gates upload on a valid file AND consent', async () => {
    render(<UploadPanel />)
    await waitFor(() => expect(listMyImports).toHaveBeenCalled())

    const uploadBtn = screen.getByRole('button', { name: /upload file/i })
    expect(uploadBtn).toBeDisabled()

    pick(fakeFile('moon.csv'))
    expect(uploadBtn).toBeDisabled() // file chosen but no consent yet

    fireEvent.click(screen.getByRole('checkbox'))
    expect(uploadBtn).toBeEnabled()
  })

  it('rejects an invalid file with an error and no upload', async () => {
    render(<UploadPanel />)
    await waitFor(() => expect(listMyImports).toHaveBeenCalled())

    pick(fakeFile('clip.mp4'))
    expect(screen.getByRole('alert')).toHaveTextContent(/unsupported file type/i)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /upload file/i })).toBeDisabled()
    expect(uploadImport).not.toHaveBeenCalled()
  })

  it('uploads on a valid file + consent, then refreshes the list', async () => {
    render(<UploadPanel />)
    await waitFor(() => expect(listMyImports).toHaveBeenCalledTimes(1))

    pick(fakeFile('moon.csv', 100))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /upload file/i }))

    await waitFor(() => expect(uploadImport).toHaveBeenCalledTimes(1))
    expect(uploadImport.mock.calls[0][0].name).toBe('moon.csv')
    // Refreshes the list after upload (initial load + post-upload reload).
    await waitFor(() => expect(listMyImports).toHaveBeenCalledTimes(2))
  })

  it('shows an error when the upload fails', async () => {
    uploadImport.mockRejectedValue(new Error('storage boom'))
    render(<UploadPanel />)
    await waitFor(() => expect(listMyImports).toHaveBeenCalled())

    pick(fakeFile('moon.csv'))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /upload file/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('storage boom')
  })
})

describe('UploadPanel — manage-own list', () => {
  it('lists uploads and removes one', async () => {
    listMyImports.mockResolvedValue([
      { id: 'a', original_filename: 'first.csv', created_at: '2026-07-01T00:00:00Z' },
      { id: 'b', original_filename: 'second.json', created_at: '2026-07-02T00:00:00Z' },
    ] as never)
    render(<UploadPanel />)

    expect(await screen.findByText('first.csv')).toBeInTheDocument()
    expect(screen.getByText('second.json')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /remove first\.csv/i }))
    await waitFor(() => expect(removeImport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
    ))
    await waitFor(() => expect(screen.queryByText('first.csv')).toBeNull())
  })

  it('shows an empty state when there are no uploads', async () => {
    render(<UploadPanel />)
    expect(await screen.findByText(/no files uploaded yet/i)).toBeInTheDocument()
  })
})
