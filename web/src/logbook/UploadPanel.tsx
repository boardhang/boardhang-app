// The "Upload" tab: a signed-in user uploads the CSV/JSON/ZIP file Moon Climbing returned
// from their GDPR request. Auth-gated (the storage folder + RLS key on the user id); the
// file goes to the private logbook-imports bucket untouched (see moonboardUploads.ts). No
// parsing — sample collection so we can build the importer. A consent checkbox gates the
// upload (the file is shared with the developer), and the user can see and remove their
// own uploads.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { SignInPanel } from '../auth/SignInPanel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ALLOWED_EXTENSIONS,
  listMyImports,
  removeImport,
  uploadImport,
  validateFile,
  type LogbookImport,
} from './moonboardUploads'

const ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')

export function UploadPanel() {
  const { status, isRestoring } = useAuth()

  if (isRestoring) {
    return <Skeleton className="h-40 w-full rounded-lg" />
  }

  if (status === 'signedOut') {
    return (
      <div className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Sign in to upload your export</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Uploading is tied to your account so only you (and the app developer) can see the
          file.
        </p>
        <SignInPanel />
      </div>
    )
  }

  return <Uploader />
}

function Uploader() {
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imports, setImports] = useState<LogbookImport[]>([])
  const [listLoading, setListLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setListLoading(true)
    try {
      setImports(await listMyImports())
    } catch {
      // Best-effort — the list is a convenience; a fetch failure shouldn't block uploading.
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const picked = e.target.files?.[0] ?? null
    if (!picked) {
      setFile(null)
      return
    }
    const check = validateFile(picked)
    if (!check.ok) {
      setError(check.reason)
      setFile(null)
      return
    }
    setFile(picked)
  }

  async function onUpload() {
    if (!file || !consent || busy) return
    setBusy(true)
    setError(null)
    try {
      await uploadImport(file)
      // Reset the form and reload the list.
      setFile(null)
      setConsent(false)
      if (inputRef.current) inputRef.current.value = ''
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(row: LogbookImport) {
    try {
      await removeImport(row)
      setImports((prev) => prev.filter((r) => r.id !== row.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t remove that file.')
    }
  }

  const canUpload = file !== null && consent && !busy

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Upload your MoonBoard file</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Once Moon Climbing sends your data back, upload it here. We store the file as-is so
          we can build the importer — {ALLOWED_EXTENSIONS.join(', ')} up to 25 MB.
        </p>

        <div className="mt-3 space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={onPick}
            aria-label="Choose your MoonBoard export file"
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
          />

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              I understand this file will be shared with the developer to build the importer.
            </span>
          </label>

          <Button onClick={() => void onUpload()} disabled={!canUpload}>
            {busy ? 'Uploading…' : 'Upload file'}
          </Button>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Your uploads</h2>
        {listLoading ? (
          <Skeleton className="mt-3 h-10 w-full" />
        ) : imports.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No files uploaded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/50">
            {imports.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{row.original_filename}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${row.original_filename}`}
                  onClick={() => void onRemove(row)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
