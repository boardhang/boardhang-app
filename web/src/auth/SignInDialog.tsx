// Centered sign-in modal — the single sign-in surface for the whole web app (top-nav
// "Sign in" and the log-ascent flow both open this). Wraps the shared SignInPanel and
// closes itself once a session lands. Pass `title` to tailor the copy per entry point.

import { useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from './AuthProvider'
import { SignInPanel } from './SignInPanel'

interface SignInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  /** Hide SignInPanel's intro blurb — useful when the dialog title already states the intent. */
  hideIntro?: boolean
}

export function SignInDialog({
  open,
  onOpenChange,
  title = 'Sign in',
  hideIntro = false,
}: SignInDialogProps) {
  const { status } = useAuth()

  // Once sign-in succeeds (status leaves signedOut), dismiss the modal.
  useEffect(() => {
    if (open && status !== 'signedOut') onOpenChange(false)
  }, [open, status, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <SignInPanel hideIntro={hideIntro} />
      </DialogContent>
    </Dialog>
  )
}
