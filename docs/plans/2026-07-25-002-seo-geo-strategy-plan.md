# Boardhang SEO + GEO strategy

_Research date: 2026-07-25. Six-agent research sweep (keyword demand, competitors, GEO,
programmatic SEO, site architecture, content/distribution); all claims below were
source-verified during that sweep — live fetches of boardhang.app, moonboard.com,
boardsesh.com, kilterboardapp.com, plus 2026 AI-crawler and citation studies._

## TL;DR — the decisions

1. **No separate boardhang.com site.** Consolidate everything on **boardhang.app** — the
   PWA's origin (Web Bluetooth grants, installed-PWA identity, localStorage/IndexedDB
   logbook) is locked to it, TLD has zero ranking weight, and splitting marketing onto a
   second registrable domain permanently divides authority. **Register boardhang.com today
   anyway** (it is confirmed unregistered, ~$10/yr) as brand defense and 301 it to .app.
2. **Yes to a separate _project_**: a new Next.js App Router content site (second Vercel
   project) serving the marketing + guides + programmatic catalog pages as static/ISR
   HTML. The PWA stays a Vite SPA; the two compose on one domain.
3. **The market timing is unusually good and time-sensitive.** moonboard.com's problem
   pages are dead (Cloudflare challenge-gated, 403 — verified live) but still indexed in
   Google; the June 2026 official-app migration is losing users' favorites; the official
   app is rated ~1.9–2.3/5; Aurora's kilterboardapp.com is TLS-dead; boardsesh does zero
   SEO (24-URL sitemap, no climb pages). **No living site has indexed MoonBoard problem
   pages.** First mover into this vacuum tends to become the permanently cited answer.
4. **Boardhang today is invisible**: `site:boardhang.app` returns zero results. The SPA
   serves an empty `<div id="root">`, robots.txt is a malformed Cloudflare-managed block
   that **Disallows ClaudeBot, GPTBot, Google-Extended, CCBot** (then falls through to
   HTML garbage), and sitemap.xml serves the SPA shell. No AI crawler executes JavaScript
   (verified 2026 studies), so nothing works until the technical floor is fixed.

## Why GEO matters as much as SEO here

"Best moonboard app", "how do I build a DIY LED moonboard" are exactly the questions
people now ask ChatGPT/Claude/Perplexity. The current answer-space is weak: app-store
listings, an alternativeto.net page that lists only Kilter/Tension, GitHub READMEs, and
stale forum threads. The 20-byte BLE truncation bug — Boardhang's founding story — is
documented **nowhere** on the searchable web. Original technical facts + concrete numbers
("11,915 problems", "writes over 20 bytes truncate") are the most-cited content class
(Princeton GEO study: statistics +37%, citations +40%).

Citation-pattern ground truth (2026): Reddit is the #1 cited domain across engines but
**blocks Anthropic's crawler**, so Claude visibility must come from open surfaces —
Boardhang's own site, GitHub, Mountain Project, Arduino Forum. GitHub already wins the
DIY-query SERPs in every engine → README-level presence there is the single
highest-leverage off-site move.

## Dataset reality check (from the live catalog dump)

The curated production catalog is **11,915 problems, 2,832 benchmarks** across the
supported layouts (2016: 4,132 / Masters 2017: 4,927 / 2024: 1,604 / Masters 2019: 500 /
Mini 2025: 295) — not the 75k upstream boardsesh mirror. 2,209 problems have ≥500
repeats. This kills the "75k-page crawl trap" worry and reframes indexation: **~70
benchmark list pages + ~15 hubs + ~3.5–4.5k tiered problem pages**, rest `noindex,follow`.

## Target architecture

- **One canonical host** (www.boardhang.app). Two Vercel projects:
  - `boardhang-site` (new): Next.js App Router, SSG + ISR. Owns `/`, `/problems/**`,
    `/benchmarks/**`, `/guides/**`, `/compare/**`, `robots.txt`, `sitemap.xml`. Fully
    static HTML per page (server-render the board SVG — it's the money asset), JSON-LD
    (SoftwareApplication, BreadcrumbList, ItemList, HowTo/FAQ on guides), near-zero
    client JS.
  - `boardly` (existing PWA, slug unchanged): eventually served at `/app/**` via Vercel
    Microfrontends path routing (2 projects included on all plans) or vercel.json proxy
    rewrites; **`X-Robots-Tag: noindex`** on `/app/**` (no robots.txt disallow, or Google
    never sees the noindex).
- **Phased rollout to protect the live PWA:**
  - **Phase 1 (ship in days, zero PWA risk):** content site on apex `boardhang.app`; PWA
    untouched on `www`. Start indexing immediately.
  - **Phase 2 (safety-adjacent — full review per AGENTS.md):** move PWA to `/app/*` on
    the same origin — vite `base: '/app/'`, router basename, manifest `start_url`/`scope`,
    SW scope `/app/`, **plus a self-unregistering stub SW at the old `/` scope** (else
    cached shells hijack the new content pages for returning users). 301 legacy SPA deep
    links to the matching content page. Same-origin path moves preserve localStorage/
    IndexedDB/BLE grants — this is why the domain must stay boardhang.app.
- **Canonical split:** content page is the only indexable URL per problem
  (`/problems/<layout>/<slug>-<id>` — one canonical, avoid Kaya's duplicate-variant
  mess); it carries the "Open in app / light it up" CTA into `/app/...`; the PWA's
  share button emits the **content** URL so every forum/Discord paste builds equity on an
  indexable page.
- Astro was evaluated as runner-up: better raw HTML/CWV, but loses on ISR at thousands of
  pages with periodic mirror refreshes and on React board-component reuse.

> **Amendment 2026-07-26 — Phase 2 is dropped; two origins is the end state.**
>
> "One canonical host" above is superseded. The content site stays on the apex
> `boardhang.app` and the PWA stays on `www.boardhang.app`, permanently. Decision #1
> (no separate `boardhang.com` site) is unaffected and still holds — the costly split
> is across registrable domains, which this avoids; apex-vs-www is the mild kind.
>
> Why the consolidation stopped being worth it once the content site existed:
> consolidation pools authority, but neither host has any to pool, and the PWA is
> `noindex` **by design** so it can never benefit from pooling wherever it sits. The
> one real gain — share links building equity on indexable pages — comes from the
> share button emitting content URLs, which works identically across origins.
>
> Against that: consolidating on the apex moves the PWA cross-origin and loses every
> user's favorites, filters and added boards, the logbook for signed-out users, every
> Web Bluetooth pairing and every installed PWA. Consolidating on www is safe for
> users but is a full content-site migration to buy what a share-button change buys.
> Phase 2 was also tiered safety-adjacent (full review) — too expensive for the
> return.
>
> Note this section was already internally inconsistent: the bullet named www as the
> canonical host while Phase 2 described a same-origin path move, which only works if
> the content site relocates to www. `docs/content-site.md` had resolved it the other
> way ("Phase 2 moves the app onto the apex") — the cross-origin reading the same
> paragraph's own rationale rules out. Dropping Phase 2 settles it.
>
> Current state and the two follow-ups this creates live in
> [docs/content-site.md](../content-site.md) §"The split is permanent".

## Data-rights posture (not legal advice — risk framing)

Moon Climbing (UK) treats the problem DB as an asset (web access killed, app
attestation-gated, data licensed selectively to Lattice). The live theory is the **UK
sui generis database right** over a "substantial part" — and the benchmark set is both
the most SEO-valuable and the most curated/protected-looking slice. Countervailing: broad
untouched precedent (Kaya's thousands of indexed per-problem pages, boardsesh's public
API + store apps, theCrag benchmark lists, simonchase, GitHub scrapers) and no findable
enforcement history. Realistic worst case is a C&D, not damages.

**Risk-tiered rollout:**
- **Tier 0 (negligible — ship first):** aggregate/editorial pages built on computed stats
  (grade distributions, sandbagging analysis, layout comparisons, DIY guides).
- **Tier 1 (moderate):** ~70 benchmark list pages — add original value per page
  (user-grade consensus deltas, repeat ordering, beta-video links) so they read as
  analysis-over-facts, not a mirror.
- **Tier 2:** per-problem pages with hold diagrams, benchmarks + repeats≥500 only
  (~3.5–4.5k indexed).
- **Tier 3 (full 12k+ with diagrams): counsel review first.**
- Cross-cutting: sitewide "unofficial — not affiliated with Moon Climbing" disclaimer,
  boardsesh attribution, takedown contact, and a **one-deploy noindex kill-switch** for
  the whole problem layer.

## Content plan (4 pillars, 2 heroes)

| Piece | Why | When |
| --- | --- | --- |
| "MoonBoard website retired — where to browse problems now" | Zero competition, fresh vacuum, time-sensitive | Week 1–2 |
| README PR to FabianRig/ArduinoMoonBoardLED + ESP32 forks ("Compatible apps") | 100% ICP at moment of need; highest-leverage single action | Week 1–2 |
| **Hero 1: The complete DIY LED MoonBoard build guide** (parts/cost table, WS2811 wiring, firmware flash, "connect with Boardhang") | No prose guide exists; SERP is GitHub READMEs + 2016-2020 YouTube; every reader becomes a user | Weeks 3–5 |
| **Hero 2: The 20-byte BLE bug write-up** (packet captures, MTU math, the workaround) | Documented nowhere; Show HN / lobste.rs material; earns dev backlinks + LLM citations | Weeks 6–7 |
| Show HN: "light up a DIY LED climbing board from the browser" | Web Bluetooth + DIY hardware is HN-native | Weeks 8–9 |
| "MoonBoard app alternative" + "MoonBoard Bluetooth not working — fixes" landing pages | Official app at 1.9–2.3/5 with chronic BLE/login complaints; low-difficulty, highest-intent | Weeks 8–9 |
| Benchmarks-by-grade series (start V4/V5) + "MoonBoard vs Kilter vs Tension for home walls" (DIY/budget angle) | Data-generated from catalog; only stale competition | Weeks 10–13 |
| Later: "Are MoonBoard grades sandbagged? What 12k problems say" data piece; grade-vs-gym converter; logbook/grade-pyramid piece | Original-data shareables = strongest citation magnets | Post-90d |

Deferred: generic Font↔V converter (saturated), setter pages (doorway trap — noindex,
maybe curate ~20 notable setters later), hold-set commercial queries, training pillar,
Instagram/YouTube originals (comment/outreach on existing build videos instead).

**Distribution:** Reddit-first (r/MoonBoard, r/homewall, r/climbharder; 90/10
help-to-mention, always disclose being the developer, one launch post per sub max, framed
"the official app broke my DIY board so I built a free one"); UKClimbing forums;
alternativeto.net submission (its "Moon Board Alternatives" page ranks and currently
lists no real alternative); Wikidata entry once 2–3 independent references exist (skip
Wikipedia — fails notability today).

## Competitive watch-outs

- **Boardsesh is now both data source and competitor** (shipped an iOS app with MoonBoard
  BLE; SSR Next.js site but zero SEO ambition). Differentiate on MoonBoard depth
  (5 layouts incl. Mini 2025, hold-set art, benchmark curation, per-problem pages) + the
  DIY/Arduino story they don't own. Keep a fallback plan for the GraphQL mirror
  dependency. Credit them; don't position against them.
- Kilter/Tension expansion: thousands of dead indexed kilterboardapp.com URLs are an even
  larger vacuum — a product decision for later, not an SEO one now.
- The app-migration pain window (favorites lost, old API killed ~6 weeks post-rollout)
  peaks **now through autumn 2026** — the rescue content is the perishable part.

## Prioritized backlog

**P0 — technical floor (nothing else works first):**
1. Register boardhang.com; wildcard 301 → boardhang.app.
2. Replace the Cloudflare-managed robots.txt with a real static one (web/public/robots.txt);
   explicitly allow GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot,
   Google-Extended, Bingbot, Applebot. Fix the sitemap.xml-serves-HTML fallback.
3. Stand up the Next.js content site (Phase 1 on apex): landing page with real HTML, meta,
   OG, JSON-LD; `/guides` surface; segmented sitemaps.
4. Ship Tier 0 content: rescue piece + GitHub README PRs.

**P1:** benchmark list pages (Tier 1) → tiered problem pages (Tier 2) with the noindex
kill-switch; hero guides + HN sequence; app-pain landing pages; schema layer; Reddit
participation program; Phase 2 origin consolidation.

**P2:** llms.txt (after SSR — Anthropic/Perplexity use it, Google/OpenAI ignore it);
YouTube build video + 90s browser demo; comparison/data pieces; monthly GEO monitoring
loop (15 tracked queries across ChatGPT/Perplexity/AI Overviews/Claude — expect a 2–6
month lag from P0 to first citations); counsel check before Tier 3.

_Note: shipping the iOS app to the App Store is itself a GEO asset ("best moonboard app"
answers are app-store-listing-shaped), but iOS is on hold — revisit when it resumes._
