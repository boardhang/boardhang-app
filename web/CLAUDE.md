# web/ — UI component rules

**Use [shadcn/ui](https://ui.shadcn.com) components for all UI.** shadcn is set up in
this app (Tailwind v4 + `components.json`, base color neutral, `@/` → `src/`). When
building or changing anything in `web/`, reach for a shadcn component before writing a
bespoke one or hand-rolling CSS.

- **New UI** → add the component with `npx shadcn@latest add <name>`, then compose from
  it. It lands in `src/components/ui/`. Don't hand-write a button/dialog/input/etc. when
  shadcn ships one.
- **Existing bespoke UI** → the older components (`ConnectBar`, `BoardGrid`) and the
  hand-written rules in `src/index.css` predate shadcn. Prefer migrating them to the
  shadcn equivalent when you're already editing them; don't add new hand-rolled widgets
  alongside shadcn ones.
- **Styling** → use Tailwind utilities and the shadcn theme tokens (the CSS variables in
  `src/index.css` — `bg-background`, `text-foreground`, etc.), not ad-hoc hex colors or
  new one-off CSS.
- **Imports** → use the `@/` alias (`@/components/ui/button`, `@/lib/utils`).

## Deploying to Vercel

The web app is hosted on Vercel as the **`boardly`** project (org
`skepparpaulbertil-1035s-projects`), serving `https://dist-six-livid-1h9ns7kuqc.vercel.app`.
Deploys are **manual via the Vercel CLI from this `web/` directory** — there is no
git-integration auto-deploy, so merging to `main` does *not* ship. You must deploy explicitly.

The CLI uploads and builds the current **working tree** (not a git ref), so make sure it's
clean and on the commit you want live before deploying:

```bash
git -C .. fetch origin && git status --porcelain   # working tree should be empty
git checkout main && git pull                       # deploy latest main
```

Then, from `web/`:

```bash
# One-time per machine: authenticate and link this dir to the existing project.
npx vercel login                        # you run this — interactive
npx vercel link --yes --project boardly # writes .vercel/ (gitignored)

# Deploy latest main to production:
npx vercel --prod --yes
```

`vercel link` also drops a gitignored `.env.local` and appends `.env*.local` to
`web/.gitignore` — both are expected; keep them. The deploy prints a `READY` production URL
aliased to the `dist-six-livid…` domain. Verify with `npx vercel inspect <url>` or
`npx vercel logs <url>`.
