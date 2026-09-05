---
title: Vercel Node functions inside the Vite PWA — no bundler, so ESM extensions, wasm files and @vercel/og all bite
date: 2026-09-05
category: docs/solutions/developer-experience
module: web/api (og-page, og-image link-preview functions)
problem_type: developer_experience
component: backend_serverless
severity: high
applies_when:
  - "Adding a serverless function under web/api/ to the Vite PWA"
  - "A function imports modules from web/src/ or a package that reads files from node_modules at runtime"
  - "A function 500s with FUNCTION_INVOCATION_FAILED on Vercel while the same code passes vitest"
  - "Deploying with the Vercel CLI from a subdirectory"
tags: [vercel, serverless, esm, nft, includeFiles, wasm, satori, resvg, vercel-og, vitest, deploy]
---

# Vercel Node functions inside the Vite PWA

## Context

The link-preview feature added two Node functions under `web/api/` (`og-page`, `og-image`)
that import geometry and registry modules from `web/src/` and render a PNG card. The
Vercel project's Root Directory is `web`, `web/package.json` has `"type": "module"`, and
the functions run on Node 24 as **ESM**.

## What bit, and what worked

**1. The builder does not bundle.** `@vercel/node` traces files with `@vercel/nft` and
transpiles each TypeScript file in place. Node's own ESM resolver then loads them, so:

- Relative imports need extensions. `api/` imports `../src/board/boards.js` (the `.js`
  suffix maps to the `.ts` source for tsc, Vite and Vitest alike), and `boards.ts`'s own
  imports of `./renderGeometry` carry `.js` too — including the `import type` one, which
  nodenext also enforces. `web/tsconfig.api.json` (module/moduleResolution `nodenext`,
  `types: ["node"]`, no DOM lib) is a root project reference so `npm run build` rejects an
  extensionless import before Vercel does.
- Only leaf modules are importable from `api/`: `src/board/boards.js`,
  `src/board/renderGeometry.js`, `src/types.js`, `src/catalog/problemPath.js`. Anything
  else reaches the Supabase
  client, `import.meta.env` or DOM globals and fails the API type-check — even via
  `import type`. Declare function-side types locally (`ProblemRow` in
  `api/_lib/catalogRow.ts`) instead of importing `CatalogRow` from `catalogSync.ts`.

**2. `@vercel/og` 1.0.2 does not run under native Node ESM.** Its Node build evaluates
an emscripten `require("fs")` shim (harfbuzz glue) at import time and esbuild's stub
throws `Dynamic require of "fs" is not supported` because `require` is undefined in ESM.
It works in Next.js only because a bundler rewrites that. In a plain `api/` function it
is a 500 on first request. **Use `satori` + `@resvg/resvg-js` directly** (both run
unmodified in Node, and native resvg skips the WASM cold start) with a vendored TTF —
satori renders no text without a font, and it only accepts TTF/OTF/WOFF, not the app's
woff2 fontsource files. Geist Regular (OFL) lives in `web/api/_assets/`. It has no `★`
glyph; spell "4 stars" out in rendered text.

**3. Runtime file reads are invisible to the tracer.** satori's shaper opens
`node_modules/harfbuzzjs/hb.wasm` via a computed path; nft does not follow it and the
function died with `ENOENT … /var/task/web/node_modules/harfbuzzjs/hb.wasm`. The fix is
the function's `includeFiles` glob in `web/vercel.json`, which carries the board art, the
font, `harfbuzzjs/hb.wasm`, `satori/yoga.wasm` and, defensively, `yoga-layout/**/*.wasm`. A literal
`new URL('./file', import.meta.url)` *is* traced, so module-relative asset paths work
without `includeFiles`; `process.cwd()` paths and directory URLs are not.

**4. Vitest gotchas.** `import.meta.url` is not a `file:` URL under the jsdom
environment, so tests that read files relative to the module need
`// @vitest-environment node`. Node's `Request`/`Response`/`Headers` globals are
available in both environments; handlers written against the Web signature
(`GET(request: Request): Promise<Response>`) are unit-testable with a stubbed `fetch`.

**5. `vercel deploy` from the wrong directory creates a project.** The Bash tool's cwd
persists between calls. A deploy run from `web/` (no `.vercel/` link there) did not
fail — it silently created a new project named `web`, connected it to the GitHub repo,
and deployed. Always deploy from the linked repo root (or the worktree root after
`npx vercel@latest link --yes --project boardly --scope skepparpaulbertil-1035s-projects`),
and `git checkout -- .gitignore` afterwards: `link` appends `.env.local` lines to it.

**6. A per-URL CDN cache needs a canonical URL.** Vercel keys the image cache on the
whole URL, so any variant of a valid card URL (extra `&x=`, reordered params, a
re-encoded id, a forged `v`) is a fresh full render. `og-image` renders only when the
raw query string equals the canonical `?problem=<id>&v=<version>` it emits itself and
302s everything else to it; `v` is `updated_at` as epoch milliseconds so the canonical
URL carries no percent-encoding a fetcher could normalise differently.

## What was tried that didn't work

- Shipping `@vercel/og` as planned: import-time crash under native ESM (above).
- Reading board art with `path.join(process.cwd(), 'public/boards', …)`: works locally,
  fragile under the `web` Root Directory; module-relative URLs are layout-independent.

## Verification that proved it

Preview deploy, then: crawler-agent curls on the catalog URL return the per-problem
tags with `cache-control: no-store`; the `og:image` URL is a 200 PNG that is a CDN `HIT`
on the second fetch; a forged `v` 302s to the canonical URL; a browser agent still gets
`index.html`; all six boards' cards are 116–197 KB. See
[content-site.md](../../content-site.md#link-previews-for-shared-problem-urls-www).
