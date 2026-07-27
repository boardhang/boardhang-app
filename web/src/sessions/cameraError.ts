// Why a camera failure needs more than one flat message: a *denied* camera is the one join failure
// the app can never recover from on its own. Once the camera is switched off for the browser (iOS
// Settings › Bluefy › Camera, Safari's per-site setting, a Chrome site block), getUserMedia rejects
// immediately and no in-page prompt can re-ask — the fix lives in OS/browser settings, so the UI has
// to say *where*. Every other failure (no camera, camera busy, offline decoder) is either transient
// or terminal-but-nothing-to-do, and just points at the paste field.
//
// @yudiel/react-qr-scanner already normalises getUserMedia's DOMExceptions into an
// `IScannerError.kind`, which is what the Scanner hands us. We also read a raw DOMException `name`
// so a direct getUserMedia rejection — or a scanner version that stops normalising — classifies the
// same way, and anything unrecognised falls back to the generic 'unavailable'.

/** What went wrong with the camera, at the granularity the UI actually reacts to. */
export type CameraIssue = 'denied' | 'no-camera' | 'in-use' | 'insecure' | 'unavailable'

/** `IScannerError.kind` values from @yudiel/react-qr-scanner. */
const KIND_TO_ISSUE: Record<string, CameraIssue> = {
  'permission-denied': 'denied',
  'no-camera': 'no-camera',
  overconstrained: 'no-camera',
  unsupported: 'no-camera',
  'in-use': 'in-use',
  'insecure-context': 'insecure',
  security: 'insecure',
}

/** Raw DOMException names, including the legacy WebKit/Chromium spellings still seen on iOS. */
const NAME_TO_ISSUE: Record<string, CameraIssue> = {
  NotAllowedError: 'denied',
  PermissionDeniedError: 'denied',
  NotFoundError: 'no-camera',
  DevicesNotFoundError: 'no-camera',
  OverconstrainedError: 'no-camera',
  ConstraintNotSatisfiedError: 'no-camera',
  NotReadableError: 'in-use',
  TrackStartError: 'in-use',
  SecurityError: 'insecure',
}

export function classifyCameraError(error: unknown): CameraIssue {
  if (typeof error === 'object' && error !== null) {
    const { kind, name } = error as { kind?: unknown; name?: unknown }
    if (typeof kind === 'string' && KIND_TO_ISSUE[kind]) return KIND_TO_ISSUE[kind]
    if (typeof name === 'string' && NAME_TO_ISSUE[name]) return NAME_TO_ISSUE[name]
  }
  return 'unavailable'
}

export type CameraIssueCopy = {
  title: string
  detail: string
  /** Ordered recovery steps — only present when the user can actually fix it in settings. */
  steps?: string[]
}

export type CameraContext = {
  /** Defaults to the live user agent; injectable so the copy is testable. */
  userAgent?: string
  /** Installed-to-home-screen web app — it gets its own iOS Settings entry, under our name. */
  standalone?: boolean
}

function isIOS(userAgent: string): boolean {
  // iPadOS reports a Macintosh UA in desktop mode; touch points give it away.
  return (
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) &&
      typeof navigator !== 'undefined' &&
      navigator.maxTouchPoints > 1)
  )
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  )
}

/** User-facing copy for a camera failure — the denied case names the exact place to go. */
export function describeCameraIssue(issue: CameraIssue, ctx: CameraContext = {}): CameraIssueCopy {
  switch (issue) {
    case 'denied': {
      const userAgent = ctx.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
      const standalone = ctx.standalone ?? detectStandalone()
      if (isIOS(userAgent)) {
        return {
          title: 'Camera access is turned off',
          detail: 'iOS blocks the camera per app, so we can’t ask again from here.',
          steps: [
            'Open the iOS Settings app',
            standalone
              ? 'Find Boardhang in the app list'
              : 'Find the browser you’re using (Bluefy, Safari, Chrome…)',
            'Turn Camera on',
            'Come back and tap “Scan a QR code” again',
          ],
        }
      }
      return {
        title: 'Camera access is blocked',
        detail: 'Your browser is blocking the camera for this site.',
        steps: [
          'Open this site’s settings — the icon next to the address bar',
          'Allow Camera',
          'Reload, then tap “Scan a QR code” again',
        ],
      }
    }
    case 'no-camera':
      return {
        title: 'No camera found',
        detail: 'This device has no camera we can use — paste the link instead.',
      }
    case 'in-use':
      return {
        title: 'The camera is busy',
        detail: 'Another app or tab is using it. Close that, then try scanning again.',
      }
    case 'insecure':
      return {
        title: 'Camera needs a secure connection',
        detail: 'Open Boardhang over https to scan — or paste the link instead.',
      }
    case 'unavailable':
      return {
        title: 'Couldn’t start the camera',
        detail: 'Check your connection and try again — or paste the link instead.',
      }
  }
}
