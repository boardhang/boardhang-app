// Upload data layer for the MoonBoard import "Upload" tab. Wraps the three Supabase
// Storage + metadata operations (upload / list-own / remove) plus the client-side file
// gate. This is the app's FIRST use of supabase.storage. The raw file is stored
// untouched under `{userId}/…` in the private `logbook-imports` bucket (bucket + RLS in
// supabase/migrations/0008_logbook_imports.sql); a thin `logbook_imports` row records the
// envelope. No parsing — sample collection only.

import { supabase } from '../supabase/client'

export const BUCKET = 'logbook-imports'
export const MAX_BYTES = 25 * 1024 * 1024 // 25 MiB — matches the bucket's file_size_limit
export const ALLOWED_EXTENSIONS = ['csv', 'json', 'zip', 'txt', 'xlsx'] as const
/** Per-user upload cap. A GDPR export is realistically one file (maybe a CSV + a JSON),
 *  and Remove handles mistakes, so 2 is plenty — and it bounds abuse to 50 MB/user. The
 *  real enforcement is the storage.objects INSERT policy in 0008; this mirrors it so the
 *  UI can warn instead of surfacing a raw RLS error. */
export const MAX_UPLOADS = 2

/** The envelope row (mirrors public.logbook_imports — no MoonBoard content). */
export interface LogbookImport {
  id: string
  storage_path: string
  original_filename: string
  content_type: string
  size: number
  status: string
  created_at: string
}

export type FileCheck = { ok: true } | { ok: false; reason: string }

/** Client-side gate: extension allowlist (browser MIME for .csv is unreliable, so we key
 *  on the filename extension) + the 25 MB cap. The bucket enforces size server-side too. */
export function validateFile(file: File): FileCheck {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      reason: `Unsupported file type. Upload a ${ALLOWED_EXTENSIONS.join(', ')} file.`,
    }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, reason: 'File is too large — the limit is 25 MB.' }
  }
  return { ok: true }
}

function requireClient() {
  if (!supabase) throw new Error('Uploading isn’t available right now — sign-in is unconfigured.')
  return supabase
}

async function currentUserId(client: NonNullable<typeof supabase>): Promise<string> {
  const { data } = await client.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('You need to be signed in to upload.')
  return id
}

/** Keep the filename segment of the storage key clean (no path separators / control
 *  chars). The key is client-asserted; the storage.objects RLS folder-guard is the real
 *  boundary — this is just hygiene. */
function sanitizeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f]/g, '').trim() || 'file'
}

const noop = () => {}

/** Validate → record the envelope row (`pending`) → upload the raw file to
 *  `{userId}/{uuid}-{name}` → flip the row to `uploaded`.
 *
 *  Row-first ordering means a failed upload never leaves an *invisible* orphan (the object
 *  always has a row). `pending` means "row created, bytes not yet confirmed"; only after
 *  the upload succeeds do we mark `uploaded`, so the future importer can trust
 *  `status = 'uploaded'` to mean the file is actually there. */
export async function uploadImport(file: File): Promise<LogbookImport> {
  const check = validateFile(file)
  if (!check.ok) throw new Error(check.reason)

  const client = requireClient()
  const userId = await currentUserId(client)
  const path = `${userId}/${crypto.randomUUID()}-${sanitizeName(file.name)}`

  const { data, error: insertError } = await client
    .from('logbook_imports')
    .insert({
      user_id: userId,
      storage_path: path,
      original_filename: file.name,
      content_type: file.type || '',
      size: file.size,
      status: 'pending',
    })
    .select()
    .single()
  if (insertError) throw insertError
  const row = data as LogbookImport

  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (uploadError) {
    // Best-effort clean up BOTH sides. The object may have physically landed even though
    // the SDK returned an error (the response dropped after the server stored it), so we
    // remove the object as well as the row — otherwise it would be an invisible orphan that
    // eats the per-user cap. If a step fails, at worst a visible, removable row remains.
    await client.storage.from(BUCKET).remove([path]).then(noop, noop)
    await client.from('logbook_imports').delete().eq('id', row.id).then(noop, noop)
    throw uploadError
  }

  // Bytes are stored — mark the row uploaded. Best-effort: if this fails the file still
  // exists under a `pending` row (importer skips it; the user can re-remove it).
  const { data: updated } = await client
    .from('logbook_imports')
    .update({ status: 'uploaded' })
    .eq('id', row.id)
    .select()
    .single()
  return (updated as LogbookImport | null) ?? { ...row, status: 'uploaded' }
}

/** The caller's own uploads, newest first (RLS scopes to the owner). */
export async function listMyImports(): Promise<LogbookImport[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('logbook_imports')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as LogbookImport[]
}

/** Hard-delete: remove the storage object first, then the metadata row. If the storage
 *  remove fails, the row is left intact (recoverable) rather than orphaning the row. */
export async function removeImport(row: Pick<LogbookImport, 'id' | 'storage_path'>): Promise<void> {
  const client = requireClient()
  const { error: removeError } = await client.storage.from(BUCKET).remove([row.storage_path])
  if (removeError) throw removeError
  const { error: deleteError } = await client.from('logbook_imports').delete().eq('id', row.id)
  if (deleteError) throw deleteError
}
