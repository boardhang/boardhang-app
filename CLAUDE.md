# CLAUDE.md

**Read [`CONTEXT.md`](CONTEXT.md) first** — it's the handoff/orientation doc (what this is,
repo map, build commands, load-bearing gotchas, and links into the `docs/` deep dives).

Quick shape: a monorepo — `ios/` (primary SwiftUI app), `web/` (Web Bluetooth PWA),
`shared/spec/` (markdown specs, not shared code), `supabase/` (accounts backend),
`docs/` (subsystem deep dives, indexed at [`docs/README.md`](docs/README.md)).

Doc discipline: each topic lives in **one** place. `CONTEXT.md` summarizes and links;
`docs/` owns the depth; `README.md` is the user-facing run guide. Don't restate a subsystem
in two files. If you change a subsystem's behavior, update its `docs/` file in the same commit.
