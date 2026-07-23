import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AscentsState } from './ascents'

vi.mock('../auth/AuthProvider', () => ({ useAuth: vi.fn() }))
vi.mock('../auth/SignInDialog', () => ({
  SignInDialog: ({ open }: { open: boolean }) => (open ? <div>sign-in dialog</div> : null),
}))
vi.mock('./ascents', () => ({ useEnsureAscentsLoaded: vi.fn(), loadAscents: vi.fn() }))
vi.mock('../catalog/catalogSync', () => ({
  getCatalogProblemsByIds: vi.fn(async () => new Map()),
}))
vi.mock('./downloadFile', () => ({ downloadFile: vi.fn() }))

import { useAuth } from '../auth/AuthProvider'
import { getCatalogProblemsByIds } from '../catalog/catalogSync'
import { loadAscents, useEnsureAscentsLoaded } from './ascents'
import { downloadFile } from './downloadFile'
import { LogbookExportSection } from './LogbookExportSection'

const mockedAuth = vi.mocked(useAuth)
const mockedUse = vi.mocked(useEnsureAscentsLoaded)
const mockedDownload = vi.mocked(downloadFile)
const mockedGetCatalog = vi.mocked(getCatalogProblemsByIds)
const mockedLoad = vi.mocked(loadAscents)

function ascent(id: string, boardLayoutId: number, sourceCatalogId: string | null): AscentsState['ascents'][number] {
  return {
    id,
    date: '2026-07-20T10:00:00.000Z',
    sourceCatalogId,
    userProblemId: null,
    problemName: 'P',
    problemGrade: '6B',
    votedGrade: '6B',
    tries: 1,
    stars: 0,
    comment: '',
    sent: true,
    boardLayoutId,
  }
}

function loaded(ascents: AscentsState['ascents']): AscentsState {
  return { status: 'loaded', ascents, error: null }
}

beforeEach(() => {
  // Default: signed in with a settled session. Individual tests override for signed-out.
  mockedAuth.mockReturnValue({
    status: 'signedInWithProfile',
    isRestoring: false,
  } as ReturnType<typeof useAuth>)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('LogbookExportSection', () => {
  it('exports CSV for all ascents across boards, unfiltered', async () => {
    // Covers F1 / AE1.
    mockedUse.mockReturnValue(loaded([ascent('a1', 7, 'c1'), ascent('a2', 20, 'c2')]))
    render(<LogbookExportSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1))
    const [filename, content] = mockedDownload.mock.calls[0]
    expect(filename).toMatch(/\.csv$/)
    expect(content).toContain('7')
    expect(content).toContain('20') // both boards present
  })

  it('exports JSON', async () => {
    mockedUse.mockReturnValue(loaded([ascent('a1', 7, 'c1')]))
    render(<LogbookExportSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1))
    const [filename, content] = mockedDownload.mock.calls[0]
    expect(filename).toMatch(/\.json$/)
    expect(JSON.parse(content).ascents).toHaveLength(1)
  })

  it('exports without error for an empty logbook', async () => {
    // Covers AE4.
    mockedUse.mockReturnValue(loaded([]))
    render(<LogbookExportSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1))
    const [, content] = mockedDownload.mock.calls[0]
    expect(content.trimEnd().split('\n')).toHaveLength(1) // header only
  })

  it('still exports (unenriched) and recovers when catalog enrichment rejects', async () => {
    mockedGetCatalog.mockRejectedValueOnce(new Error('idb unavailable'))
    mockedUse.mockReturnValue(loaded([ascent('a1', 7, 'c1')]))
    render(<LogbookExportSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1))
    // No unhandled rejection; the button returns to its enabled, non-busy state.
    expect(screen.getByRole('button', { name: 'Export CSV' })).not.toBeDisabled()
  })

  it('shows an error with a retry when the logbook fails to load', () => {
    mockedUse.mockReturnValue({ status: 'error', ascents: [], error: 'network down' })
    render(<LogbookExportSection />)

    expect(screen.getByRole('alert')).toHaveTextContent('network down')
    // Export actions are replaced by the error/retry affordance.
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mockedLoad).toHaveBeenCalledTimes(1)
  })

  it('prompts to sign in (no export buttons) when signed out, and the CTA opens the sign-in flow', () => {
    mockedAuth.mockReturnValue({
      status: 'signedOut',
      isRestoring: false,
    } as ReturnType<typeof useAuth>)
    mockedUse.mockReturnValue({ status: 'idle', ascents: [], error: null })
    render(<LogbookExportSection />)

    expect(screen.getByText(/sign in to export your logbook/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export JSON' })).toBeNull()

    // The dialog is closed until the CTA is clicked.
    expect(screen.queryByText('sign-in dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByText('sign-in dialog')).toBeInTheDocument()
  })

  it('disables the export actions while ascents are loading', () => {
    mockedUse.mockReturnValue({ status: 'loading', ascents: [], error: null })
    render(<LogbookExportSection />)

    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeDisabled()
  })
})
