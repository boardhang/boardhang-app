import { useEffect, useState } from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '../components/ui/drawer'
import { Button } from '../components/ui/button'
import { useAuth } from './AuthProvider'
import { ProfileSetup } from './ProfileSetup'
import { SignInDialog } from './SignInDialog'

/**
 * The account control in the app header. Three states, mirroring iOS:
 *   • signedOut           → "Sign in" opens the sign-in modal.
 *   • signedInNoProfile   → "Finish profile" opens profile setup.
 *   • signedInWithProfile → "@handle" opens a menu (sign out / delete account).
 *
 * The whole app stays usable without signing in; during restore we render a placeholder
 * so the header never flashes "Sign in".
 */
export function AccountMenu() {
  const { status, profile, isRestoring, signOut, deleteAccount } = useAuth()

  const [showSignIn, setShowSignIn] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [menuError, setMenuError] = useState<string | null>(null)

  // Once a session lands, close the sign-in modal and hand off to profile setup for a
  // brand-new account. When a full profile resolves, ensure setup is closed.
  useEffect(() => {
    if (status === 'signedOut') return
    setShowSignIn(false)
    setShowProfile(status === 'signedInNoProfile')
  }, [status])

  function closeMenu() {
    setShowMenu(false)
    setConfirmingDelete(false)
    setMenuError(null)
  }

  async function handleSignOut() {
    try {
      await signOut()
    } catch {
      // Signing out is best-effort; the auth listener reconciles state either way.
    }
    closeMenu()
  }

  async function handleDelete() {
    setMenuError(null)
    try {
      await deleteAccount()
      closeMenu()
    } catch {
      setMenuError("Couldn't delete your account. Please try again.")
    }
  }

  // Reserve the same footprint during restore so the header doesn't jump.
  if (isRestoring) return <div className="h-7" aria-hidden="true" />

  return (
    <>
      {status === 'signedOut' && (
        <Button variant="outline" size="sm" onClick={() => setShowSignIn(true)}>
          Sign in
        </Button>
      )}

      {status === 'signedInNoProfile' && (
        <Button variant="outline" size="sm" onClick={() => setShowProfile(true)}>
          Finish profile
        </Button>
      )}

      {status === 'signedInWithProfile' && profile && (
        <Button
          variant="ghost"
          size="sm"
          aria-haspopup="menu"
          onClick={() => setShowMenu(true)}
        >
          @{profile.handle}
        </Button>
      )}

      {/* Sign-in modal — kept consistent with the log-ascent sign-in surface */}
      <SignInDialog open={showSignIn} onOpenChange={setShowSignIn} />

      {/* Profile setup drawer */}
      <Drawer open={showProfile} onOpenChange={setShowProfile} showSwipeHandle>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Set up your profile</DrawerTitle>
          </DrawerHeader>
          <ProfileSetup onDone={() => setShowProfile(false)} />
        </DrawerContent>
      </Drawer>

      {/* Signed-in account menu drawer */}
      <Drawer
        open={showMenu}
        onOpenChange={(open) => (open ? setShowMenu(true) : closeMenu())}
        showSwipeHandle
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{profile ? `@${profile.handle}` : 'Account'}</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-2 px-4 pb-6" role="menu">
            <Button
              variant="outline"
              className="w-full justify-start"
              role="menuitem"
              onClick={() => void handleSignOut()}
            >
              Sign out
            </Button>

            {confirmingDelete ? (
              <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 p-3">
                <p className="text-sm text-muted-foreground">
                  Delete your account? This permanently removes your profile and cannot
                  be undone.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDelete()}
                  >
                    Delete account
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="destructive"
                className="w-full justify-start"
                role="menuitem"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete account
              </Button>
            )}

            {menuError && (
              <p className="text-sm text-destructive" role="alert">
                {menuError}
              </p>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
