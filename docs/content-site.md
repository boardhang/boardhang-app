# Content Site (`site/`) — SEO Surface on the Apex

The static Next.js App Router site in `site/` is Boardhang's **only indexable web
surface**, served on the apex `https://boardhang.app` as its own Vercel project
(`boardhang-site`). The PWA in `web/` stays on `https://www.boardhang.app` and is
**deliberately non-indexable**. Strategy background:
[docs/plans/2026-07-25-002-seo-geo-strategy-plan.md](plans/2026-07-25-002-seo-geo-strategy-plan.md).
Deploy runbook: [`site/CLAUDE.md`](../site/CLAUDE.md) (do not confuse with the
`boardly` runbook in [`web/CLAUDE.md`](../web/CLAUDE.md)).

**Live since 2026-07-26.** Both hosts are deployed and verified: the apex serves the
content site (200, `x-nextjs-prerender: 1`, no `X-Robots-Tag`), www still serves the
PWA with `X-Robots-Tag: noindex` and an unchanged manifest `scope`/`start_url`. All
apex→www deep-link redirects preserve query strings. Cloudflare's **Managed
robots.txt** (AI Crawl Control → Overview) and its **Block AI bots** WAF scope
(Security → Settings) are both **off** — with them on, Cloudflare injected a 64-line
`robots.txt` that `Disallow`ed ClaudeBot, GPTBot, CCBot, Google-Extended,
Applebot-Extended, Amazonbot and meta-externalagent on *both* hosts, overriding
`robots.ts`. **If crawl traffic ever drops to zero, re-check those two settings
first** — they are zone-level and outside the repo. Google Search Console is verified
as a domain property via DNS TXT with the apex sitemap submitted.

## Two origins, one product

| Host | Project | Role | Indexable? |
| --- | --- | --- | --- |
| `boardhang.app` (apex) | `boardhang-site` (`site/`) | Landing page, `/guides`, future problem/benchmark pages | **Yes** — `robots.ts` allows all crawlers incl. AI bots; `sitemap.ts` lists every page; every page sets `alternates.canonical`, resolved against `metadataBase` |
| `www.boardhang.app` | `boardly` (`web/`) | The PWA (catalog, BLE lighting, logbook, sessions) | **No** — every response carries `X-Robots-Tag: noindex` (`web/vercel.json` headers); `web/public/robots.txt` allows crawling so the noindex is seen; `web/public/sitemap.xml` is an intentionally empty urlset |

**Why the cross-host split is load-bearing:** the PWA's service worker registers
`navigateFallback: '/index.html'` and answers *every* www navigation from the cached
shell. Content pages on www would be hijacked for returning users. The apex is a
different origin the SW cannot reach — that is the safety mechanism. **Never serve
content routes from www.**

### The split is permanent (decided 2026-07-26)

Two hosts is the end state, not a staging post. The strategy doc's Phase 2 — moving
the PWA to `/app/*` so both surfaces share one host — is **dropped**. It was written
before the content site existed, and once the content site became the indexable
surface the thing it was solving mostly stopped being a problem:

- Consolidation pools authority between hosts. Neither host has any authority to
  pool, and the PWA is `noindex` **by design**, so it can never benefit from pooling
  no matter which host it sits on.
- The one real gain was share links building equity on indexable pages. That comes
  from changing what the PWA's share button emits, which works the same across
  origins — no move required. See the follow-ups below.
- Consolidating on the **apex** would move the PWA cross-origin, losing every user's
  favorites, filters, pinned filters and added boards, the logbook for signed-out
  users, every Web Bluetooth pairing, and every installed PWA. Consolidating on
  **www** is safe for users but means migrating the content site — rewriting every
  canonical and 301'ing the apex — to buy what a share-button change already buys.

Consequences that follow from this:

- The apex→www redirects below are **standing policy**, not a temporary bridge.
  They stay **307**: permanence buys nothing here, and a cached permanent redirect
  cannot be undone if this is ever revisited.
- Apex canonicals are permanent. Write them freely.
- `www` hosting the *app* rather than the marketing site is unconventional — the
  usual shape is `example.com` for content and `app.example.com` for the app. It is
  this way because the PWA was there first and its origin carries user data and
  Bluetooth grants. **Do not "fix" the naming**: `www` → `app` is another
  cross-origin move with the same losses listed above.

Revisit only if the PWA itself ever needs to be indexable — that would mean
server-rendering real content inside the app, which is the job this site exists to do.

Follow-ups this decision created:

- **Done (2026-07-26): the PWA links back to the apex.** Two rows at the foot of
  `web/src/shell/SettingsScreen.tsx` (Guides, About Boardhang), plus a `<noscript>` in
  `web/index.html`. The `<noscript>` is the load-bearing half for crawlers: the app is
  client-rendered, so an in-app React link is invisible to anything that does not
  execute JavaScript, which is every AI crawler. Both are pinned by tests in
  `SettingsScreen.test.tsx` — the links exist for a reason and should not be quietly
  dropped.
- **Blocked: the PWA's share button cannot emit apex content URLs yet.** Two reasons,
  and both have to clear first. (1) There is no problem-share button — the only share
  surface is `web/src/sessions/ShareSession.tsx`, which shares *session invites*, and
  those must stay on www: a session has no content-page equivalent, and `joinUrl.ts`
  builds from `window.location.origin` on purpose so a QR works on prod, preview and
  localhost alike. (2) The apex problem pages do not exist —
  `/problems/<layout>/<slug>-<id>` is reserved, not built, and is not in the apex→www
  redirect list, so emitting such a URL today yields a 404. This becomes actionable as
  part of shipping the programmatic problem pages, not before.

Cloudflare fronts both hosts. Its "managed robots.txt / block AI bots" zone feature,
when enabled, overrides **both** `web/public/robots.txt` and `site/`'s `robots.ts` —
it must stay disabled (dashboard setting; verify with
`curl https://www.boardhang.app/robots.txt`).

## Apex→www redirect rule

App-shaped apex paths 307-redirect to the same path on www
(`redirects()` in `site/next.config.ts`): `/board/:path*`, `/boards`,
`/session/:path*`, `/lists/:path*`, `/logbook/:path*`, `/settings`. This keeps
pre-existing apex deep links working — `joinUrl.ts` explicitly supports hand-pasted
`boardhang.app/session/join/…` invites.

**307, not 301, permanently.** These are standing policy now that the two-origin
split is the end state, but they stay temporary redirects: a permanent redirect is
cached indefinitely by browsers and cannot be invalidated later, and permanence buys
nothing when the target is a `noindex` host with no ranking to consolidate.

**Every new top-level PWA route needs a matching entry in that list.**

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
  (see `site/app/guides/moonboard-website-not-working/page.mdx` as the reference).
- Comparisons must stay honest and disclose that Boardhang writes them; no dead
  "coming soon" links on the guides index.
