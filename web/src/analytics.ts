import { inject, pageview, type BeforeSendEvent } from '@vercel/analytics'
import type { AnyRouter } from '@tanstack/react-router'

// Vercel Web Analytics: cookieless, aggregate page views. The script is served
// first-party from /_vercel/insights/ once Web Analytics is enabled on the Vercel
// project — enabling it in the dashboard alone records nothing; the app has to
// load the script, which is what this module does.
//
// Two things are deliberately kept out of what we send:
//  - query strings and hashes: catalog filters, the open problem and the OAuth
//    return fragment all live there;
//  - path segments that identify a person's data: a session join token is a
//    bearer secret, and a list id names someone's list.

const REDACTIONS: [RegExp, string][] = [
  [/^\/session\/join\/[^/]+/, '/session/join/[token]'],
  [/^\/lists\/[^/]+/, '/lists/[listId]'],
]

/** A pathname with identifying segments replaced by their parameter name. */
export function redactPath(pathname: string): string {
  for (const [pattern, replacement] of REDACTIONS) {
    if (pattern.test(pathname)) return pathname.replace(pattern, replacement)
  }
  return pathname
}

/** A full URL reduced to origin + redacted path: no query string, no hash. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.origin + redactPath(parsed.pathname)
  } catch {
    return url.split(/[?#]/)[0]
  }
}

/** TanStack route id (`/lists/$listId`) → Vercel's route form (`/lists/[listId]`). */
export function routeTemplate(routeId: string | undefined): string | null {
  if (!routeId || !routeId.startsWith('/')) return null
  return routeId.replace(/\$([A-Za-z0-9_]+)/g, '[$1]')
}

function beforeSend(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: redactUrl(event.url) }
}

/** Start page-view tracking. Production builds only (which includes Vercel
 *  previews, reported under their own environment): there is no script to load
 *  on the Vite dev server or under test. */
export function initAnalytics(router: AnyRouter): void {
  if (!import.meta.env.PROD) return

  // The script's own tracking fires on every pushState, and this app keeps its
  // filters in the URL — so one page view per filter change. Report from the
  // router instead, once per resolved navigation that changes the path.
  inject({ beforeSend, disableAutoTrack: true })

  router.subscribe('onResolved', ({ toLocation, pathChanged }) => {
    if (!pathChanged) return
    pageview({
      route: routeTemplate(router.state.matches.at(-1)?.routeId),
      path: redactPath(toLocation.pathname),
    })
  })
}
