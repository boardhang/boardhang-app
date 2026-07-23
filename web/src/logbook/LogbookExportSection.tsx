// Settings section: download the signed-in user's whole logbook (all boards) as CSV or
// JSON. Reads the shared ascents store (already all-boards — no per-board filtering here,
// unlike LogbookScreen) and enriches best-effort from the local catalog cache at click
// time. Serialization is ./logbookExport (pure); the download side effect is ./downloadFile.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '../auth/AuthProvider'
import { SignInDialog } from '../auth/SignInDialog'
import { getCatalogProblemsByIds, type CatalogProblem } from '../catalog/catalogSync'
import { loadAscents, useEnsureAscentsLoaded } from './ascents'
import { downloadFile } from './downloadFile'
import { exportFilename, toCsv, toJson, type ExportFormat } from './logbookExport'

export function LogbookExportSection() {
  const { status: authStatus, isRestoring } = useAuth()
  const { status, ascents, error } = useEnsureAscentsLoaded()
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [showSignIn, setShowSignIn] = useState(false)
  // Signed out there's nothing to export (the store resets to empty), so prompt sign-in
  // rather than showing permanently-disabled buttons. Wait out session restore first.
  const signedOut = !isRestoring && authStatus === 'signedOut'
  // Gate until the store settles so we never export against a not-yet-loaded set. An
  // empty loaded logbook is fine — it exports a header-only CSV / empty envelope.
  const ready = status === 'loaded'

  async function handleExport(format: ExportFormat) {
    setBusy(format)
    try {
      const ids = ascents.map((a) => a.sourceCatalogId).filter((x): x is string => x !== null)
      const catalogById: Map<string, CatalogProblem> = ids.length
        ? await getCatalogProblemsByIds(ids).catch((err) => {
            console.warn('logbook export: catalog enrichment failed', err)
            return new Map<string, CatalogProblem>()
          })
        : new Map()
      const now = new Date()
      if (format === 'csv') {
        downloadFile(exportFilename('csv', now), toCsv(ascents, catalogById), 'text/csv;charset=utf-8')
      } else {
        const json = JSON.stringify(toJson(ascents, catalogById, now.toISOString()), null, 2)
        downloadFile(exportFilename('json', now), json, 'application/json')
      }
    } catch (err) {
      // Keep a download failure (Blob/createObjectURL unsupported, quota) from surfacing as
      // an unhandled rejection; the finally re-enables the buttons so the user can retry.
      console.error('logbook export failed', err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Export your logbook</h2>
          <p className="text-sm text-muted-foreground">
            Download every ascent you've logged, across all boards — CSV for spreadsheets, or
            JSON for a complete backup.
          </p>
        </div>
        {signedOut ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sign in to export your logbook — your ascents sync with your account.
            </p>
            <Button variant="outline" onClick={() => setShowSignIn(true)}>
              Sign in
            </Button>
            <SignInDialog
              open={showSignIn}
              onOpenChange={setShowSignIn}
              title="Sign in to export your logbook"
              hideIntro
            />
          </div>
        ) : status === 'error' ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive" role="alert">
              Couldn't load your logbook{error ? `: ${error}` : ''}.
            </p>
            <Button variant="outline" onClick={() => void loadAscents()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={!ready || busy !== null}
              onClick={() => void handleExport('csv')}
            >
              {busy === 'csv' ? 'Exporting…' : 'Export CSV'}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={!ready || busy !== null}
              onClick={() => void handleExport('json')}
            >
              {busy === 'json' ? 'Exporting…' : 'Export JSON'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
