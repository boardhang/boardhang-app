# site/ — content site (apex `https://boardhang.app`)

Static Next.js App Router site — the marketing/content surface on the apex domain.
The PWA lives in `web/` and serves `https://www.boardhang.app`; see
[`../web/CLAUDE.md`](../web/CLAUDE.md) for its **boardly** deploy runbook.

House rules match `web/`: 2-space indent, no semicolons, single quotes, **never run
prettier** (lint with `npm run lint` = oxlint), and every dependency **exact-pinned**
to the lockfile-resolved version (no `^`/`~` — see the pinning rules in
`../web/CLAUDE.md`).

## Deploying to Vercel

This directory deploys as its **own** Vercel project, **`boardhang-site`** (org
`skepparpaulbertil-1035s-projects`), serving the apex `https://boardhang.app`.
It is deliberately **not** the `boardly` project linked at the repo root — that link
(`/.vercel`) belongs to the PWA and must not be touched. `boardhang-site` keeps its
Root Directory setting **unset** and is linked/deployed with `--cwd site`, which
writes the link to `site/.vercel` (gitignored).

Deploys are **manual via the Vercel CLI** — no git-integration auto-deploy, so merging
to `main` does not ship. Ops steps run **post-merge from latest `main`** at the repo
root, with a clean working tree:

```bash
git fetch origin && git status --porcelain   # working tree should be empty
git checkout main && git pull                 # deploy latest main
```

Then, from the repo root:

```bash
# One-time per machine: authenticate and link site/ to the project.
npx vercel login                                        # you run this — interactive
npx vercel link --cwd site --project boardhang-site     # writes site/.vercel (gitignored)

# Deploy latest main to production:
npx vercel deploy --cwd site --prod --yes
```

Verify with `npx vercel inspect <url>` or `npx vercel logs <url>`.

The project exists and owns the apex as of **2026-07-26**, so `link` now resolves an
existing project instead of creating one. Answer **no** to "Customize settings?" — the
detected Next.js defaults are right, and setting a Root Directory here fights
`--cwd site` and resolves to `site/site`.

### If you ever re-add the apex domain in the dashboard

**Untick "Redirect apex domains to www (recommended)".** It is checked by default, and
Vercel's recommendation assumes apex and www are one site picking a canonical. Here www
is a *different project* — the PWA — so accepting it redirects the apex into the app and
the content site becomes unreachable. Add `boardhang.app` to `boardhang-site` as
**Connect to an environment → Production**, and remove it from `boardly` first; two
projects cannot hold the same domain.
