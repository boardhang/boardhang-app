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
- Same-day merge only applies to un-sent attempts; explicit sends always create a new row.
- Ascents are denormalized on purpose — don't "normalize" by joining to `Problem`.
