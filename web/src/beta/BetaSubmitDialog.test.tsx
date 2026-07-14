import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const submitBeta = vi.fn()
vi.mock('./betaStore', () => ({ submitBeta: (...a: unknown[]) => submitBeta(...a) }))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}))

import { BetaSubmitDrawer } from './BetaSubmitDrawer'

const ID = 'dQw4w9WgXcQ'

function renderDrawer(overrides: Partial<Parameters<typeof BetaSubmitDrawer>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onSubmitted = vi.fn()
  render(
    <BetaSubmitDrawer
      open
      onOpenChange={onOpenChange}
      sourceCatalogId="prob-A"
      onSubmitted={onSubmitted}
      {...overrides}
    />,
  )
  return { onOpenChange, onSubmitted }
}

async function typeUrl(value: string) {
  const input = await screen.findByLabelText('YouTube video link')
  fireEvent.change(input, { target: { value } })
  return input
}

beforeEach(() => {
  vi.clearAllMocks()
  submitBeta.mockResolvedValue(undefined)
})

describe('BetaSubmitDrawer', () => {
  it('rejects an invalid URL inline and never calls the store', async () => {
    renderDrawer()
    await typeUrl('not a youtube link')
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/youtube video link/i)
    expect(submitBeta).not.toHaveBeenCalled()
  })

  it('submits a valid URL: store called, drawer closed, note recorded, success toast', async () => {
    const { onOpenChange, onSubmitted } = renderDrawer()
    await typeUrl(`https://youtu.be/${ID}`)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(submitBeta).toHaveBeenCalledWith('prob-A', ID))
    expect(onSubmitted).toHaveBeenCalledWith(ID)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('surfaces a store failure as an error toast and keeps the drawer open', async () => {
    submitBeta.mockRejectedValue(new Error('already added'))
    const { onOpenChange, onSubmitted } = renderDrawer()
    await typeUrl(`https://youtu.be/${ID}`)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('guards against a same-tick double submit', async () => {
    renderDrawer()
    await typeUrl(`https://youtu.be/${ID}`)
    const btn = screen.getByRole('button', { name: /submit/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(submitBeta).toHaveBeenCalled())
    expect(submitBeta).toHaveBeenCalledTimes(1)
  })
})
