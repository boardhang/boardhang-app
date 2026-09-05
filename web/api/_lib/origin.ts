// The origin the functions put into absolute URLs (og:url, og:image). The request's
// host header is used only when it is the production domain or one of the
// deployment's own Vercel hosts; anything else (a spoofed Host) falls back to the
// canonical origin, so no header value can steer og:url or og:image off-site.

export const CANONICAL_ORIGIN = 'https://www.boardhang.app'
const CANONICAL_HOST = 'www.boardhang.app'

export interface OriginEnv {
  VERCEL_URL?: string
  VERCEL_BRANCH_URL?: string
  VERCEL_PROJECT_PRODUCTION_URL?: string
}

function firstHost(value: string | null): string {
  return (value ?? '').split(',')[0].trim().toLowerCase()
}

export function resolveOrigin(headers: Headers, env: OriginEnv): string {
  const allowed = new Set(
    [CANONICAL_HOST, env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
      .filter((h): h is string => typeof h === 'string' && h.length > 0)
      .map((h) => h.toLowerCase()),
  )
  for (const candidate of [firstHost(headers.get('x-forwarded-host')), firstHost(headers.get('host'))]) {
    if (candidate && allowed.has(candidate)) return `https://${candidate}`
  }
  return CANONICAL_ORIGIN
}
