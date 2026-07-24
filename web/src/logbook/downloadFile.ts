// Trigger a client-side file download from an in-memory string. There's no reusable
// download helper in the app; the object-URL create/revoke pairing mirrors
// ../auth/avatarImage.ts (the closest precedent). Kept DOM-only and side-effecting so the
// serialization in ./logbookExport stays pure and unit-testable.

import { isIosLike } from '@/lib/pwa'

/** Save `content` as a file named `filename`.
 *
 *  iOS WKWebView browsers (Safari, and Bluefy — our Web Bluetooth target) ignore the
 *  `<a download>` attribute, so the anchor path below silently does nothing there. On those
 *  we hand the file to the native share sheet ("Save to Files", AirDrop, …) via the Web
 *  Share API, which is the supported way to export a file on iOS. Everywhere else we keep the
 *  direct anchor download, which is a better UX (no share sheet) and works reliably.
 *
 *  Async because the share sheet resolves when the user finishes with it; callers should await. */
export async function downloadFile(filename: string, content: string, mimeType: string): Promise<void> {
  const file = new File([content], filename, { type: mimeType })

  // Prefer the share sheet only on iOS, where the direct download is broken. Elsewhere a
  // truthy canShare (e.g. desktop Chrome on Windows) shouldn't hijack a working download.
  if (isIosLike() && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (err) {
      // The user cancelling the sheet is a completed, successful "export nothing" — don't
      // fall through to a second attempt they didn't ask for.
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Any other share failure falls through to the anchor download as a best effort.
    }
  }

  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke after the current task so the engine has the object URL for the whole click —
  // revoking synchronously can cancel an async download before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
