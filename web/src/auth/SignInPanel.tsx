import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useAuth } from './AuthProvider'

const CODE_LENGTH = 6

function emailLooksValid(email: string): boolean {
  const trimmed = email.trim()
  return trimmed.includes('@') && trimmed.includes('.')
}

/**
 * Two-phase email sign-in: send a 6-digit code, then verify it. Mirrors iOS `SignInView`.
 * Email uses a typed one-time code rather than a tappable magic link so there's no
 * redirect dependency. (Google OAuth is deferred; the provider method exists but no
 * button surfaces it until the web origin is allow-listed in Supabase.)
 *
 * The parent closes the drawer once a session lands (it watches `auth.status`).
 */
export function SignInPanel({ hideIntro = false }: { hideIntro?: boolean } = {}) {
  const { isConfigured, sendEmailCode, verifyEmailCode } = useAuth()

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
      // Success advances auth.status; the parent closes this drawer.
    } catch {
      setErrorMessage(
        "That code didn't work. Check it and try again, or request a new one.",
      )
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      {!hideIntro && (
        <p className="text-sm text-muted-foreground text-balance">
          Sign in to sync your profile across devices and unlock social features. You can
          keep using the app without an account.
        </p>
      )}

      {!isConfigured ? (
        <p className="text-sm text-muted-foreground" role="status">
          Sign-in isn't set up in this build.
        </p>
      ) : codeSent ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void handleVerifyCode()
          }}
        >
          <p className="text-sm text-muted-foreground">
            We emailed a {CODE_LENGTH}-digit code to <strong>{email}</strong>. Enter it
            below.
          </p>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span>Code</span>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
              }
              className="text-center text-lg tracking-[0.4em]"
              autoFocus
              aria-label={`${CODE_LENGTH}-digit sign-in code`}
            />
          </label>
          <Button type="submit" disabled={!codeLooksValid || isWorking}>
            {isWorking ? 'Verifying…' : 'Verify & sign in'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setCodeSent(false)
              setCode('')
              setErrorMessage(null)
            }}
          >
            Use a different email
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSendCode()
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span>Email</span>
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
            />
          </label>
          <Button type="submit" disabled={!emailLooksValid(email) || isWorking}>
            {isWorking ? 'Sending…' : 'Email me a code'}
          </Button>
        </form>
      )}

      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
