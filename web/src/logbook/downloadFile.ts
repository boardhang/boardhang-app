// Trigger a client-side file download from an in-memory string. There's no reusable
// download helper in the app; the object-URL create/revoke pairing mirrors
// ../auth/avatarImage.ts (the closest precedent). Kept DOM-only and side-effecting so the
// serialization in ./logbookExport stays pure and unit-testable.

/** Download `content` as a file named `filename`. Creates a Blob, hands the browser an
 *  object URL via a synthetic `<a download>` click, then revokes the URL to avoid a leak. */
export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
