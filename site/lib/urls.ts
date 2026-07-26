// Single source of truth for the two origins. SITE_URL is this indexable
// content site on the apex; APP_URL is the PWA on www. The split is permanent —
// see docs/content-site.md §"The split is permanent" for why the two never
// merge onto one host.
export const SITE_URL = 'https://boardhang.app'
export const APP_URL = 'https://www.boardhang.app'

// Public contact address — a Cloudflare Email Routing alias on the zone, so the
// destination inbox stays private and can be repointed without touching the site.
// It exists so rights holders and privacy requests have a *private* channel:
// nobody files a complaint about themselves in a public GitHub issue.
export const CONTACT_EMAIL = 'hello@boardhang.app'
