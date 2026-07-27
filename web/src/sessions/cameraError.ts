// Why a camera failure needs more than one flat message: a *denied* camera is the one join failure
// the app can never recover from on its own. Once the camera is switched off for the browser (iOS
// Settings › Bluefy › Camera, Safari's per-site block, a Chrome site block), getUserMedia rejects
// immediately and no in-page prompt can re-ask — the fix lives in OS/browser settings, so the UI has
// to say *where*. The same is true for a browser with no getUserMedia at all (an in-app webview —
// how a joiner often arrives, straight from a messaging app): recoverable, but only by leaving.
// Everything else is either transient or terminal-with-nothing-to-do, and points at the paste field.
//
// @yudiel/react-qr-scanner already normalises getUserMedia's DOMExceptions into an
// `IScannerError.kind`, which is what the Scanner hands us. We also read a raw DOMException `name`
// so a direct getUserMedia rejection — or a scanner version that stops normalising — classifies the
// same way, and anything unrecognised falls back to the generic 'unavailable'.

import type { ScannerErrorKind } from '@yudiel/react-qr-scanner'
import { isIosLike, isStandalone } from '@/lib/pwa'

/** What went wrong with the camera, at the granularity the UI actually reacts to. */
export type CameraIssue =
  | 'denied'
  | 'no-camera'
  | 'unsupported'
  | 'in-use'
  | 'insecure'
  | 'unavailable'

/** Typed against the library's own union so an upstream rename fails the build instead of silently
 *  falling through to 'unavailable'. Kinds left unmapped ('aborted', 'type-error', 'unknown') are
 *  deliberately generic — they carry no fact worth telling the user. */
const KIND_TO_ISSUE: Partial<Record<ScannerErrorKind, CameraIssue>> = {
  'permission-denied': 'denied',
  'no-camera': 'no-camera',
  // Not a missing camera: the library raises this only when navigator.mediaDevices.getUserMedia is
  // undefined — i.e. the *browser* can't, which has its own fix.
  unsupported: 'unsupported',
  // The camera exists, our constraints just didn't match it. Unreachable today (facingMode is an
  // ideal, not `exact`), but 'no camera found' would be a lie if that ever changes.
  overconstrained: 'unavailable',
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
  OverconstrainedError: 'unavailable',
  ConstraintNotSatisfiedError: 'unavailable',
  NotReadableError: 'in-use',
  TrackStartError: 'in-use',
  SecurityError: 'insecure',
}

/** `hasOwn`, not a truthy read: a key that collides with an `Object.prototype` member ('constructor',
 *  'toString') would otherwise resolve to an inherited value and escape the `CameraIssue` union. */
function lookup(map: Record<string, CameraIssue | undefined>, key: string) {
  return Object.hasOwn(map, key) ? map[key] : undefined
}

export function classifyCameraError(error: unknown): CameraIssue {
  if (typeof error === 'object' && error !== null) {
    const { kind, name } = error as { kind?: unknown; name?: unknown }
    if (typeof kind === 'string') {
      const byKind = lookup(KIND_TO_ISSUE, kind)
      if (byKind) return byKind
    }
    if (typeof name === 'string') {
      const byName = lookup(NAME_TO_ISSUE, name)
      if (byName) return byName
    }
  }
  return 'unavailable'
}

export type CameraIssueCopy = {
  title: string
  detail: string
  /** Ordered recovery steps — only present when the user can actually fix it themselves. */
  steps?: string[]
}

export type CameraContext = {
  /** Defaults to the live platform; injectable so the copy is testable. */
  isIOS?: boolean
  /** Installed-to-home-screen web app — it gets its own OS settings entry, under our name. */
  standalone?: boolean
}

const GENERIC: CameraIssueCopy = {
  title: 'Couldn’t start the camera',
  detail: 'Check your connection and try again — or paste the link instead.',
}

/** User-facing copy for a camera failure — the fixable cases name the exact place to go. */
export function describeCameraIssue(issue: CameraIssue, ctx: CameraContext = {}): CameraIssueCopy {
  const isIOS = ctx.isIOS ?? isIosLike()
  const standalone = ctx.standalone ?? isStandalone()

  switch (issue) {
    case 'denied': {
      const findTheApp = standalone
        ? 'Find Boardhang in the app list'
        : 'Find the browser you’re using (Bluefy, Safari, Chrome…)'
      if (isIOS) {
        return {
          title: 'Camera access is turned off',
          detail: 'iOS blocks the camera per app, so we can’t ask again from here.',
          steps: [
            'Open the iOS Settings app',
            findTheApp,
            'Turn Camera on',
            'Come back and tap “Scan a QR code” again',
          ],
        }
      }
      // An installed PWA has no address bar to open site settings from, so send it to the OS.
      if (standalone) {
        return {
          title: 'Camera access is blocked',
          detail: 'Boardhang isn’t allowed to use the camera.',
          steps: [
            'Open your device’s app settings for Boardhang',
            'Allow Camera',
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
    case 'unsupported':
      return {
        title: 'This browser can’t use the camera',
        detail: 'In-app browsers usually block it.',
        steps: [
          isIOS ? 'Open Boardhang in Safari or Bluefy' : 'Open Boardhang in Chrome or Safari',
          'Tap “Scan a QR code” again',
        ],
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
      return GENERIC
  }
}
