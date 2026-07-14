// The "Add a beta" submission modal (U5). A signed-in user pastes a YouTube link; we extract the
// video id client-side (youtubeUrl) and hand it to submitBeta, which inserts a PENDING row. The
// clip is invisible until an owner approves it, so on success we don't show a card — we fire a
// toast and let the caller record a local "pending review" note. A centered Dialog, matching
// SignInDialog / BetaPlayerSheet. Sign-in gating and the pending note live in the caller
// (BetaVideos), same split as ProblemDetail/useAddToList.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { submitBeta } from './betaStore'
import { extractYouTubeId } from './youtubeUrl'

interface BetaSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceCatalogId: string
  /** Called with the extracted video id after a successful submit, so the caller can record the
   *  local "pending review" note. */
  onSubmitted: (videoId: string) => void
}

export function BetaSubmitDialog({
  open,
  onOpenChange,
  sourceCatalogId,
  onSubmitted,
}: BetaSubmitDialogProps) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Synchronous re-entrancy lock — the same-tick double-submit guard (fast double-Enter). The
  // `submitting` state flips a render later.
  const submittingRef = useRef(false)

  // Reset the field + error each time the modal opens, so a prior attempt never lingers.
  useEffect(() => {
    if (open) {
      setUrl('')
      setError(null)
    }
  }, [open])

  async function send(videoId: string) {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      await submitBeta(sourceCatalogId, videoId)
      onSubmitted(videoId)
      onOpenChange(false)
      toast.success("Submitted — it'll appear here once it's reviewed.")
    } catch (e) {
      toast.error("Couldn't add that beta.", {
        description: e instanceof Error ? e.message : undefined,
        action: { label: 'Retry', onClick: () => void send(videoId) },
      })
    } finally {
      submittingRef.current = false
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const videoId = extractYouTubeId(url)
    if (!videoId) {
      setError('Enter a YouTube video link (e.g. youtu.be/…).')
      return
    }
    void send(videoId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a beta video</DialogTitle>
          <DialogDescription>
            Paste a YouTube link. New betas are reviewed before they appear.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              if (error) setError(null) // clear the error as the user edits
            }}
            placeholder="https://youtu.be/…"
            aria-label="YouTube video link"
            inputMode="url"
            autoFocus
          />
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={url.trim().length === 0} className="self-end">
            Submit
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
