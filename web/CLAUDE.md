# web/ — UI component rules

**Use [shadcn/ui](https://ui.shadcn.com) components for all UI.** shadcn is set up in
this app (Tailwind v4 + `components.json`, base color neutral, `@/` → `src/`). When
building or changing anything in `web/`, reach for a shadcn component before writing a
bespoke one or hand-rolling CSS.

- **New UI** → add the component with `npx shadcn@latest add <name>`, then compose from
  it. It lands in `src/components/ui/`. Don't hand-write a button/dialog/input/etc. when
  shadcn ships one.
- **Existing bespoke UI** → a few hand-written rules in `src/index.css`/`src/App.css`
  predate shadcn. Prefer migrating to the shadcn equivalent when you're already editing
  them; don't add new hand-rolled widgets alongside shadcn ones.
- **Styling** → use Tailwind utilities and the shadcn theme tokens (the CSS variables in
  `src/index.css` — `bg-background`, `text-foreground`, etc.), not ad-hoc hex colors or
  new one-off CSS.
- **Imports** → use the `@/` alias (`@/components/ui/button`, `@/lib/utils`).

## Dependencies — pin exact versions (no `^`/`~`)

**Every version in `package.json` must be exact** — a bare `1.6.0`, never `^1.6.0`
or `~1.6.0`. This protects **developer machines**, not end users: a hijacked patch/minor
release runs its install scripts (or ships code we then import) on whoever next runs
`npm install`, and recent npm supply-chain attacks target devs' tokens, credentials, and
wallets. Ranges let such a release land silently; an exact pin + committed lockfile means
a routine install can't auto-jump into a compromised version, and every upgrade is a
deliberate, reviewed commit.

- **Adding a dep** → after `npm install <name>`, rewrite its `package.json` entry to the
  exact version npm resolved (check `package-lock.json`), so no caret/tilde is left behind.
- **Never** strip a caret by hand to its range *floor* (`^1.5.0` → `1.5.0`): the floor is
  often older than what's installed and would downgrade on the next clean install. Pin to
  the **lockfile's resolved version** instead.
- **Upgrading** → bump the exact version in `package.json`, run `npm install`, commit the
  `package.json` + `package-lock.json` change together.

## Deploying to Vercel

The web app is hosted on Vercel as the **`boardly`** project (org
`skepparpaulbertil-1035s-projects`), serving `https://www.boardhang.app`.
Deploys are **manual via the Vercel CLI from the repo root** — there is no
git-integration auto-deploy, so merging to `main` does *not* ship. You must deploy
explicitly. The project's Root Directory setting is `web`, and current CLI versions
resolve that against the linked directory, so the link and all commands live at the
**repo root**, not in `web/` (running from `web/` fails with a `web/web` path error).

The CLI uploads and builds the current **working tree** (not a git ref), so make sure it's
clean and on the commit you want live before deploying:

```bash
git fetch origin && git status --porcelain   # working tree should be empty
git checkout main && git pull                 # deploy latest main
```

Then, from the repo root:

```bash
# One-time per machine: authenticate and link the repo root to the existing project.
npx vercel login                        # you run this — interactive
npx vercel link --yes --project boardly # writes /.vercel and /.env.local (both gitignored)

# Deploy latest main to production:
npx vercel deploy --prod --yes
```

The deploy prints a `READY` production URL aliased to `https://www.boardhang.app`.
Verify with `npx vercel inspect <url>` or `npx vercel logs <url>`.
