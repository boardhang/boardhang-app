// Share surface for a collaboration session: a scannable QR of the join link plus a
// copy/share button. Owned by the sessions module and consumed by both the catalog
// SessionBar (U7) and the global SessionPill panel (U6). The invite token is fetched on
// demand via the session_invite_token RPC (getInviteToken, KTD-7) — never from the cache —
// so this component owns a small loading/error state around that fetch.

import { useCallback, useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { Check, Copy, RotateCw } from 'lucide-react'
import { getInviteToken } from './sessionsStore'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

function buildJoinUrl(token: string): string {
  return `${window.location.origin}/session/join/${token}`
}

/** QR of the join URL. On any generation failure, falls back to the copyable text link so
 *  the Share sheet is never a dead end (U7). Rendered on a white card so it scans in both
 *  themes. */
function QrImage({ url }: { url: string }) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, 'M')
      qr.addData(url)
      qr.make()
      return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
    } catch {
      return null
    }
  }, [url])

  if (!svg) {
    return (
      <p className="rounded-md border border-border bg-muted p-3 text-center text-xs break-all text-muted-foreground">
        {url}
      </p>
    )
  }
  return (
    <div
      role="img"
      aria-label="Session join QR code"
      className="mx-auto size-48 rounded-md bg-white p-2 [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export function ShareSession() {
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [copied, setCopied] = useState(false)

  const loadToken = useCallback(async () => {
    setStatus('loading')
    try {
      setToken(await getInviteToken())
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadToken()
  }, [loadToken])

  const url = token ? buildJoinUrl(token) : ''
  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator

  const share = useCallback(async () => {
    if (!url) return
    // Prefer the native share sheet; fall back to clipboard with a visible confirmation,
    // since a silent copy reads as failure.
    if (canNativeShare && navigator.share) {
      try {
        await navigator.share({ title: 'Join my session', url })
        return
      } catch {
        // user cancelled or share failed — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard blocked — the link text is visible below for manual copy
    }
  }, [url, canNativeShare])

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="size-48 rounded-md" />
        <Skeleton className="h-9 w-40" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">Couldn’t load the share link.</p>
        <Button variant="outline" size="sm" onClick={() => void loadToken()}>
          <RotateCw className="size-4" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <QrImage url={url} />
      <p className="max-w-full truncate text-xs text-muted-foreground">{url}</p>
      <Button onClick={() => void share()} className="w-full max-w-xs">
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? 'Copied' : canNativeShare ? 'Share link' : 'Copy link'}
      </Button>
    </div>
  )
}
