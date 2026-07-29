# Data Model & Ascent Logging Lifecycle

The SwiftData persistence layer and how tries/ascents get logged, merged, and rolled up into the
logbook and grade pyramid.

**Key files:** `MoonBoardLED/Models/Ascent.swift`, `Problem.swift`, `HoldType.swift`,
`AppAppearance.swift`, `MoonBoardApp.swift` (container), and the logging UI in
`ProblemDetailView.swift`, `CatalogProblemDetailView.swift` (`CatalogProblemPager`),
`LogAscentSheet.swift`, `TryStepper.swift`, plus `LogbookView.swift` / `GradePyramidView.swift`.

## SwiftData models

The `ModelContainer` (in `MoonBoardApp.swift`) is created with **three** `@Model` types and **no
explicit `ModelConfiguration` and no migration plan**:

```swift
.modelContainer(for: [Problem.self, Ascent.self, FavoriteProblem.self])
```

### `Ascent`

One logged tick or attempt. Fields:

| Field | Notes |
| --- | --- |
| `id: UUID` | unique |
| `date: Date` | when it happened; day-of drives same-day merge & session grouping |
| `sourceCatalogID: String?` | catalog problem id, or **nil** for user-created problems |
| `problemName: String` | denormalized snapshot — survives deletion of the source problem |
| `problemGrade: String` | consensus grade at log time |
| `votedGrade: String` | climber's grade vote (defaults to `problemGrade`) |
| `tries: Int` | ≥1; `tries == 1` is a flash |
| `stars: Int` | 0–5; 0 = unrated |
| `comment: String` | defaults to `""`, never nil |
| `sent: Bool = true` | **send vs. attempts-only** (see below) |
| `boardLayoutId: Int = 7` | board layout id; default 7 (Mini 2025) backfills legacy ascents |

The model is deliberately **denormalized** — name/grade/catalog id are snapshots so an ascent
stays meaningful after the source problem changes or is deleted.

`sent` semantics:
- `sent == true` → counts as a completion, appears in the grade pyramid, `votedGrade` is meaningful.
- `sent == false` → attempts-only; shows in the logbook but excluded from the pyramid and completion
  credit, and `votedGrade` is forced to `problemGrade`.

### `Problem` (user-created)

`{ name, grade, createdAt, holds: [HoldAssignment] }`. `holds` is a `Codable` array persisted
inline. User-created problems live only on the Mini 2025 board, so there's no `boardLayoutId` here.

### `FavoriteProblem`

`{ catalogID: String (unique) }` — bookmarks a read-only catalog problem.

### Supporting Codable types (not `@Model`)

- `HoldAssignment` = `{ col, row, type }` (see [board-geometry.md](board-geometry.md)).
- `HoldType` enum (`start/left/right/match/end`), stored as its **String raw value**. Maps to BLE
  protocol letters and marker colors. `displayed(showBeta:)` collapses non-primary roles for display.
- `AppAppearance` enum, stored as a String raw value in `@AppStorage`.

## The logging lifecycle

There are two entry points that share the same shape: a **pending try counter** (`TryStepper`) that
gets flushed to an attempts-only `Ascent`, plus an explicit **"Log ascent"** path via
`LogAscentSheet` that writes a `sent == true` ascent.

### Pending tries + same-day merge

`TryStepper` mutates a `pendingTries` `@State` (no persistence yet). On the view leaving / problem
change, `flushPending()` runs:

1. Look for **today's un-sent attempt** for the same problem — `todaysAttempt()` matches on
   (`sent == false`) AND same calendar day AND same identity:
   - user problems: same `problemName`;
   - catalog problems: same `sourceCatalogID`.
2. If found → **increment** its `tries` (merge). Else → **insert** a new `Ascent` with
   `sent = false` and the resolved `boardLayoutId`.

This is why tapping the stepper across a session produces **one merged attempts row per day**, not
a pile of duplicates. Explicit sends (`sent == true`) are **never** merged — each is a new row.

- `ProblemDetailView` (user problems): flushes `onDisappear`; new ascents get `sourceCatalogID = nil`,
  `boardLayoutId = board.id` (7).
- `CatalogProblemPager` (catalog problems): flushes on swipe-to-next-problem and `onDisappear`; new
  ascents get `sourceCatalogID = problem.id`, `boardLayoutId = board.id`.

### Explicit "Log ascent" (`LogAscentSheet`)

Opens prefilled with `tries: max(pending, 1)` and `sent: true`; captures `votedGrade`, `stars`,
`comment`, `date`. Supports both create (nil ascent) and edit (mutate existing) modes. When
`sent == false`, it forces `votedGrade = problemGrade`.

### Web: a send absorbs the day's attempt row

The web client (`web/src/logbook/LogAscentSheet.tsx` + `catalog/ProblemDetail.tsx`) folds the
day's tries into an explicit send instead of leaving two rows for the day:

- "Log ascent" seeds the sheet's tries with *(today's unsent-attempt tries) + (pending stepper
  tries) + 1* — the stepper counts **failed** goes; the `+1` is the successful one. The sheet
  shows the breakdown ("N tries from earlier today **+ this send**" / "Tried on N earlier days"),
  so the auto-added send is explicit and the seeded total never reads as a silent off-by-one.
- On save, the send row carries the total and today's unsent attempt row is **soft-deleted**
  (`LogTarget.absorb`), so a day of tries + a send lands as **one** logbook entry.
- **Only while the send stays dated today.** Re-dating the send off today unfolds the absorb:
  the day's earlier tries belong to *today*, not the backdated send, so the send drops back to
  its own tries (`tries − earlierTriesToday`) and today's persisted attempt row is left in place.
  The never-persisted inline-stepper tries aren't written by the sheet — instead it returns
  `onSaved({ keptTodayTries: true })` so the caller (`ProblemDetail`) *keeps* its pending stepper,
  and its own deferred leave-flush persists them onto today's attempt row reliably (no fragile
  best-effort write that could silently drop them). The sheet reflects the unfold live — the
  count and Flash label update, the "+ this send" line hides, and a note says "Today's N tries
  stay as a separate entry". This is what keeps a backdated send from double-counting the day.
- Attempt rows from earlier days are untouched history — a send never rewrites a past day.
  Tries logged *after* a send revive a fresh attempt row for that day (deterministic-id
  semantics), which then shows as its own entry.
- A problem **already sent today** (local day) asks before logging more — both "Log
  ascent" and the *first* tap of the inline try stepper open a confirm dialog ("Already
  sent today …"), so a duplicate same-day send or a post-send attempt row is always
  deliberate, never a mis-tap. Once confirmed, further stepper taps flow freely.

The iOS app is **on hold** and does not absorb — it writes the send alongside the day's
attempt row, and its accumulate-flush trusts its local row copy. The web side guards its
half (the flush reads the server row's `tries`/`deleted` before accumulating —
`addAttemptTries`; the absorb delete only fires while the row still holds the folded
tries — `absorbAttemptRow`). These guards matter even web-only (two open tabs recreate
the same races); if iOS development resumes, it must mirror them before cross-device
same-day logging is safe.

### Flash vs Session flash (web)

"Flash" is reserved for problems with **no logged history at all**. A one-try send on a problem
with any earlier-dated row (attempts *or* sends) is labeled **"Session flash"** — both in the
log sheet's tries stepper and on the logbook row badge (`triesLabel` in `tryBucket.ts`, history
derived in `problemHistory.ts`). A lone unsent attempt still reads "1 try", never a flash. The
grade pyramid is unchanged: it buckets by the row's tries count, so a session flash still lands
in the flash bucket.

## User-authored problems (`public.user_problems`)

The cloud table behind web problem authoring. It predates authoring — `0002` created it for the
iOS logbook sync — and migrations `0018`/`0019` extended it rather than forking a second table, so
it keeps the same sync spine (client-generated uuid PK, `holds` jsonb, `updated_at` + `deleted`,
the owner-only RLS quartet, cascade from `auth.users`).

**One text id lane.** `source_catalog_id` is `GENERATED ALWAYS AS ('user:' || id) STORED`. Every
downstream surface — `ascents.source_catalog_id`, session queues, `sessions.lit_problem_id`, the
client's `getCatalogProblemsByIds` — already stores a bare text problem id, so a user problem joins
that lane instead of forcing dual-lane handling everywhere. The `user:` prefix cannot collide with
the UUIDv5 catalog ids, and the whole value is 41 characters (inside the 64-char `lit_problem_id`
cap from `0017`). Being generated, it can never drift from the PK, and PostgREST treats it as
read-only — a write payload that includes it fails outright.

**Visibility lifecycle.** `visibility` is `'private'` (default) or `'public'`, and everything
hangs off the predicate **live public** = `visibility = 'public' and not deleted`:

- Publishing (an INSERT or, normally, a private→public UPDATE) runs the `0019` stamp trigger,
  which sets `setter_user_id = auth.uid()` and `setter_handle` from the caller's own profile, and
  **refuses the write** when that profile or its handle is missing. The client's "pick a handle
  first" prompt is a convenience; this is the enforcement.
- A public-completeness `CHECK` demands `layout_id`, `angle`, a non-empty `name` of ≤60 chars, both
  attribution columns, and a `holds` array of 1–60 `{c,r,t}` objects (in-range coordinates, a known
  role, no extra keys). Private rows and tombstones are exempt, which is what keeps the iOS-era rows
  (empty name, null layout/angle, `'[]'` holds) legal.
- Going private again or tombstoning **clears** both attribution columns — they are server-owned,
  so the server stops standing behind them. Renaming a profile handle re-stamps every live public
  row that setter owns, so credit can never point at a handle somebody else has since claimed.
- A per-user cap of **50 live public rows** fires on INSERT *or* UPDATE under a per-user advisory
  lock. It is a ceiling on live rows, not a lifetime quota: retracting or deleting frees a slot.

**Two sync lanes, and what "absent" means.** The PWA caches these rows in their own IndexedDB
database (`moonboard-user-problems`), fed by two lanes that never touch the same rows: own rows
arrive as an `updated_at` cursor delta *with* tombstones; other setters' public rows arrive as a
full per-slab snapshot in which **absence is retraction**. One rule therefore covers retraction,
deletion, account deletion and re-publishing. Own rows are fenced out of the snapshot entirely — a
private row is absent from a public snapshot by definition, so evicting on absence would delete the
author's own work — and a *failed* pull evicts nothing at all. Sign-out clears own rows and the
cursor; cached rows belonging to other setters are public by definition and stay, so a shared board
keeps browsing. See [catalog-data-pipeline.md](catalog-data-pipeline.md) for the merge into the
catalog read path.

**Ascent history is independent of the problem.** An `Ascent` snapshots `problemName` /
`problemGrade` and stores only the text id, so editing a user problem's name, grade or holds — or
deleting it outright — leaves the logbook rows intact and still readable. Detail views that can no
longer resolve the id simply render from the snapshot.

**Known quirk — the iOS ascent lane.** `ascents` can reference a user problem two ways: the text
`source_catalog_id` (what the web writes: `user:<uuid>`) or the uuid FK `user_problem_id` (what the
dormant iOS app writes). They are not reconciled. In practice nothing is broken, because the
problems iOS authored have a null `layout_id` and so never surface on the web at all; but if iOS
development resumes, or those legacy problems are ever backfilled with a board, their web logbook
would read as empty until the two lanes are joined. Recorded, accepted, not fixed.

## Logbook & grade pyramid

- **Logbook** (`LogbookView`) filters ascents by `effectiveBoardLayoutId` (not the raw
  `boardLayoutId`) against the `BoardFilter` CSV — see [multi-board-model.md](multi-board-model.md).
- **Grade pyramid** (`GradePyramidView`) includes only `sent == true` ascents, de-dupes to one
  ascent per distinct problem (earliest send kept, keyed by `sourceCatalogID` or `problemName`),
  groups by `problemGrade` (consensus, not the vote), and stacks by try bucket (flash / 2nd / 3rd /
  4+, see `TryBadge.swift`).

## Settings live in `@AppStorage`, not SwiftData

All preferences use `@AppStorage`/UserDefaults, several as `"|"`-joined CSV. The full key catalog is
in [navigation-and-ui-flows.md](navigation-and-ui-flows.md); board-scoped keys are in
[multi-board-model.md](multi-board-model.md).

## Gotchas summary

- **No migration plan.** Renaming a `HoldType` case (or any stored enum raw value / model field)
  can cause a fatal `DecodingError` on launch — a migration shim was deliberately removed. Treat
  stored raw values as a wire format.
- `boardLayoutId` defaults to 7 to backfill pre-multi-board ascents; resolve board via
  `effectiveBoardLayoutId`.
- `sent == false` rows are attempts-only: excluded from the pyramid, `votedGrade` ignored.
- Same-day merge only applies to un-sent attempts; explicit sends always create a new row —
  but on **web** a send also absorbs (soft-deletes) today's attempt row after folding its
  tries in (see "Web: a send absorbs the day's attempt row").
- Ascents are denormalized on purpose — don't "normalize" by joining to `Problem`. That's also
  what lets an ascent outlive an edit or a delete of the user problem it points at.
- `user_problems.source_catalog_id` and `setter_user_id`/`setter_handle` are server-owned
  (generated column / trigger-stamped). Read them; never put them in a write payload.
- In the public snapshot lane, **absence means retracted** — so never evict on a pull that failed,
  and never let the snapshot touch the caller's own rows.
