// Session launcher (U3). A centered dialog to join a friend's session — by scanning their QR or
// pasting their link — or to start your own. It opens on a **chooser** (not the camera): the camera
// only starts when the user taps "Scan a QR code", so opening the dialog never prompts for camera
// permission unless they actually want to scan. A decoded/pasted session QR navigates to the
// existing /session/join/$token route — the launcher owns only camera states (KTD-4); sign-in,
// consent, and the join RPC stay in JoinSession.
//
// The heavy decoder (@yudiel/react-qr-scanner + ~433 kB WASM) loads only when scanning starts, via
// a manual dynamic import that awaits both the chunk and the retryable ensureDecoder() WASM prep in
// one place and can retry per attempt. React.lazy is a poor fit: it memoizes a rejected import, so
// its retry edge can't recover an offline first scan (KTD-5). Any load failure drops back to the
// chooser, where the paste field is always available (R6).
//
// A camera failure keeps the *reason* (see cameraError.ts) rather than collapsing to one flat
// message: a denied camera can only be fixed in OS/browser settings, so it gets a persistent panel
// with the steps, not a hint that fades after 2.5s.

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CameraOff, ChevronLeft, Loader2, Plus, ScanQrCode } from 'lucide-react'
import type { IScannerProps } from '@yudiel/react-qr-scanner'
import { parseJoinUrl } from './joinUrl'
import { classifyCameraError, describeCameraIssue, type CameraIssue } from './cameraError'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ScannerComponent = ComponentType<IScannerProps>
type Phase = 'menu' | 'scanning'

/** Loads the scanner chunk + WASM on mount (and on each `attempt`), then renders the camera. A
 *  chunk, WASM or camera failure calls `onError` with the underlying error so the parent can drop
 *  back to the chooser and explain it; bumping `attempt` re-runs the load, which recovers because
 *  ensureDecoder retries a previously-failed WASM fetch.
 *
 *  Every error is stamped with the `attempt` it belongs to, because neither failure source is
 *  synchronous and both can outlive the attempt that started them: camera acquisition takes seconds
 *  (a permission prompt is unbounded), and the scanner library keeps our callback in a ref it never
 *  clears on unmount, so an abandoned attempt still reports. The parent drops anything stale. */
function ScannerStage({
  attempt,
  paused,
  onDecode,
  onError,
}: {
  attempt: number
  paused: boolean
  onDecode: (raw: string) => void
  onError: (error: unknown, forAttempt: number) => void
}) {
  const [Scanner, setScanner] = useState<ScannerComponent | null>(null)

  useEffect(() => {
    let cancelled = false
    setScanner(null)
    void (async () => {
      try {
        const mod = await import('./qrDecoder')
        await mod.ensureDecoder()
        if (!cancelled) setScanner(() => mod.default)
      } catch (err) {
        if (!cancelled) onError(err, attempt)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attempt, onError])

  if (!Scanner) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg [&_video]:aspect-square [&_video]:w-full [&_video]:object-cover">
      <Scanner
        onScan={(codes) => {
          // Prefer the first code that is actually a session link — a stray non-session QR in
          // frame shouldn't shadow the one the user is aiming at.
          const raw = (codes.find((c) => parseJoinUrl(c.rawValue)) ?? codes[0])?.rawValue
          if (raw) onDecode(raw)
        }}
        onError={(err) => onError(err, attempt)}
        paused={paused}
        constraints={{ facingMode: 'environment' }}
        formats={['qr_code']}
        components={{ finder: true }}
      />
    </div>
  )
}

/** Why the camera didn't start, plus the steps to fix it when there are any. Sits at the top of the
 *  chooser and stays put until the next scan attempt — settings live outside the app, so the user
 *  has to be able to leave, change the toggle, and come back to a message that's still there. */
function CameraIssuePanel({ issue }: { issue: CameraIssue }) {
  const { title, detail, steps } = describeCameraIssue(issue)
  return (
    <Alert variant="destructive">
      <CameraOff className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span className="block">{detail}</span>
        {steps && (
          <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-foreground">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Session launcher dialog. Opens on the chooser (scan / paste / optional start); the camera starts
 * only on "Scan a QR code". Pass `onStart` (+ `starting`/`canStart`) to surface the host action.
 */
export function ScanToJoin({
  open,
  onOpenChange,
  onStart,
  starting = false,
  canStart = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, renders the "Start your own session" host action in the chooser. */
  onStart?: () => void
  starting?: boolean
  /** Whether the host action is enabled (signed in). Ignored when `onStart` is absent. */
  canStart?: boolean
}) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('menu')
  const [attempt, setAttempt] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [cameraIssue, setCameraIssue] = useState<CameraIssue | null>(null)
  const [pasteValue, setPasteValue] = useState('')
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // `attempt` doubles as the scan epoch, so a late error can be told apart from the attempt the
  // user is actually on. Mirrored into a ref because the stale error arrives in a callback, not a
  // render. Every exit from scanning bumps it — see leaveScanning.
  const attemptRef = useRef(attempt)
  useEffect(() => {
    attemptRef.current = attempt
  }, [attempt])

  const showHint = useCallback((msg: string) => {
    setHint(msg)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(null), 2500)
  }, [])

  const goToJoin = useCallback(
    (token: string) => {
      onOpenChange(false)
      void navigate({ to: '/session/join/$token', params: { token } })
    },
    [navigate, onOpenChange],
  )

  // Leaving the camera — Back, a failure, or the dialog closing. Bumping the epoch is what makes a
  // late error from the attempt we're abandoning identifiable as stale; clearing `paused` keeps the
  // hidden-while-backgrounded latch from outliving the phase whose listener is the only thing that
  // would have released it (otherwise the next attempt mounts a camera that never streams).
  const leaveScanning = useCallback(() => {
    setPhase('menu')
    setPaused(false)
    setAttempt((a) => a + 1)
  }, [])

  // Reset when the dialog closes, so the next open always starts on the chooser.
  useEffect(() => {
    if (!open) {
      leaveScanning()
      setHint(null)
      setCameraIssue(null)
      setPasteValue('')
    }
  }, [open, leaveScanning])

  useEffect(() => () => void (hintTimer.current && clearTimeout(hintTimer.current)), [])

  // iOS standalone PWAs freeze the stream on backgrounding; pause while hidden and re-acquire a
  // fresh stream (not just unpause) on return. Only while actively scanning.
  useEffect(() => {
    if (!open || phase !== 'scanning') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setPaused(true)
      } else {
        setPaused(false)
        setAttempt((a) => a + 1)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [open, phase])

  const startScanning = useCallback(() => {
    setHint(null)
    setCameraIssue(null)
    setPaused(false)
    setAttempt((a) => a + 1)
    setPhase('scanning')
  }, [])

  const onDecode = useCallback(
    (raw: string) => {
      const token = parseJoinUrl(raw)
      if (token) goToJoin(token)
      else showHint('Not a session code')
    },
    [goToJoin, showHint],
  )

  // Camera couldn't start (denied / no camera / busy / offline decoder) — drop back to the chooser,
  // where the paste field is always available, and explain *this* failure. The panel is persistent
  // rather than a fading hint: a denied camera needs the user to leave for settings and come back.
  //
  // Errors from an abandoned attempt are dropped. They arrive seconds late (an unanswered
  // permission prompt, a start that times out) and the scanner library reports them even after the
  // instance is gone, so without the epoch check a cancelled scan could paint a persistent panel
  // over a working one — or, firing after the dialog closed, greet the next open with a stale one.
  const onScannerError = useCallback((error: unknown, forAttempt: number) => {
    if (forAttempt !== attemptRef.current) return
    leaveScanning()
    setHint(null)
    setCameraIssue(classifyCameraError(error))
  }, [leaveScanning])

  const submitPaste = useCallback(() => {
    const token = parseJoinUrl(pasteValue)
    if (token) goToJoin(token)
    else showHint('Not a session code')
  }, [pasteValue, goToJoin, showHint])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The denied panel (title + detail + four steps) is the tallest thing this dialog renders;
          cap it and scroll rather than clipping the paste field it points the user at. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto">
        <DialogHeader className="text-left">
          <DialogTitle>Session with friends</DialogTitle>
          <DialogDescription>
            {phase === 'scanning'
              ? 'Point at your friend’s session QR code.'
              : 'Scan or paste a friend’s session link to join — or start your own.'}
          </DialogDescription>
        </DialogHeader>

        {phase === 'scanning' ? (
          <div className="flex flex-col gap-3">
            {open ? (
              <ScannerStage
                attempt={attempt}
                paused={paused}
                onDecode={onDecode}
                onError={onScannerError}
              />
            ) : (
              <div className="aspect-square w-full rounded-lg bg-muted" />
            )}
            <p aria-live="polite" className="text-center text-sm text-muted-foreground">
              {hint ?? 'Scanning…'}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                setHint(null)
                leaveScanning()
              }}
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {cameraIssue && <CameraIssuePanel issue={cameraIssue} />}

            <Button className="w-full" onClick={startScanning}>
              <ScanQrCode className="size-4" />
              Scan a QR code
            </Button>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">or paste the link</span>
              <div className="flex gap-2">
                <Input
                  value={pasteValue}
                  onChange={(e) => {
                    setPasteValue(e.target.value)
                    if (hint) setHint(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitPaste()
                  }}
                  placeholder="Paste session link"
                  aria-label="Session link"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Button variant="outline" disabled={!pasteValue.trim()} onClick={submitPaste}>
                  Join
                </Button>
              </div>
            </div>

            {hint && <p className="text-center text-sm text-destructive">{hint}</p>}

            {onStart && (
              <>
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!canStart || starting}
                  title={canStart ? undefined : 'Sign in to start a session'}
                  onClick={onStart}
                >
                  {starting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {starting ? 'Creating session…' : 'Start your own session'}
                </Button>
                {!canStart && (
                  <p className="text-center text-xs text-muted-foreground">
                    Sign in to start — joining a friend’s doesn’t need an account.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Reusable trigger for a camera/paste join (no host action) — used by the boards overview, which
 *  has no board context to start a session in. Owns the dialog's open state. Spreads through
 *  `Button`'s props so callers can style it. */
export function ScanToJoinButton({
  variant = 'outline',
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant={variant} {...props} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ScanToJoin open={open} onOpenChange={setOpen} />
    </>
  )
}
