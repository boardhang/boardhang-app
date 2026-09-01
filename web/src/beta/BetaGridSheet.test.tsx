import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { BetaVideo } from './betaTypes'
import { BetaGridSheet } from './BetaGridSheet'

function vid(id: string): BetaVideo {
  return {
    id, source_catalog_id: 'p', provider: 'youtube', video_id: id,
    title: id, channel: `Chan ${id}`, duration_s: 30, is_short: true, views: 1, isMine: false,
  }
}

const videos = ['a', 'b', 'c', 'd', 'e', 'f'].map(vid)

describe('BetaGridSheet', () => {
  it('renders nothing while closed', () => {
    render(
      <BetaGridSheet open={false} onOpenChange={vi.fn()} videos={videos} pending={false} onOpen={vi.fn()} onAddBeta={vi.fn()} />,
    )
    expect(screen.queryByText('Beta videos')).toBeNull()
  })

  it('shows the title, count, and a card per clip (uncapped)', async () => {
    render(
      <BetaGridSheet open videos={videos} pending={false} onOpenChange={vi.fn()} onOpen={vi.fn()} onAddBeta={vi.fn()} />,
    )
    expect(await screen.findByText('Beta videos')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/Beta by/)).toHaveLength(6)
  })

  it('mirrors the pending placeholder ahead of the cards', async () => {
    render(
      <BetaGridSheet open videos={videos} pending onOpenChange={vi.fn()} onOpen={vi.fn()} onAddBeta={vi.fn()} />,
    )
    expect(await screen.findByText(/pending review/i)).toBeInTheDocument()
  })

  it('hands a tapped clip to onOpen (the player opens above; the sheet stays)', async () => {
    const onOpen = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <BetaGridSheet open videos={videos} pending={false} onOpenChange={onOpenChange} onOpen={onOpen} onAddBeta={vi.fn()} />,
    )
    fireEvent.click(await screen.findByLabelText('Beta by Chan c, 0:30'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('routes "Add a beta" back to the host gate', async () => {
    const onAddBeta = vi.fn()
    render(
      <BetaGridSheet open videos={videos} pending={false} onOpenChange={vi.fn()} onOpen={vi.fn()} onAddBeta={onAddBeta} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /add a beta/i }))
    expect(onAddBeta).toHaveBeenCalled()
  })
})
