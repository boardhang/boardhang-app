// Centered sign-in modal, shown when a signed-out user tries to log an ascent. Reuses
// the exact same SignInPanel as the top-nav Sign in. Closes itself once a session lands.

import { useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from './AuthProvider'
import { SignInPanel } from './SignInPanel'

interface SignInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
}

export function SignInDialog({
  open,
  onOpenChange,
  title = 'Sign in',
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
        <SignInPanel />
      </DialogContent>
    </Dialog>
  )
}
