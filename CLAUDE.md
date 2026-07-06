# CLAUDE.md

**Read [`CONTEXT.md`](CONTEXT.md) first** — it's the handoff/orientation doc (what this is,
repo map, build commands, load-bearing gotchas, and links into the `docs/` deep dives).

**How we work** lives in [`AGENTS.md`](AGENTS.md) — the agent-neutral pipeline, risk tiers,
and branch/commit/PR conventions. Read it before starting non-trivial work. The section below
is only the *Claude-Code-specific mapping* of that process; AGENTS.md owns the actual rules.

## Running the AGENTS.md pipeline in Claude Code

Each pipeline phase maps to a `compound-engineering` plugin command:

| Phase (see [AGENTS.md](AGENTS.md)) | Command |
| --- | --- |
| Ideate / brainstorm | `/ce-brainstorm` (or `/ce-ideate`) |
| Plan → `docs/plans/` | `/ce-plan` |
| Branch / worktree | `/ce-worktree` |
| Work | `/ce-work` |
| Test — web | `/ce-test-browser` |
| Test — iOS | `/ce-test-xcode` |
| Review | `/ce-code-review` |
| PR (commit + push + open) | `/ce-commit-push-pr` |
| Address PR feedback | `/ce-resolve-pr-feedback` |
| Compound → `docs/solutions/` | `/ce-compound` |
| Debug a hard bug | `/ce-debug` |

- **Tier gates the phases** — Routine work skips plan/review; Safety-critical runs the full
  chain and review is mandatory (paths listed in [AGENTS.md](AGENTS.md#tier-rules)).
- **Safety-critical → `effort: max`.** Run safety-critical work (BLE, board geometry,
  `supabase/migrations/**`) at maximum reasoning effort and plan it test-first.
- These commands are the *how*; if you're not in Claude Code, execute the AGENTS.md process
  directly.

Quick shape: a monorepo — `ios/` (primary SwiftUI app), `web/` (Web Bluetooth PWA),
`shared/spec/` (markdown specs, not shared code), `supabase/` (accounts backend),
`docs/` (subsystem deep dives, indexed at [`docs/README.md`](docs/README.md)).

Doc discipline: each topic lives in **one** place. `CONTEXT.md` summarizes and links;
`docs/` owns the depth; `README.md` is the user-facing run guide. Don't restate a subsystem
in two files. If you change a subsystem's behavior, update its `docs/` file in the same commit.
