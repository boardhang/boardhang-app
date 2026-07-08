import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithRouter } from '../test/renderWithRouter'

// Capture `window.location.href =` assignments (the mailto handoff) without jsdom trying
// to navigate. Restored after each test.
let hrefAssignments: string[]
let originalLocation: Location

beforeEach(() => {
  hrefAssignments = []
  originalLocation = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new Proxy(
      {},
      {
        set(_t, prop, value) {
          if (prop === 'href') hrefAssignments.push(String(value))
          return true
        },
        get() {
          return ''
        },
      },
    ),
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  vi.restoreAllMocks()
})

async function typeEmail(value: string) {
  fireEvent.change(await screen.findByLabelText(/account email/i), { target: { value } })
}

describe('ImportFromMoonBoardScreen', () => {
  it('explains the flow and shows the recipient address', async () => {
    renderWithRouter('/logbook/import')
    expect(await screen.findByRole('heading', { name: /import from moonboard/i })).toBeInTheDocument()
    expect(screen.getByText(/moonboardsupport@moonclimbing\.com/)).toBeInTheDocument()
  })

  it('disables the actions until a valid-looking email is entered', async () => {
    renderWithRouter('/logbook/import')

    const open = await screen.findByRole('button', { name: /open email request/i })
    const copy = screen.getByRole('button', { name: /copy email text/i })
    expect(open).toBeDisabled()
    expect(copy).toBeDisabled()

    await typeEmail('climber@example.com')
    expect(open).toBeEnabled()
    expect(copy).toBeEnabled()
  })

  it('opens a prefilled mailto draft containing the typed email', async () => {
    renderWithRouter('/logbook/import')

    await typeEmail('climber@example.com')
    fireEvent.click(screen.getByRole('button', { name: /open email request/i }))

    expect(hrefAssignments).toHaveLength(1)
    const href = hrefAssignments[0]
    expect(href.startsWith('mailto:moonboardsupport@moonclimbing.com?')).toBe(true)
    expect(decodeURIComponent(href)).toContain('climber@example.com')
  })

  it('copies the full email text and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    renderWithRouter('/logbook/import')

    await typeEmail('climber@example.com')
    fireEvent.click(screen.getByRole('button', { name: /copy email text/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toContain('To: moonboardsupport@moonclimbing.com')
    expect(copied).toContain('Subject:')
    expect(copied).toContain('Article 20')
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument()
  })

  it('produces a valid draft with no username entered', async () => {
    renderWithRouter('/logbook/import')

    await typeEmail('climber@example.com')
    fireEvent.click(screen.getByRole('button', { name: /open email request/i }))

    const body = new URL(hrefAssignments[0]).searchParams.get('body') ?? ''
    expect(body).not.toContain('username:')
    expect(body).not.toContain('undefined')
  })
})
