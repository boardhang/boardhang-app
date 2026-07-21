// One-time privacy notice for EXISTING users (U7/KTD9). New users choose during onboarding;
// users who created their profile before the follow feed shipped never saw that step, so they
// get this once — gated on `privacyChoiceAt === null` (stamped only on an explicit choice, so it
// shows exactly once). Non-dismissible forced choice: no close button, and a backdrop/escape
// close attempt is ignored (onOpenChange no-op) — a choice is the only exit, mirroring
// onboarding. Belt-and-suspenders with KTD9a: until the marker is stamped the user is already
// private-until-chosen server-side, so nothing is exposed in the gap.

import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PrivacyChoice, type Privacy } from './PrivacyChoice'

export function PrivacyChoiceNotice() {
  const { status, profile, setPrivacyChoice } = useAuth()
  const [choice, setChoice] = useState<Privacy | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Show only to a signed-in user with a profile who has not yet made the choice.
  const open = status === 'signedInWithProfile' && profile != null && profile.privacyChoiceAt === null
  if (!open) return null

  async function save() {
    if (choice === null || saving) return
    setSaving(true)
    setError(null)
    try {
      await setPrivacyChoice(choice === 'private')
      // On success, refreshProfile stamps privacyChoiceAt → `open` becomes false → unmounts.
    } catch {
      setError("Couldn't save your choice. Please try again.")
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Your climbing activity can now be followed</DialogTitle>
          <DialogDescription>
            Boardhang now has a following feed. Choose who can see your climbs — you can change
            this any time in settings.
          </DialogDescription>
        </DialogHeader>
        <PrivacyChoice value={choice} onChange={setChoice} />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button disabled={choice === null || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
