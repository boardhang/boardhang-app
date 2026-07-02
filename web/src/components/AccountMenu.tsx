import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Modal } from './Modal'
import { ProfileSetup } from './ProfileSetup'
import { SignInPanel } from './SignInPanel'

/**
 * The account control in the app header. Three states, mirroring iOS:
 *   • signedOut           → "Sign in" opens the sign-in panel.
 *   • signedInNoProfile   → "Finish profile" opens profile setup.
 *   • signedInWithProfile → "@handle" opens a menu (sign out / delete account).
 *
 * The whole app stays usable without signing in; during restore we render nothing so
 * the header never flashes "Sign in".
 */
export function AccountMenu() {
  const { status, profile, isRestoring, signOut, deleteAccount } = useAuth()

  const [showSignIn, setShowSignIn] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Once a session lands, close the sign-in panel and hand off to profile setup for a
  // brand-new account. When a full profile resolves, ensure setup is closed.
  useEffect(() => {
    if (status === 'signedOut') return
    setShowSignIn(false)
    setShowProfile(status === 'signedInNoProfile')
  }, [status])

  // Close the signed-in dropdown on an outside click.
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  async function handleSignOut() {
    setMenuOpen(false)
    try {
      await signOut()
    } catch {
      // Signing out is best-effort; the auth listener reconciles state either way.
    }
  }

  async function handleDelete() {
    setMenuOpen(false)
    const confirmed = window.confirm(
      'Delete your account? This permanently removes your profile and cannot be undone.',
    )
    if (!confirmed) return
    try {
      await deleteAccount()
    } catch {
      window.alert("Couldn't delete your account. Please try again.")
    }
  }

  if (isRestoring) return <div className="account-control" aria-hidden="true" />

  return (
    <div className="account-control">
      {status === 'signedOut' && (
        <button type="button" onClick={() => setShowSignIn(true)}>
          Sign in
        </button>
      )}

      {status === 'signedInNoProfile' && (
        <button type="button" onClick={() => setShowProfile(true)}>
          Finish profile
        </button>
      )}

      {status === 'signedInWithProfile' && profile && (
        <div className="account-menu" ref={menuRef}>
          <button
            type="button"
            className="account-handle"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            @{profile.handle}
          </button>
          {menuOpen && (
            <div className="account-dropdown" role="menu">
              <button type="button" role="menuitem" onClick={() => void handleSignOut()}>
                Sign out
              </button>
              <button
                type="button"
                role="menuitem"
                className="account-danger"
                onClick={() => void handleDelete()}
              >
                Delete account
              </button>
            </div>
          )}
        </div>
      )}

      {showSignIn && (
        <Modal title="Sign in" onClose={() => setShowSignIn(false)}>
          <SignInPanel />
        </Modal>
      )}

      {showProfile && (
        <Modal title="Set up your profile" onClose={() => setShowProfile(false)}>
          <ProfileSetup onDone={() => setShowProfile(false)} />
        </Modal>
      )}
    </div>
  )
}
