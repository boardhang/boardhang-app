import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  ensureDecoder: vi.fn(() => Promise.resolve<unknown>(undefined)),
  onScanRef: { current: null as null | ((codes: { rawValue: string }[]) => void) },
  onErrorRef: { current: null as null | (() => void) },
  onOpenChange: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, useNavigate: () => h.navigate }
})

// The lazy decoder chunk is mocked so tests never touch getUserMedia or the WASM. The fake Scanner
// captures its onScan/onError props so tests can drive a decode or a camera failure.
vi.mock('./qrDecoder', () => ({
  default: (props: { onScan: (c: { rawValue: string }[]) => void; onError: () => void }) => {
    h.onScanRef.current = props.onScan
    h.onErrorRef.current = props.onError
    return <div data-testid="fake-scanner" />
  },
  ensureDecoder: () => h.ensureDecoder(),
}))

// Lightweight dialog stand-in. It keeps content mounted regardless of `open` — mirroring base-ui,
// which holds the popup through its close animation. That's deliberate: the component must not
// flash the fallback branch while closing, and a mock that unmounted on close would hide it.
vi.mock('@/components/ui/dialog', () => {
  type Kids = { children?: React.ReactNode }
  return {
    Dialog: ({ children }: Kids) => <div>{children}</div>,
    DialogContent: ({ children }: Kids) => <div>{children}</div>,
    DialogHeader: ({ children }: Kids) => <div>{children}</div>,
    DialogTitle: ({ children }: Kids) => <h2>{children}</h2>,
    DialogDescription: ({ children }: Kids) => <p>{children}</p>,
  }
})

import { ScanToJoin } from './ScanToJoin'

function Harness({
  initialOpen = true,
  onStart,
  starting,
  canStart,
}: {
  initialOpen?: boolean
  onStart?: () => void
  starting?: boolean
  canStart?: boolean
}) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <ScanToJoin
      open={open}
      onOpenChange={(o) => {
        h.onOpenChange(o)
        setOpen(o)
      }}
      onStart={onStart}
      starting={starting}
      canStart={canStart}
    />
  )
}

const JOIN_URL = 'https://boardhang.app/session/join/tok-xyz'

beforeEach(() => {
  h.navigate.mockClear()
  h.ensureDecoder.mockReset().mockResolvedValue(undefined)
  h.onOpenChange.mockClear()
  h.onScanRef.current = null
  h.onErrorRef.current = null
})
afterEach(() => vi.restoreAllMocks())

/** Open on the chooser, then tap "Scan a QR code" to start the camera. */
async function enterScanning() {
  fireEvent.click(screen.getByRole('button', { name: /scan a qr code/i }))
  await screen.findByTestId('fake-scanner')
}

describe('ScanToJoin', () => {
  it('opens on the chooser (paste + scan), not the camera', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: /scan a qr code/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Session link')).toBeInTheDocument()
    // camera has NOT started until the user asks for it
    expect(screen.queryByTestId('fake-scanner')).not.toBeInTheDocument()
  })

  it('navigates and closes on a valid scanned QR', async () => {
    render(<Harness />)
    await enterScanning()

    act(() => h.onScanRef.current?.([{ rawValue: JOIN_URL }]))

    expect(h.navigate).toHaveBeenCalledWith({
      to: '/session/join/$token',
      params: { token: 'tok-xyz' },
    })
    expect(h.onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId('fake-scanner')).not.toBeInTheDocument()
  })

  it('keeps scanning and shows a transient hint for a non-session QR', async () => {
    render(<Harness />)
    await enterScanning()

    act(() => h.onScanRef.current?.([{ rawValue: 'WIFI:S:Gym;T:WPA;P:secret;;' }]))

    expect(screen.getByText('Not a session code')).toBeInTheDocument()
    expect(h.navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('fake-scanner')).toBeInTheDocument()
  })

  it('navigates when a valid link is pasted in the chooser', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Session link'), { target: { value: `  ${JOIN_URL} ` } })
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))

    expect(h.navigate).toHaveBeenCalledWith({
      to: '/session/join/$token',
      params: { token: 'tok-xyz' },
    })
  })

  it('shows an inline hint for an invalid pasted value, without navigating', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Session link'), { target: { value: 'not-a-link' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))

    expect(screen.getByText('Not a session code')).toBeInTheDocument()
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('drops back to the chooser when the decoder fails to load (offline)', async () => {
    h.ensureDecoder.mockRejectedValue(new Error('offline'))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /scan a qr code/i }))

    expect(await screen.findByText(/camera unavailable/i)).toBeInTheDocument()
    // the paste field is still right there
    expect(screen.getByLabelText('Session link')).toBeInTheDocument()
    expect(screen.queryByTestId('fake-scanner')).not.toBeInTheDocument()
  })

  it('drops back to the chooser when the camera reports an error mid-scan', async () => {
    render(<Harness />)
    await enterScanning()

    act(() => h.onErrorRef.current?.())

    expect(await screen.findByLabelText('Session link')).toBeInTheDocument()
    expect(screen.getByText(/camera unavailable/i)).toBeInTheDocument()
  })

  it('recovers the scanner on a second scan attempt after a first failed load', async () => {
    h.ensureDecoder.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    render(<Harness />)

    // first scan attempt fails → back on the chooser
    fireEvent.click(screen.getByRole('button', { name: /scan a qr code/i }))
    await screen.findByText(/camera unavailable/i)

    // second attempt succeeds (proves a per-attempt loader, not a memoized rejection)
    fireEvent.click(screen.getByRole('button', { name: /scan a qr code/i }))
    await waitFor(() => expect(screen.getByTestId('fake-scanner')).toBeInTheDocument())
  })

  it('is join-only (no host action) when onStart is absent', () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /start your own session/i })).not.toBeInTheDocument()
  })

  it('surfaces the host action when onStart is provided, and invokes it', () => {
    const onStart = vi.fn()
    render(<Harness onStart={onStart} canStart />)
    fireEvent.click(screen.getByRole('button', { name: /start your own session/i }))
    expect(onStart).toHaveBeenCalled()
  })

  it('disables the host action when the user cannot start (signed out)', () => {
    render(<Harness onStart={vi.fn()} canStart={false} />)
    expect(screen.getByRole('button', { name: /start your own session/i })).toBeDisabled()
  })
})
