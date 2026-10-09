#!/usr/bin/env python3
"""
Deploy the canonical catalog snapshots (catalog-data/<slug>_<angle>.json) to Supabase
`public.catalog_problems` — the third step of the pipeline:

    fetch_boardsesh.py  ->  merge_catalog.py  ->  catalog-data/*.json  ->  import_catalog.py  ->  prod
                                                  (CANONICAL, committed)                        (a deployment of it)

The snapshot is the source of truth and prod is a deployment of it. The import is
DIFF-ONLY: it pages every live row of the slab (tombstones included), normalizes both sides
with the shared row mapper (catalog_lib.row_from_problem / row_from_live) and classifies each
snapshot problem as

    insert     id not in prod
    update     live, not tombstoned, and some uploaded column differs
    undelete   live but tombstoned — written with deleted=false (a write even if nothing else differs)
    unchanged  identical in every ROW_COLUMNS column, `deleted` included

Only inserts, updates and undeletes are written, so untouched rows are never re-stamped: the
`updated_at` trigger has no change guard, and a blind upsert would make every client
re-download every slab. Live rows the snapshot lacks are ORPHANS: the import refuses on them
by default (--allow-orphans to proceed) and never writes to them. Tombstoned rows absent from
the snapshot are ignored (the three legacy tombstones live there on purpose).

This script NEVER deletes or tombstones a row (R11). Every row it writes carries
`deleted: false`. The only code path in the repo that writes `deleted: true` is the rollback
flag of restore_catalog_problems.py.

Guards, all checked for EVERY selected slab before anything is written:
  * orphans (above) unless --allow-orphans;
  * retired ids — any snapshot id listed in catalog-data/overrides.json `retired_ids` (ids
    tombstoned in prod that no snapshot may hold) is reported as a retired-id hit;
  * cross-slab ids — every insert and undelete is looked up in prod across ALL slabs,
    tombstones included; an id that exists under a different (layout_id, angle) refuses the
    import, naming both slabs. An upsert payload carries the slab columns, so this is the one
    thing stopping a write from moving a row between slabs;
  * id safety — every id must match catalog_lib.ID_RE before it reaches a PostgREST filter.

The dry run (the default) prints per-class counts, a sample of each class, EVERY undelete by
id, the orphan list, the retired-id hits, and the predicted benchmark banner events: an upper
bound equal to inserted benchmarks plus every written row whose is_benchmark goes false ->
true (migration 0018 fires on INSERT when new.is_benchmark and on UPDATE only on that rising
edge; a true -> true write fires nothing). It ends with one summary line per slab, e.g.

    moonboard2024_40.json: 0 inserts, 0 updates, 0 undeletes, 0 orphans, 0 retired-id hits, 0 predicted events, 0 cross-slab hits

When any guard would refuse the apply, the dry run says so and exits non-zero too, so the exit
code alone tells you whether the apply would go through.

Operator runbook (docs/catalog-data-pipeline.md)
------------------------------------------------
  1. python3 scripts/backup_catalog_problems.py                       # rollback point FIRST
  2. python3 scripts/import_catalog.py --layout 3 --angle 40          # dry run
     check the undelete list and the predicted event count
  3. python3 scripts/import_catalog.py --layout 3 --angle 40 --apply

--apply writes inserts, then updates, then undeletes, in batches of at most 500 rows through
one upsert per batch with exactly the ROW_COLUMNS whitelist, and stops on the first HTTP error
(each batch is its own transaction; a later batch is never sent after a failure).
  * Stopped partway? Re-run the same command: rows already written now diff as unchanged, so
    the re-run writes only what is left. The apply is idempotent.
  * Wrong rows applied? Restore the backup (restore_catalog_problems.py <dump>) to roll back
    updates and undeletes, and add its `--tombstone-absent --layout N --angle A` flag to
    tombstone the rows this apply INSERTED into that slab.
  * Banner events fired by inserted benchmarks (benchmark_events) have no drain: retract one
    by hand in SQL by setting its `discarded_at` (migration 0018's retraction contract).

Credentials: a dry run reads with SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY (the table is
public-read); --apply refuses without the service-role key.

Examples
--------
  python3 scripts/import_catalog.py --all                       # dry run, every slab
  python3 scripts/import_catalog.py --layout 7 --angle 40       # dry run, one slab
  python3 scripts/import_catalog.py --layout 7 --angle 40 --apply
"""

import argparse
import os
import sys
from dataclasses import dataclass, field

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_lib as lib  # noqa: E402

BATCH_SIZE = 500     # rows per upsert request
LOOKUP_BATCH = 100   # ids per cross-slab `in.()` lookup (kept well under URL length limits)
SAMPLE = 5           # rows shown per class in the report
ORPHAN_SAMPLE = 20   # orphans listed before "… and N more"


@dataclass
class Plan:
    """What an apply would write for one slab. Row lists hold normalized rows (ROW_COLUMNS)."""
    inserts: list = field(default_factory=list)
    updates: list = field(default_factory=list)
    undeletes: list = field(default_factory=list)
    unchanged: list = field(default_factory=list)
    orphans: list = field(default_factory=list)      # live, not tombstoned, absent from the snapshot
    predicted_events: int = 0                        # upper bound on benchmark banner events

    @property
    def writes(self):
        """Rows in apply order: inserts, then updates, then undeletes."""
        return self.inserts + self.updates + self.undeletes


def classify(snapshot_rows, live_rows):
    """Diff a slab: normalized snapshot rows against normalized live rows (tombstones included).

    Pure — no I/O. Compares every ROW_COLUMNS column including `deleted`. Every row placed in
    a write class carries deleted=False. Tombstoned live rows absent from the snapshot are
    ignored, never orphans.
    """
    plan = Plan()
    live_by_id = {r["source_catalog_id"]: r for r in live_rows}
    snapshot_ids = set()
    for row in snapshot_rows:
        row = {**row, "deleted": False}
        pid = row["source_catalog_id"]
        snapshot_ids.add(pid)
        live = live_by_id.get(pid)
        if live is None:
            plan.inserts.append(row)
            if row["is_benchmark"]:
                plan.predicted_events += 1
            continue
        if live["deleted"]:
            plan.undeletes.append(row)
        elif any(row[c] != live[c] for c in lib.ROW_COLUMNS):
            plan.updates.append(row)
        else:
            plan.unchanged.append(row)
            continue
        if row["is_benchmark"] and not live["is_benchmark"]:
            plan.predicted_events += 1  # rising edge: the UPDATE trigger fires
    plan.orphans = [r for r in live_rows if not r["deleted"] and r["source_catalog_id"] not in snapshot_ids]
    return plan


def cross_slab_hits(base_url, key, ids, layout, angle):
    """Rows in prod, any slab and tombstones included, whose id is in `ids` but whose
    (layout_id, angle) is not this slab → [(id, layout_id, angle, deleted)]. Batched `in.()`
    GETs; every id must already pass ID_RE."""
    hits = []
    ids = sorted(set(ids))
    for i in range(0, len(ids), LOOKUP_BATCH):
        chunk = ids[i:i + LOOKUP_BATCH]
        in_list = ",".join(f'"{x}"' for x in chunk)
        url = (f"{base_url}/rest/v1/catalog_problems?select=source_catalog_id,layout_id,angle,deleted"
               f"&source_catalog_id=in.({in_list})")
        rows, _ = lib.sb_request(url, key)
        for r in rows or []:
            if (r["layout_id"], r["angle"]) != (layout, angle):
                hits.append((r["source_catalog_id"], r["layout_id"], r["angle"], bool(r.get("deleted"))))
    return hits


def _label(row):
    return f"{row['source_catalog_id']}  {row.get('name') or ''}".rstrip()


def _print_class(title, rows):
    print(f"  {len(rows)} {title}")
    for r in rows[:SAMPLE]:
        print(f"      {_label(r)}")
    if len(rows) > SAMPLE:
        print(f"      … and {len(rows) - SAMPLE} more")


def report_slab(name, layout, angle, plan, retired_hits, cross_hits):
    print(f"\n{name}: layout {layout} @ {angle}°")
    _print_class("inserts", plan.inserts)
    _print_class("updates", plan.updates)
    print(f"  {len(plan.undeletes)} undeletes (every one, sent with deleted=false)")
    for r in plan.undeletes:
        print(f"      {_label(r)}")
    print(f"  {len(plan.unchanged)} unchanged")
    print(f"  {len(plan.orphans)} orphans (live in prod, absent from the snapshot — never written)")
    for r in plan.orphans[:ORPHAN_SAMPLE]:
        print(f"      {_label(r)}")
    if len(plan.orphans) > ORPHAN_SAMPLE:
        print(f"      … and {len(plan.orphans) - ORPHAN_SAMPLE} more")
    print(f"  {len(retired_hits)} retired-id hits (snapshot ids listed in overrides.json retired_ids)")
    for pid in retired_hits:
        print(f"      {pid}")
    print(f"  {len(cross_hits)} cross-slab hits (insert/undelete ids that exist under another slab)")
    for pid, other_layout, other_angle, deleted in cross_hits:
        state = "tombstoned" if deleted else "live"
        print(f"      {pid}: snapshot says layout {layout} @ {angle}°, prod has it {state} under "
              f"layout {other_layout} @ {other_angle}°")
    print(f"  {plan.predicted_events} predicted benchmark banner events (upper bound)")


def summary_line(name, plan, retired_hits, cross_hits):
    return (f"{name}: {len(plan.inserts)} inserts, {len(plan.updates)} updates, {len(plan.undeletes)} undeletes, "
            f"{len(plan.orphans)} orphans, {len(retired_hits)} retired-id hits, "
            f"{plan.predicted_events} predicted events, {len(cross_hits)} cross-slab hits")


def apply_slab(base_url, key, name, plan):
    """Write inserts, then updates, then undeletes in batches of BATCH_SIZE. lib.sb_request
    exits the process on a non-transient HTTP error, so a later batch is never sent."""
    total = len(plan.writes)
    if not total:
        print(f"{name}: nothing to write")
        return 0
    print(f"{name}: writing {total} rows ({len(plan.inserts)} inserts, {len(plan.updates)} updates, "
          f"{len(plan.undeletes)} undeletes)")
    for title, batch_rows in (("inserts", plan.inserts), ("updates", plan.updates), ("undeletes", plan.undeletes)):
        rows = [{c: r[c] for c in lib.ROW_COLUMNS} for r in batch_rows]
        for i in range(0, len(rows), BATCH_SIZE):
            lib.sb_upsert(base_url, key, rows[i:i + BATCH_SIZE])
            print(f"    {title}: {min(i + BATCH_SIZE, len(rows))}/{len(rows)}")
    return total


def main(argv=None):
    ap = argparse.ArgumentParser(description="Diff-only deploy of the catalog snapshots to Supabase.")
    ap.add_argument("--layout", type=int, help="single layout id 1-7 (see catalog_lib.BOARDS)")
    ap.add_argument("--angle", type=int, choices=(25, 40), help="single angle; default both")
    ap.add_argument("--all", action="store_true", help="every snapshot in --dir")
    ap.add_argument("--dir", default=lib.DATA_DIR, help="snapshot directory (default catalog-data/)")
    ap.add_argument("--apply", action="store_true", help="write the diff (default: DRY RUN)")
    ap.add_argument("--allow-orphans", action="store_true",
                    help="proceed although prod holds live rows the snapshot lacks (they are never written)")
    args = ap.parse_args(argv)
    if not args.all and args.layout is None:
        ap.error("pass --all or --layout N")

    base_url, key, _ = lib.read_credentials(require_service_role=args.apply)
    data_dir = os.path.abspath(args.dir)
    files = lib.snapshot_files(data_dir, args.layout, args.angle)
    if not files:
        sys.exit(f"No matching snapshot files in {data_dir}")
    overrides = lib.load_overrides(lib.overrides_path(data_dir))

    print("DRY RUN — nothing will be written (pass --apply to write)." if not args.apply
          else "APPLY — checking every slab before writing anything.")

    plans, summaries, blockers = [], [], []
    for path, snapshot in files:
        name = os.path.basename(path)
        layout, angle = snapshot["layoutId"], snapshot["angle"]
        problems = [p for p in snapshot.get("problems") or [] if p.get("id")]
        bad = [p["id"] for p in problems if not lib.ID_RE.match(str(p["id"]))]
        if bad:
            sys.exit(f"{name}: {len(bad)} id(s) are not plain id strings, e.g. {bad[0]!r}; refusing to build a filter")
        seen, dupes = set(), set()
        for p in problems:
            (dupes if p["id"] in seen else seen).add(p["id"])
        if dupes:
            sys.exit(f"{name}: duplicate ids in the snapshot, e.g. {sorted(dupes)[0]!r}")

        snapshot_rows = [lib.row_from_problem(p, layout, angle) for p in problems]
        live = [lib.row_from_live(r) for r in lib.live_rows(base_url, key, layout, angle)]
        plan = classify(snapshot_rows, live)
        retired_hits = sorted(pid for pid in seen if pid in overrides.retired_ids)
        cross_hits = cross_slab_hits(base_url, key, [r["source_catalog_id"] for r in plan.inserts + plan.undeletes],
                                     layout, angle)
        report_slab(name, layout, angle, plan, retired_hits, cross_hits)
        summaries.append(summary_line(name, plan, retired_hits, cross_hits))
        plans.append((name, plan))

        if plan.orphans and not args.allow_orphans:
            blockers.append(f"{name}: {len(plan.orphans)} live row(s) in prod are absent from the snapshot "
                            f"(--allow-orphans to proceed; they are never written either way)")
        if retired_hits:
            blockers.append(f"{name}: {len(retired_hits)} snapshot id(s) are retired (overrides.json retired_ids): "
                            f"{', '.join(retired_hits[:SAMPLE])}")
        if cross_hits:
            blockers.append(f"{name}: {len(cross_hits)} insert/undelete id(s) exist in prod under another slab "
                            f"(see the cross-slab hits above)")

    print("\nSummary")
    for line in summaries:
        print(f"  {line}")

    if blockers:
        print("\nREFUSING — the apply would not go through:" if not args.apply else "\nREFUSING — nothing written:")
        for b in blockers:
            print(f"  {b}")
        sys.exit(1)

    if not args.apply:
        total = sum(len(p.writes) for _, p in plans)
        print(f"\nDry run complete: {total} row(s) would be written across {len(plans)} slab(s). "
              f"Back up first (backup_catalog_problems.py), then re-run with --apply.")
        return

    print()
    written = 0
    for name, plan in plans:
        written += apply_slab(base_url, key, name, plan)
    print(f"\nDone. Wrote {written} row(s) across {len(plans)} slab(s); nothing was deleted or tombstoned.")
    print("If a run ever stops partway: re-run the same command — written rows now diff as unchanged, "
          "so only the rest is sent. Rollback: restore the backup; add --tombstone-absent --layout N --angle A "
          "to tombstone rows this apply inserted.")


if __name__ == "__main__":
    main()
