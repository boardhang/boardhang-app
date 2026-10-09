#!/usr/bin/env python3
"""
Seed the canonical catalog snapshots (catalog-data/<slug>_<angle>.json) by exporting the
live `public.catalog_problems` table, one file per (layout, angle) slab.

This is the ONE-TIME step that made git the canonical copy of the catalog and Supabase a
deployment of it (docs/catalog-data-pipeline.md). After it, a refresh is
fetch -> merge -> import and this script is only needed again if the snapshot shape changes
(e.g. the `hold_key` format) and every slab has to be re-exported.

Each live row becomes a snapshot problem with `boardsesh_uuid` equal to its id (the id IS the
upstream uuid the row was first imported under), a computed `hold_key`, and
`upstream_last_seen` null — the seed makes no claim boardsesh did not. Tombstoned rows are
skipped, reported, and their ids written to `retired_ids` in catalog-data/overrides.json so a
later merge refuses to mint them again (KTD6): un-deleting one would show a duplicate beside
its live twin. Existing override `entries` are preserved. The export refuses a slab with zero
live rows and refuses if two slabs hold the same id.

Reads only; the anon key is enough (catalog_problems is public-read). Nothing is written to prod.

Usage
-----
  SUPABASE_URL=… SUPABASE_ANON_KEY=… python3 scripts/export_catalog_snapshots.py             # every slab
  … python3 scripts/export_catalog_snapshots.py --layout 3 --angle 40                      # one slab
"""

import argparse
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_lib as lib  # noqa: E402


def group_by_slab(rows):
    by_slab = defaultdict(list)
    for row in rows:
        by_slab[(row["layout_id"], row["angle"])].append(row)
    return dict(sorted(by_slab.items()))


def check_unique_ids(by_slab):
    """Refuse if one id appears in two slabs — the PK makes this impossible in prod, but a
    hand-edited dump or a future composite key would break every cross-slab rule downstream."""
    seen = {}
    for slab, rows in by_slab.items():
        for row in rows:
            other = seen.setdefault(row["source_catalog_id"], slab)
            if other != slab:
                sys.exit(f"id {row['source_catalog_id']} is in both {other[0]}@{other[1]} and {slab[0]}@{slab[1]}")


def build_snapshot(layout, angle, rows):
    """(snapshot, retired) for one slab: live rows become problems, tombstones are reported."""
    live = [r for r in rows if not r.get("deleted")]
    retired = [(r["source_catalog_id"], r.get("name") or "") for r in rows if r.get("deleted")]
    if not live:
        sys.exit(f"layout {layout} @ {angle}°: no live rows — refusing to write an empty snapshot")
    snapshot = {
        "setup": lib.BOARDS[layout].name,
        "layoutId": layout,
        "angle": angle,
        "source": lib.SOURCE,
        "curation": lib.CURATION,
        "upstream_total": None,
        "count": len(live),
        "problems": [lib.problem_from_live(r) for r in live],
    }
    return snapshot, retired


def write_retired_ids(path, retired_ids):
    """Record the tombstones in the overrides file, keeping any entries already there."""
    existing = lib.load_overrides(path)
    data = {"retired_ids": sorted(retired_ids), "entries": existing.entries}
    lib.write_json_atomic(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--layout", type=int, help="single layout id (see catalog_lib.BOARDS); default every slab")
    ap.add_argument("--angle", type=int, choices=(25, 40), help="single angle (with --layout)")
    ap.add_argument("--dir", default=lib.DATA_DIR, help="snapshot directory (default catalog-data/)")
    args = ap.parse_args()

    base_url, key, _ = lib.read_credentials()
    print("Paging catalog_problems…")
    rows = lib.live_rows(base_url, key, args.layout, args.angle)
    by_slab = group_by_slab(rows)
    if not by_slab:
        sys.exit("No rows — nothing to export.")
    check_unique_ids(by_slab)

    out_dir = os.path.abspath(args.dir)
    os.makedirs(out_dir, exist_ok=True)
    retired_ids = []
    for (layout, angle), slab_rows in by_slab.items():
        snapshot, retired = build_snapshot(layout, angle, slab_rows)
        path = lib.snapshot_path(out_dir, layout, angle)
        lib.write_snapshot(path, snapshot)
        print(f"{os.path.basename(path)}: {snapshot['count']} problems, {len(retired)} tombstone(s) skipped")
        for pid, name in retired:
            print(f"    retired {pid}  {name!r}")
        retired_ids.extend(pid for pid, _ in retired)

    overrides = lib.overrides_path(out_dir)
    write_retired_ids(overrides, retired_ids)
    print(f"\n{len(by_slab)} slab(s), {len(rows)} rows read, {len(retired_ids)} retired id(s) -> {overrides}")


if __name__ == "__main__":
    main()
