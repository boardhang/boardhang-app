# AGENTS.md — how we work in this repo

Canonical, **agent-neutral** working agreement for this repo: the development pipeline,
the risk tiers that decide how much of it runs, and the branch/commit/PR conventions.
Any agent — or human — should be able to execute this without Claude-specific tooling.

- **What the code is** → [`CONTEXT.md`](CONTEXT.md) (orientation) and [`docs/`](docs/README.md) (depth).
- **How Claude Code runs this pipeline** (which command performs each phase) → [`CLAUDE.md`](CLAUDE.md).
  CLAUDE.md is the tool-specific shim; this file owns the process.

## The pipeline

Non-trivial work flows through these phases. Not every phase fires every time — the
[tier rules](#tier-rules) decide which run.

1. **Ideate / brainstorm** — shape the problem (optional; for fuzzy or risky work).
2. **Plan** — write a plan file to [`docs/plans/`](docs/plans) before writing code.
3. **Branch** — cut a feature branch / worktree (see [conventions](#branching-commits-prs)).
4. **Work** — implement against the plan; commits reference the plan or issue.
5. **Test** — exercise the change end-to-end (web in a browser, iOS in the simulator/device),
   not just unit tests.
6. **Review** — self-review the diff for correctness and simplification.
7. **PR** — open a pull request with the [required body](#branching-commits-prs).
8. **Address feedback** — resolve review comments on the PR.
9. **Merge** — squash/merge via the PR. All changes to `main` go through a PR.
10. **Compound** — after non-trivial work, capture what was learned in
    [`docs/solutions/`](docs/solutions) (see [Compounding](#compounding)).

## Tier rules

Not every change deserves the full pipeline; scale the process to the blast radius.

| Tier | What it is | Process |
| --- | --- | --- |
| **Routine** | Pure `web/` UI tweaks, copy, shadcn swaps, lint/format, dep bumps, scaffolding inside an existing pattern | Work directly from a bare prompt. Review optional, no plan file. |
| **Standard** | New components/routes fitting existing patterns, non-safety schema *reads*, catalog-browsing UI | Plan → work → review → PR. |
| **Safety-critical** | The paths listed below | Ideate → **plan (test-first)** → work → **mandatory review** → PR → **compound**. Extra care; slower is fine. |

**Safety-critical paths** (a bug here is a *physical* hardware bug or *irreversible* data damage
that a passing build won't catch):

- BLE / firmware protocol — `ios/MoonBoardLED/BLE/**`, `web/src/ble/**`,
  `shared/spec/ble-protocol.md`
- Board geometry / LED addressing — `ios/MoonBoardLED/Board/BoardGeometry.swift`,
  `web/src/board/geometry.ts`, `web/src/board/renderGeometry.ts`, `shared/spec/led-geometry.md`
- Database migrations / catalog + logbook data shape — `supabase/migrations/**`

Review is **mandatory before merge** for the safety-critical tier.

## Branching, commits, PRs

We are **PR-first**: the plan file plus the PR are the unit of work. Direct pushes to `main`
are not allowed — everything lands through a pull request.

- **Branch:** `<type>/<short-slug>` (e.g. `feat/global-board-switcher`). `<type>` is a
  Conventional-Commit type (`feat`, `fix`, `chore`, `refactor`, `docs`, …).
- **Commits:** `<type>(scope): subject`. Reference the plan file or issue in the body when one exists.
- **PR title:** `<type>(scope): descriptive subject`.
- **PR body:** what changed and why, a test plan, any out-of-scope callouts, and — if an
  issue exists — `Closes #N` (which auto-closes it on merge).
- **Docs discipline:** if a change alters a subsystem's behavior, update that subsystem's
  `docs/` file in the same PR (see [CLAUDE.md](CLAUDE.md) / [CONTEXT.md](CONTEXT.md)).

## Issue tracking (optional side-channel)

We do **not** require an issue per PR. GitHub Issues are an optional side-channel: file one
when work spans multiple sessions or PRs, needs to be handed to another contributor, or is
blocked on an external dependency. Otherwise the plan file is enough. When an issue exists,
put `Closes #N` in the PR body as the audit link.

## Compounding

After any non-trivial fix, decision, or pattern discovery, write a structured entry to
[`docs/solutions/`](docs/solutions) capturing: **the problem**, **the approach that worked**,
**what was tried that didn't**, and **tags / module references** for future search. This is
what makes the work compound instead of decay — the next session touching the same area
inherits the last one's learning. Skipping it quietly turns this pipeline into a todo runner.
