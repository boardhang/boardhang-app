import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useAuth } from './AuthProvider'
import { PrivacyChoice } from '../social/PrivacyChoice'
import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  isValidHandleFormat,
  normalizeHandle,
} from './handle'

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
  const [privacy, setPrivacy] = useState<'public' | 'private' | null>(null)
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
    if (validation !== 'available' || privacy === null || isSaving) return
    setSaveError(null)
    setIsSaving(true)
    try {
      await saveProfile(handle, displayName, undefined, privacy === 'private')
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
      className="flex flex-col gap-4 px-4 pb-6"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span>Handle</span>
        <div className="flex items-center gap-1 rounded-lg border border-input bg-transparent px-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <span aria-hidden="true" className="text-muted-foreground">
            @
          </span>
          <Input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            aria-describedby="handle-help"
            className="border-0 px-0 focus-visible:border-0 focus-visible:ring-0"
            autoFocus
          />
        </div>
        <HandleHelp validation={validation} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span>Display name</span>
        <Input
          type="text"
          autoComplete="name"
          placeholder="Your name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Who can follow you?</span>
        <PrivacyChoice value={privacy} onChange={setPrivacy} />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Not now
        </Button>
        <Button type="submit" disabled={validation !== 'available' || privacy === null || isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {saveError && (
        <p className="text-sm text-destructive" role="alert">
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
        <span id="handle-help" className="text-xs text-destructive">
          Use {HANDLE_MIN_LENGTH}–{HANDLE_MAX_LENGTH} lowercase letters, numbers, or
          underscores.
        </span>
      )
    case 'checking':
      return (
        <span id="handle-help" className="text-xs text-muted-foreground">
          Checking availability…
        </span>
      )
    case 'taken':
      return (
        <span id="handle-help" className="text-xs text-destructive">
          That handle is taken.
        </span>
      )
    case 'available':
      return (
        <span id="handle-help" className="text-xs text-green-600 dark:text-green-500">
          Available
        </span>
      )
    default:
      return (
        <span id="handle-help" className="text-xs text-muted-foreground">
          {HANDLE_MIN_LENGTH}–{HANDLE_MAX_LENGTH} characters: lowercase letters, numbers,
          underscore.
        </span>
      )
  }
}
