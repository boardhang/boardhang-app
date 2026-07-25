# Content Site (`site/`) — SEO Surface on the Apex

The static Next.js App Router site in `site/` is Boardhang's **only indexable web
surface**, served on the apex `https://boardhang.app` as its own Vercel project
(`boardhang-site`). The PWA in `web/` stays on `https://www.boardhang.app` and is
**deliberately non-indexable**. Strategy background:
[docs/plans/2026-07-25-002-seo-geo-strategy-plan.md](plans/2026-07-25-002-seo-geo-strategy-plan.md).
Deploy runbook: [`site/CLAUDE.md`](../site/CLAUDE.md) (do not confuse with the
`boardly` runbook in [`web/CLAUDE.md`](../web/CLAUDE.md)).

## Two origins, one product

| Host | Project | Role | Indexable? |
| --- | --- | --- | --- |
| `boardhang.app` (apex) | `boardhang-site` (`site/`) | Landing page, `/guides`, future problem/benchmark pages | **Yes** — `robots.ts` allows all crawlers incl. AI bots; `sitemap.ts` lists every page; every page sets `alternates.canonical`, resolved against `metadataBase` |
| `www.boardhang.app` | `boardly` (`web/`) | The PWA (catalog, BLE lighting, logbook, sessions) | **No** — every response carries `X-Robots-Tag: noindex` (`web/vercel.json` headers); `web/public/robots.txt` allows crawling so the noindex is seen; `web/public/sitemap.xml` is an intentionally empty urlset |

**Why the cross-host split is load-bearing:** the PWA's service worker registers
`navigateFallback: '/index.html'` and answers *every* www navigation from the cached
shell. Content pages on www would be hijacked for returning users. The apex is a
different origin the SW cannot reach — that is the safety mechanism. **Never serve
content routes from www** until the Phase 2 consolidation (PWA → `/app/*` with a
self-unregistering stub SW — a separate, safety-adjacent project).

Cloudflare fronts both hosts. Its "managed robots.txt / block AI bots" zone feature,
when enabled, overrides **both** `web/public/robots.txt` and `site/`'s `robots.ts` —
it must stay disabled (dashboard setting; verify with
`curl https://www.boardhang.app/robots.txt`).

## Apex→www redirect rule

App-shaped apex paths 307-redirect to the same path on www
(`redirects()` in `site/next.config.ts`): `/board/:path*`, `/boards`,
`/session/:path*`, `/lists/:path*`, `/logbook/:path*`, `/settings`. This keeps
pre-existing apex deep links working — `joinUrl.ts` explicitly supports hand-pasted
`boardhang.app/session/join/…` invites. Temporary (307) on purpose: Phase 2 moves the
app onto the apex, and cached permanent redirects would fight that move.

**Every new top-level PWA route needs a matching entry in that list** until Phase 2.

## Canonical URLs and the deep-link mapping

- Content pages are the only canonical URLs: `https://boardhang.app/…` via
  `metadataBase` in `site/app/layout.tsx`.
- Reserved for programmatic SEO (not built): `/problems/<layout>/<slug>-<id>` and
  `/benchmarks/<layout>/<grade>`.
- The PWA's problem-level deep link is **not a path** — it is
  `/board/{layoutId}/catalog?problem={source_catalog_id}` (plus `angle` when
  non-default), built by `catalogNavTarget` in `web/src/catalog/catalogNav.ts` with
  the strip-at-default rule from `web/src/catalog/catalogSearch.ts`. A future content
  problem page's "open in app" link must use this shape — a made-up `/problem/:id`
  path 404s into `/boards`.

## Data-rights posture (for the future problem pages)

The strategy doc defines a risk-tiered rollout for publishing MoonBoard problem data
(aggregates → benchmark lists → per-problem pages). Before any per-problem pages with
hold diagrams are indexed, the site needs a **one-deploy noindex kill-switch** for
that layer (e.g., a single flag flipping `robots` metadata on the problem routes).
Sitewide, the footer carries the "unofficial — not affiliated with Moon Climbing Ltd"
disclaimer; keep it.

## Editorial conventions (`/guides`)

- Server components only; near-zero client JS — every page must be fully readable in
  the raw HTML response (AI crawlers do not execute JavaScript).
- Articles are MDX (`page.mdx`) with `metadata` + canonical, an Article JSON-LD
  block, a visible "Last updated" date, and — where a FAQ exists — a FAQPage JSON-LD
  block driven by the same array as the rendered FAQ so schema and text never drift
  (see `site/app/guides/moonboard-website-retired/page.mdx` as the reference).
- Comparisons must stay honest and disclose that Boardhang writes them; no dead
  "coming soon" links on the guides index.
