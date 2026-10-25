#!/usr/bin/env python3
"""
Restore `public.catalog_problems` from a backup_catalog_problems.py dump — the ROLLBACK for
a bad import_catalog.py apply.

    fetch -> merge -> catalog-data/*.json -> [backup] -> import --apply -> prod
                                                 |                          |
                                        restore_catalog_problems.py  <--  (rollback)

Upserts every row of the dump verbatim on the primary key (source_catalog_id) in batches of
500 with the catalog_lib.ROW_COLUMNS whitelist: `deleted` INCLUDED, so a row the apply
un-deleted is tombstoned again and a row it changed gets its old values back; `updated_at`
EXCLUDED, so the server trigger re-stamps it and clients re-sync the restored state.

That alone cannot undo rows the apply INSERTED (a restore is roll-back-to-snapshot for the
rows the dump holds, not a table replace). For those, add the slab-scoped flag:

    --tombstone-absent --layout N --angle A

which, after the restore, tombstones (PATCH deleted=true) every LIVE row of that one slab
whose id is absent from the backup. Rows in other slabs and rows already tombstoned are never
touched; the flag refuses without both --layout and --angle; without the flag nothing is
tombstoned.

THIS IS THE ONLY CODE PATH IN THE REPO THAT WRITES `deleted: true`, and it exists for rollback
only (plan KTD5 / R25). The fetch, merge and import never tombstone or delete a row (R11):
tombstones are the one removal mechanism clients understand, and we only create them to undo an
apply.

Environment: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (writes need the service-role key).

Usage
-----
  python3 scripts/restore_catalog_problems.py catalog_problems_backup_<ts>.json
  python3 scripts/restore_catalog_problems.py catalog_problems_backup_<ts>.json \\
      --tombstone-absent --layout 3 --angle 40
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_lib as lib  # noqa: E402

BATCH = 500             # rows per restore upsert
TOMBSTONE_BATCH = 200   # ids per PATCH `in.()` filter (kept well under URL length limits)


def absent_from_backup(backup_rows, live_slab_rows, layout, angle):
    """Ids of LIVE (not tombstoned) rows in slab (layout, angle) that the backup does not hold,
    sorted and unique. Pure — no I/O. Rows of other slabs and tombstoned rows are never returned."""
    backed_up = {r["source_catalog_id"] for r in backup_rows if r.get("source_catalog_id")}
    return sorted({r["source_catalog_id"] for r in live_slab_rows
                   if (r.get("layout_id"), r.get("angle")) == (layout, angle)
                   and not r.get("deleted") and r["source_catalog_id"] not in backed_up})


def tombstone(base_url, key, ids):
    """PATCH deleted=true over `in.()` batches. The rollback-only tombstone write (see docstring)."""
    bad = [x for x in ids if not lib.ID_RE.match(x)]
    if bad:
        sys.exit(f"Refusing to tombstone: {len(bad)} id(s) are not plain id strings, e.g. {bad[0]!r}")
    for i in range(0, len(ids), TOMBSTONE_BATCH):
        chunk = ids[i:i + TOMBSTONE_BATCH]
        in_list = ",".join(f'"{x}"' for x in chunk)
        url = f"{base_url}/rest/v1/catalog_problems?source_catalog_id=in.({in_list})"
        lib.sb_request(url, key, method="PATCH", body={"deleted": True}, prefer="return=minimal")
        print(f"    tombstoned {min(i + TOMBSTONE_BATCH, len(ids))}/{len(ids)}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Restore catalog_problems from a backup dump (rollback).")
    ap.add_argument("backup", help="a backup_catalog_problems.py dump")
    ap.add_argument("--tombstone-absent", action="store_true",
                    help="after restoring, tombstone live rows of ONE slab that are absent from the backup "
                         "(rolls back rows an apply inserted); needs --layout and --angle")
    ap.add_argument("--layout", type=int, help="slab for --tombstone-absent")
    ap.add_argument("--angle", type=int, choices=(25, 40), help="slab for --tombstone-absent")
    args = ap.parse_args(argv)
    if args.tombstone_absent and (args.layout is None or args.angle is None):
        ap.error("--tombstone-absent needs both --layout N and --angle A (it is slab-scoped)")

    base_url, key, _ = lib.read_credentials(require_service_role=True)

    with open(args.backup, encoding="utf-8") as f:
        dump = json.load(f)
    src = dump.get("rows") if isinstance(dump, dict) else None
    if not isinstance(src, list):
        sys.exit("Not a backup_catalog_problems.py dump (no `rows` array).")
    rows = [{c: r.get(c) for c in lib.ROW_COLUMNS} for r in src if r.get("source_catalog_id")]
    print(f"Restoring {len(rows)} rows from {os.path.basename(args.backup)} (deleted flags included)…")
    for i in range(0, len(rows), BATCH):
        lib.sb_upsert(base_url, key, rows[i:i + BATCH])
        print(f"  restored {min(i + BATCH, len(rows))}/{len(rows)}")
    print(f"Restored {len(rows)} rows (updated_at re-stamped by the trigger).")

    if not args.tombstone_absent:
        print("\nDone. Nothing tombstoned (rows absent from the backup are untouched; "
              "--tombstone-absent --layout N --angle A rolls back inserted rows of one slab).")
        return

    layout, angle = args.layout, args.angle
    live = lib.live_rows(base_url, key, layout, angle)
    ids = absent_from_backup(src, live, layout, angle)
    print(f"\nlayout {layout} @ {angle}°: {len(ids)} live row(s) absent from the backup will be tombstoned")
    for pid in ids:
        print(f"    {pid}")
    if ids:
        tombstone(base_url, key, ids)
    print(f"\nDone. Tombstoned {len(ids)} row(s) in layout {layout} @ {angle}°; other slabs untouched.")


if __name__ == "__main__":
    main()
