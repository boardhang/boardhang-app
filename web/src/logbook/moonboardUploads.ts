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

/** Validate → upload the raw file to `{userId}/{uuid}-{name}` → record the envelope row. */
export async function uploadImport(file: File): Promise<LogbookImport> {
  const check = validateFile(file)
  if (!check.ok) throw new Error(check.reason)

  const client = requireClient()
  const userId = await currentUserId(client)
  const path = `${userId}/${crypto.randomUUID()}-${sanitizeName(file.name)}`

  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (uploadError) throw uploadError

  const { data, error: insertError } = await client
    .from('logbook_imports')
    .insert({
      user_id: userId,
      storage_path: path,
      original_filename: file.name,
      content_type: file.type || '',
      size: file.size,
    })
    .select()
    .single()
  if (insertError) {
    // The object is already in the bucket but has no envelope row, so it would be
    // invisible to listMyImports / removeImport — an unreachable personal-data orphan.
    // Best-effort clean it up before surfacing the failure.
    await client.storage.from(BUCKET).remove([path]).catch(() => {})
    throw insertError
  }
  return data as LogbookImport
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
