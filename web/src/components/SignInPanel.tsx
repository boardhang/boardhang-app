import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'

const CODE_LENGTH = 6

function emailLooksValid(email: string): boolean {
  const trimmed = email.trim()
  return trimmed.includes('@') && trimmed.includes('.')
}

/**
 * Two-phase email sign-in (send a 6-digit code → verify it) plus Google OAuth. Mirrors
 * iOS `SignInView`. Email uses a typed one-time code rather than a tappable magic link
 * so there's no redirect dependency. Google navigates away and returns to the app,
 * where supabase-js auto-completes the session.
 *
 * The parent closes this panel once a session lands (it watches `auth.status`).
 */
export function SignInPanel() {
  const { isConfigured, sendEmailCode, verifyEmailCode, signInWithGoogle } = useAuth()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const codeLooksValid = code.trim().length >= CODE_LENGTH

  async function handleSendCode() {
    if (isWorking) return
    setErrorMessage(null)
    setIsWorking(true)
    try {
      await sendEmailCode(email)
      setCodeSent(true)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setIsWorking(false)
    }
  }

  async function handleVerifyCode() {
    if (isWorking) return
    setErrorMessage(null)
    setIsWorking(true)
    try {
      await verifyEmailCode(email, code)
      // Success advances auth.status; the parent closes this panel.
    } catch {
      setErrorMessage(
        "That code didn't work. Check it and try again, or request a new one.",
      )
    } finally {
      setIsWorking(false)
    }
  }

  async function handleGoogle() {
    if (isWorking) return
    setErrorMessage(null)
    setIsWorking(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setIsWorking(false)
    }
    // On success the browser navigates to Google; no need to reset `isWorking`.
  }

  return (
    <div className="auth-panel">
      <p className="auth-intro">
        Sign in to sync your profile across devices and unlock social features. You can
        keep using the app without an account.
      </p>

      {!isConfigured ? (
        <p className="auth-note" role="status">
          Sign-in isn't set up in this build. See docs/pwa-login-SETUP.md.
        </p>
      ) : codeSent ? (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault()
            void handleVerifyCode()
          }}
        >
          <p className="auth-intro">
            We emailed a {CODE_LENGTH}-digit code to {email}. Enter it below.
          </p>
          <label className="auth-field">
            <span>Code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
              }
              autoFocus
              aria-label={`${CODE_LENGTH}-digit sign-in code`}
            />
          </label>
          <button type="submit" disabled={!codeLooksValid || isWorking}>
            {isWorking ? 'Verifying…' : 'Verify & sign in'}
          </button>
          <button
            type="button"
            className="auth-link"
            onClick={() => {
              setCodeSent(false)
              setCode('')
              setErrorMessage(null)
            }}
          >
            Use a different email
          </button>
        </form>
      ) : (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSendCode()
          }}
        >
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
            />
          </label>
          <button type="submit" disabled={!emailLooksValid(email) || isWorking}>
            {isWorking ? 'Sending…' : 'Email me a code'}
          </button>
        </form>
      )}

      <div className="auth-divider" aria-hidden="true">
        <span>or</span>
      </div>

      <button
        type="button"
        className="auth-google"
        onClick={() => void handleGoogle()}
        disabled={isWorking || !isConfigured}
      >
        Continue with Google
      </button>

      {errorMessage && (
        <p className="auth-error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
