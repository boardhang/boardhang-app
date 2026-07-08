// Import from MoonBoard — the honest, GDPR-based way to get your own logbook out of the
// official app. There is no API import: the MoonBoard app is locked behind Firebase App
// Check / Play Integrity + cert pinning + PairIP, so nothing but the genuine app can call
// its backend. Instead we help the user file a UK GDPR Article 15/20 request to Moon
// Climbing (they must supply the logbook in CSV/JSON). This screen explains that and
// generates a prefilled email; parsing the returned file into `ascents` is a later step.

import { useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildGdprEmail, renderGdprEmailText, RECIPIENT } from './moonboardImport'

const routeApi = getRouteApi('/logbook/import')

// Loose "looks like an email" gate for enabling the primary action — not validation, just
// enough to avoid opening a mail draft with obvious garbage. Real validation is Moon's.
function looksLikeEmail(value: string): boolean {
  const v = value.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

export function ImportFromMoonBoardScreen() {
  const navigate = routeApi.useNavigate()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [copied, setCopied] = useState(false)

  const canGenerate = looksLikeEmail(email)

  function openEmailRequest() {
    if (!canGenerate) return
    const built = buildGdprEmail({ email, username: username || undefined })
    // Hand off to the user's mail client with the draft prefilled.
    window.location.href = built.mailtoHref
  }

  async function copyEmailText() {
    const built = buildGdprEmail({ email, username: username || undefined })
    const text = renderGdprEmailText(built)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard needs a secure context / permission; if it's unavailable the recipient
      // and text are still on screen for manual sending, so fail quietly.
    }
  }

  return (
    <div className="flex flex-1 flex-col px-3">
      <div className="mb-3 px-1 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-1 h-7 px-2 text-muted-foreground"
          onClick={() => void navigate({ to: '/logbook' })}
        >
          <ChevronLeft className="size-4" />
          Logbook
        </Button>
        <h1 className="text-lg font-bold tracking-tight">Import from MoonBoard</h1>
      </div>

      {/* Why there's no one-click import, and what to do instead. */}
      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Why you can’t just connect your account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The official MoonBoard app locks its data behind checks that only its own app can
          pass, so there’s no way to import your logbook automatically. But it’s your data —
          under UK data-protection law, Moon Climbing must send it to you on request.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Fill in your MoonBoard login below and we’ll draft the request email for you. Moon
          has up to one month to reply, and must provide your logbook as a CSV or JSON file.
        </p>
      </section>

      {/* The request form. */}
      <section className="mt-4 rounded-lg border border-border p-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="mb-email" className="text-sm font-medium">
              MoonBoard account email
            </label>
            <Input
              id="mb-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="mb-username" className="text-sm font-medium">
              MoonBoard username <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="mb-username"
              autoComplete="username"
              placeholder="Your MoonBoard username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Button onClick={openEmailRequest} disabled={!canGenerate}>
            Open email request
          </Button>
          <Button variant="outline" onClick={() => void copyEmailText()} disabled={!canGenerate}>
            {copied ? 'Copied' : 'Copy email text'}
          </Button>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          The request goes to{' '}
          <span className="font-medium text-foreground">{RECIPIENT}</span>. If your mail app
          doesn’t open, copy the text and send it yourself.
        </p>
      </section>

      <p className="mt-4 px-1 text-xs text-muted-foreground">
        Once Moon sends your file back, importing it into your logbook here is coming next.
      </p>
    </div>
  )
}
