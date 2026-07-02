import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  isValidHandleFormat,
  normalizeHandle,
} from '../auth/handle'

// Live state of the handle field, driving the helper text + Save enablement.
type HandleValidation = 'empty' | 'invalidFormat' | 'checking' | 'taken' | 'available'

const CHECK_DEBOUNCE_MS = 400

/**
 * First-run panel shown once a user is signed in but has no profile. Collects a unique
 * `@handle` (validated live, debounced) and a display name, then upserts the profiles
 * row — the only place a row is created. Mirrors iOS `ProfileSetupView`. Completion is
 * gated on a valid, available handle; the app stays usable locally in the meantime.
 */
export function ProfileSetup({ onDone }: { onDone: () => void }) {
  const { isHandleAvailable, saveProfile } = useAuth()

  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [validation, setValidation] = useState<HandleValidation>('empty')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Latest normalized handle, so a debounced availability result can be discarded if
  // the field changed under it.
  const latestHandleRef = useRef('')

  useEffect(() => {
    const normalized = normalizeHandle(handle)
    latestHandleRef.current = normalized

    if (!normalized) {
      setValidation('empty')
      return
    }
    if (!isValidHandleFormat(normalized)) {
      setValidation('invalidFormat')
      return
    }

    setValidation('checking')
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const available = await isHandleAvailable(normalized)
        // Ignore a stale result if the field changed under us.
        if (cancelled || latestHandleRef.current !== normalized) return
        setValidation(available ? 'available' : 'taken')
      } catch {
        // Treat a lookup failure as unknown: keep it non-savable but don't hard-error;
        // the save-time upsert re-checks uniqueness anyway.
        if (!cancelled && latestHandleRef.current === normalized) {
          setValidation('invalidFormat')
        }
      }
    }, CHECK_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [handle, isHandleAvailable])

  async function handleSave() {
    if (validation !== 'available' || isSaving) return
    setSaveError(null)
    setIsSaving(true)
    try {
      await saveProfile(handle, displayName)
      onDone()
    } catch {
      // Most likely a lost uniqueness race (unique-violation) — surface it and let
      // them pick another handle.
      setSaveError(
        "Couldn't save your profile. That handle may have just been taken — try another.",
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form
      className="auth-panel auth-form"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      <label className="auth-field">
        <span>Handle</span>
        <div className="handle-input">
          <span aria-hidden="true">@</span>
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            aria-describedby="handle-help"
            autoFocus
          />
        </div>
        <HandleHelp validation={validation} />
      </label>

      <label className="auth-field">
        <span>Display name</span>
        <input
          type="text"
          autoComplete="name"
          placeholder="Your name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>

      <div className="auth-actions">
        <button type="button" className="auth-link" onClick={onDone}>
          Not now
        </button>
        <button type="submit" disabled={validation !== 'available' || isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {saveError && (
        <p className="auth-error" role="alert">
          {saveError}
        </p>
      )}
    </form>
  )
}

function HandleHelp({ validation }: { validation: HandleValidation }) {
  switch (validation) {
    case 'invalidFormat':
      return (
        <span id="handle-help" className="auth-hint auth-hint-error">
          Use {HANDLE_MIN_LENGTH}–{HANDLE_MAX_LENGTH} lowercase letters, numbers, or
          underscores.
        </span>
      )
    case 'checking':
      return (
        <span id="handle-help" className="auth-hint">
          Checking availability…
        </span>
      )
    case 'taken':
      return (
        <span id="handle-help" className="auth-hint auth-hint-error">
          That handle is taken.
        </span>
      )
    case 'available':
      return (
        <span id="handle-help" className="auth-hint auth-hint-ok">
          Available
        </span>
      )
    default:
      return (
        <span id="handle-help" className="auth-hint">
          {HANDLE_MIN_LENGTH}–{HANDLE_MAX_LENGTH} characters: lowercase letters, numbers,
          underscore.
        </span>
      )
  }
}
