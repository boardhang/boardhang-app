---
title: Session "Now on the wall" (lit problem) - Plan
type: feat
date: 2026-07-21
topic: web-session-lit-problem
tier: safety-critical
issue: https://github.com/boardhang/boardhang-app/issues/97
execution: code
---

# Session "Now on the wall" (lit problem) - Plan

## Goal Capsule

- **Objective:** Answer the between-burns question "which one is active?" — store which
  problem was last lit on the board **in the session row** and surface it to every member
  in the session bar, live. (Issue #97.)
- **Execution profile:** Deep, **safety-critical** — creates
  `supabase/migrations/0017_session_lit_problem.sql` (cross-user data path) and touches
  `web/src/ble/useLightUp.ts` (BLE-adjacent). Migration is test-first (RLS harness case);
  review mandatory.
- **Stop conditions:** Surface a blocker instead of guessing if implementation would relax
  the session-membership access boundary, change how `ascents` are recorded, or alter the
  BLE send path's behavior on failure.
- **Tail:** Update `docs/collaboration-sessions.md` in the same change; add a
  `docs/solutions/` entry after merge.

---

## Product Contract

### Summary

When a member lights a catalog problem over BLE while a session for that board is active,
the session records it as the crew's "now on the wall" problem. Every member sees a slim
row in the (sticky) session bar naming the problem and who lit it; tapping it opens the
problem detail. The next light-up overwrites it. Backend-stored (survives reload and is
consistent across devices), pushed over the session's existing realtime channel.

### Requirements

- R1. A session stores at most **one** lit problem (id + who lit it + when) — one physical
  board has one lit problem. A new light-up overwrites the previous value.
- R2. Only a successful BLE send records a lit problem; a failed/cancelled send records
  nothing. Recording is **best-effort and never blocks or fails the BLE path** — a cloud
  error is silent (the pull/reconcile model catches up).
- R3. Only recorded when the active session targets the board being lit; lighting outside
  a session (or on another board's catalog) records nothing.
- R4. Any **member** can set the lit problem; attribution (`lit_by`) is pinned
  server-side to the caller — not spoofable. Non-members cannot read or write it.
- R5. Co-members see the update without a manual refresh (session realtime channel), and
  on the standard pull triggers (activation / foreground / manual refresh).
- R6. The lit row shows the problem name/grade when the id resolves in the local catalog
  cache, a neutral fallback when it doesn't, and the lighter's name from the roster.
  Tapping opens the existing problem-detail drawer; it does **not** re-light the board.
- R7. Recording a lit problem does **not** bump `expires_at` (KTD-6 discipline: the 24h
  privacy backstop must still fire for a crew that only lights and never explicitly
  touches the session). No liveness revival: a dead session refuses the write.

### Acceptance Examples

- AE1. **Given** members A and B in a session for board 7, **when** A lights problem X
  from the detail drawer, **then** B's session bar shows "X · lit by A" without refresh.
- AE2. **Given** the same session, **when** B then lights Y, **then** both bars show Y
  (overwrite; no history).
- AE3. **Given** no active session (or a session for another board), **when** a user
  lights a problem, **then** nothing is written.
- AE4. **Given** the BLE send fails, **then** no lit problem is recorded.
- AE5. **Given** a non-member, **then** they can neither read nor set a session's lit
  problem (RLS + RPC gate).

## Key Technical Decisions

- **KTD1 — columns on `sessions`, not a new table.** `lit_problem_id text`,
  `lit_by uuid` (SET NULL on user delete), `lit_at timestamptz`. One lit problem per
  session is a cardinality fact; a table would re-implement the queue. Length-capped
  (`char_length ≤ 64`) since any member can write it.
- **KTD2 — member-gated SECURITY DEFINER RPC `set_session_lit_problem(p_session_id,
  p_problem_id)`.** `sessions` UPDATE RLS stays **owner-only** (rename/end); members go
  through the RPC, mirroring `touch_session`. Guards: caller membership + liveness in the
  UPDATE's WHERE; `lit_by := auth.uid()`, `lit_at := now()` pinned inside. `null`
  problem id clears all three columns. **No expiry bump** (R7).
- **KTD3 — data-free realtime doorbell.** An AFTER UPDATE trigger on `sessions`, gated
  `WHEN (old.lit_at IS DISTINCT FROM new.lit_at OR old.lit_problem_id IS DISTINCT FROM
  new.lit_problem_id)`, emits `lit-changed` on the existing private `session:<id>`
  channel (reuses 0012's receive policy — no new policy). Clients refetch the lit columns
  through their own RLS select; the payload is never trusted as data (KTD-5 pattern).
- **KTD4 — client write seam in `useLightUp`.** Both light surfaces (detail drawer,
  last-opened bar) share `useLightUp`; its `resetKey` **is** the catalog problem id. After
  a confirmed send it fire-and-forgets `reportProblemLit(board.layoutId, id)`
  (sessionsStore): no-op unless the active session targets that board; optimistic local
  set; silent on cloud error (R2).
- **KTD5 — read model.** `SESSION_COLUMNS` grows the three columns (they are not secrets —
  unlike `invite_token`), so activation/foreground/manual `refreshActiveSession` carries
  them for free; the `lit-changed` nudge triggers a narrow `refreshLitProblem()` select
  (no roster reload per light-up).
- **KTD6 — display in SessionBar's ActiveBar** as a second slim row (name + grade +
  "lit by <member>", Lightbulb icon), resolved via `getCatalogProblemsByIds` (same
  offline-cache idiom as the queue strip). Tap → `onOpenProblem(id)` (default pager
  domain). Rides the sticky header via #98's slot.

## Implementation Units

1. **Migration `0017_session_lit_problem.sql`** — columns + comment, RPC, trigger.
   Statement order: alter table → RPC → trigger.
2. **RLS test `tests/0017_session_lit_problem_rls.sql`** + `run_rls_test.sh` case
   (chain: 0002 → 0007 → stub_realtime → 0017): member sets via RPC (attribution pinned,
   spoof attempt ignored), clear works, non-member refused, dead session refused, direct
   member UPDATE still owner-only, trigger emits exactly one broadcast per change on the
   right topic, no expiry bump.
3. **Types** (`sessionsTypes.ts`): row/domain fields + `SESSION_COLUMNS`.
4. **Store** (`sessionsStore.ts`): `reportProblemLit` (guard + optimistic + RPC),
   `refreshLitProblem` (narrow select/merge).
5. **Realtime** (`sessionRealtime.ts`): `lit-changed` → `refreshLitProblem()`.
6. **`useLightUp`**: post-send report (fire-and-forget, guarded by the existing
   stale-target check).
7. **UI** (`SessionBar.tsx`): the lit row.
8. **Docs**: `docs/collaboration-sessions.md` (model + RPC table + client arch).
