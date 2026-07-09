// Client-side avatar image pipeline (U2). Turns an arbitrary user-picked image into a
// small square WebP for upload — no cropper UI, no dependency. The user picks any image
// (`accept="image/*"`; iOS *usually* hands us a JPEG for a HEIC pick, but not always), we
// center-crop to a square and downscale to ~512px, then re-encode to WebP. What lands in
// the `avatars` bucket is ALWAYS WebP regardless of the source, so the bucket's
// `allowed_mime_types: ['image/webp']` is satisfied.
//
// Failure is loud but caught: decode can fail (a raw HEIC on a non-Apple browser) and
// canvas.toBlob SILENTLY returns PNG for an unsupported type instead of throwing, so we
// assert the output is WebP. Either way we throw AvatarImageError, which the edit UI turns
// into an actionable "couldn't read that image" message (R11).

/** Longest edge of the stored square avatar. Renders tiny; 512 is crisp on retina. */
export const AVATAR_SIZE = 512
/** WebP quality — visually indistinguishable at avatar sizes, ~50–150 KB out. */
const WEBP_QUALITY = 0.85

/** Typed error so the edit view can show one friendly message for every failure mode. */
export class AvatarImageError extends Error {
  constructor(message = "Couldn't read that image — try another photo (or re-save it as JPEG).") {
    super(message)
    this.name = 'AvatarImageError'
  }
}

/** The centered square source rect for a `w`×`h` image cropped to a `target` square.
 *  Pure + exported so the crop math is unit-tested without a canvas. */
export function computeCropRect(
  w: number,
  h: number,
  target = AVATAR_SIZE,
): { sx: number; sy: number; side: number; target: number } {
  const side = Math.min(w, h)
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side, target }
}

/** The processed result: an in-memory WebP blob + an object URL for instant preview.
 *  The caller owns revoking `previewUrl` (URL.revokeObjectURL) when the preview goes away. */
export interface ProcessedAvatar {
  blob: Blob
  previewUrl: string
}

/** Decode → center-crop → downscale → WebP. Throws {@link AvatarImageError} on any
 *  decode/encode failure. DOM-only at the edges (createImageBitmap + canvas); the crop math
 *  lives in the pure {@link computeCropRect}. */
export async function processAvatarFile(file: File): Promise<ProcessedAvatar> {
  if (!file.type.startsWith('image/')) throw new AvatarImageError()

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // Undecodable format (e.g. raw HEIC handed to a non-Apple browser).
    throw new AvatarImageError()
  }

  try {
    const { sx, sy, side, target } = computeCropRect(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = target
    canvas.height = target
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new AvatarImageError()
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, target, target)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY),
    )
    // toBlob returns null on failure and SILENTLY falls back to PNG for an unsupported
    // type — assert WebP so a non-WebP payload never reaches the webp-only bucket.
    if (!blob || blob.type !== 'image/webp') throw new AvatarImageError()

    return { blob, previewUrl: URL.createObjectURL(blob) }
  } finally {
    bitmap.close()
  }
}
