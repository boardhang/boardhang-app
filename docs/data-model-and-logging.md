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
  shows the breakdown ("Includes N tries from earlier today" / "Tried on N earlier days").
- On save, the send row carries the total and today's unsent attempt row is **soft-deleted**
  (`LogTarget.absorb`), so a day of tries + a send lands as **one** logbook entry.
- Attempt rows from earlier days are untouched history — a send never rewrites a past day.
  Tries logged *after* a send revive a fresh attempt row for that day (deterministic-id
  semantics), which then shows as its own entry.
- A problem **already sent today** (local day) asks before logging more — both "Log
  ascent" and the *first* tap of the inline try stepper open a confirm dialog ("Already
  sent today …"), so a duplicate same-day send or a post-send attempt row is always
  deliberate, never a mis-tap. Once confirmed, further stepper taps flow freely.

iOS does not absorb yet — it still writes the send alongside the day's attempt row.

### Flash vs Session flash (web)

"Flash" is reserved for problems with **no logged history at all**. A one-try send on a problem
with any earlier-dated row (attempts *or* sends) is labeled **"Session flash"** — both in the
log sheet's tries stepper and on the logbook row badge (`triesLabel` in `tryBucket.ts`, history
derived in `problemHistory.ts`). A lone unsent attempt still reads "1 try", never a flash. The
grade pyramid is unchanged: it buckets by the row's tries count, so a session flash still lands
in the flash bucket.

## Logbook & grade pyramid

- **Logbook** (`LogbookView`) filters ascents by `effectiveBoardLayoutId` (not the raw
  `boardLayoutId`) against the `BoardFilter` CSV — see [multi-board-model.md](multi-board-model.md).
  The web logbook adds a compact filter row below the pyramid, mirroring the catalog's
  pill-bar idiom: a "Filters" opener → bottom sheet (inline range calendar over local days,
  inclusive; grade-range slider spanning the grades actually logged), with one removable
  chip per active filter. Filters narrow only the session list — the pyramid always shows
  the full board history (`LogbookScreen.tsx`; `filterByDayRange`, `filterByGradeRange`,
  `loggedGradeSpan` in `sessions.ts`). Session-flash badges likewise derive from the full
  history, not the filtered view.
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
- Ascents are denormalized on purpose — don't "normalize" by joining to `Problem`.
