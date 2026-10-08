#!/usr/bin/env python3
"""
Import the staged MoonBoard catalog JSON (catalog-data/*.json) into the Supabase
`public.catalog_problems` table, so every client syncs it down instead of bundling it.

This is the last step of the catalog pipeline:

    fetch_boardsesh.py  ->  catalog-data/*.json  ->  import_catalog.py  ->  Supabase
                                                                            (clients sync+cache)

Each catalog-data file is a {setup, layoutId, angle, source, count, problems[]} object
(see fetch_boardsesh.py). We take layout_id/angle from the file header and each problem's
`id` as the primary key `source_catalog_id`, storing `holds` verbatim in the {c,r,t} shape
the iOS/PWA parsers already expect. The upsert is idempotent — safe to re-run — because
source_catalog_id is a globally-unique natural PK (verified: zero collisions across all
boards/angles).

Writes go through PostgREST with the SERVICE-ROLE key (bypasses RLS; never ship this key
in a client). It is required — the anon key can only read.

Environment
-----------
  SUPABASE_URL               e.g. https://abcdefgh.supabase.co   (no trailing slash)
  SUPABASE_SERVICE_ROLE_KEY  the project's service_role key

Examples
--------
  # everything staged in catalog-data/:
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/import_catalog.py --all

  # one board / angle (matches a single catalog-data file's header):
  python3 scripts/import_catalog.py --layout 7 --angle 40

Note: this upsert only adds/updates — it never tombstones problems that dropped out of
the source set. Reconcile removals separately with prune_catalog_orphans.py (soft-delete),
and roll a bad import back with backup_catalog_problems.py / restore_catalog_problems.py.

Rename guard: before touching a slab, the import checks the staged file for problems that
boardsesh has renamed since the last import (new uuid, same holds as a live row the fetch
no longer returns — see reconcile_catalog_renames.py). Upserting those would duplicate the
problem, so the import REFUSES until reconcile_catalog_renames.py has been run on the file.
--skip-rename-check bypasses it (first import of a brand-new slab has nothing to check).
"""

import argparse
import glob
import json
import os
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reconcile_catalog_renames as renames  # noqa: E402

BATCH_SIZE = 500  # rows per PostgREST upsert request

# The columns we write. Everything else on the row (updated_at, deleted) is
# server-defaulted / trigger-managed.
def _row(problem, layout_id, angle):
    return {
        "source_catalog_id": problem["id"],
        "layout_id": layout_id,
        "angle": angle,
        "name": problem.get("name") or "",
        "grade": problem.get("grade") or "",
        "user_grade": problem.get("userGrade"),
        "setter": (problem.get("setter") or "").strip(),
        "stars": int(problem.get("stars") or 0),
        "repeats": int(problem.get("repeats") or 0),
        "is_benchmark": bool(problem.get("isBenchmark")),
        "method": problem.get("method"),
        "holds": problem.get("holds") or [],
    }


def _upsert(base_url, service_key, rows):
    """Upsert a batch into catalog_problems via PostgREST (merge on the PK)."""
    url = f"{base_url}/rest/v1/catalog_problems"
    body = json.dumps(rows).encode()
    headers = {
        "Content-Type": "application/json",
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        # merge-duplicates = upsert on the primary key (source_catalog_id).
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    req = Request(url, data=body, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=120) as r:
            return r.status
    except HTTPError as e:
        detail = e.read().decode(errors="replace")
        sys.exit(f"Upsert failed ({e.code}): {detail}")


def _catalog_files(out_dir, layout, angle):
    """The catalog-data files to import, filtered by --layout/--angle via each header."""
    selected = []
    for path in sorted(glob.glob(os.path.join(out_dir, "*.json"))):
        with open(path) as f:
            catalog = json.load(f)
        if "problems" not in catalog or "layoutId" not in catalog:
            continue  # not a catalog file
        if layout is not None and catalog.get("layoutId") != layout:
            continue
        if angle is not None and catalog.get("angle") != angle:
            continue
        selected.append((path, catalog))
    return selected


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", type=int, help="single layout id 1-7 (see fetch_boardsesh.py)")
    ap.add_argument("--angle", type=int, choices=(25, 40), help="single angle; default all")
    ap.add_argument("--all", action="store_true", help="every staged catalog-data file")
    ap.add_argument("--dir", default=os.path.join(os.path.dirname(__file__), "..", "catalog-data"))
    ap.add_argument("--skip-rename-check", action="store_true",
                    help="don't refuse on unreconciled renames (safe only for a slab not yet in Supabase)")
    args = ap.parse_args()

    if not args.all and args.layout is None:
        ap.error("pass --all or --layout N")

    base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.")

    out_dir = os.path.abspath(args.dir)
    files = _catalog_files(out_dir, args.layout, args.angle)
    if not files:
        sys.exit(f"No matching catalog files in {out_dir}")

    grand_total = 0
    for path, catalog in files:
        layout_id = catalog["layoutId"]
        angle = catalog["angle"]
        problems = catalog.get("problems") or []
        rows = [_row(p, layout_id, angle) for p in problems if p.get("id")]
        print(f"{os.path.basename(path)}: layout {layout_id} @ {angle}° — {len(rows)} problems")

        if not args.skip_rename_check:
            # Detect with the broadest evidence rule; an operator decides what to trust, the
            # import only refuses to make duplicates. Runs on a copy — nothing is remapped here.
            live = renames.live_rows(base_url, service_key, layout_id, angle)
            remapped, unresolved = renames.reconcile(
                [dict(p) for p in problems], live, trust_repeats=True)
            if remapped or unresolved:
                sys.exit(f"Refusing to import {os.path.basename(path)}: {len(remapped)} renamed and "
                         f"{len(unresolved)} unresolved problem(s) would be duplicated. Run\n"
                         f"  python3 scripts/reconcile_catalog_renames.py --layout {layout_id} --angle {angle}\n"
                         f"first (see docs/catalog-data-pipeline.md), or --skip-rename-check for a new slab.")

        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i + BATCH_SIZE]
            _upsert(base_url, service_key, batch)
            print(f"    upserted {min(i + BATCH_SIZE, len(rows))}/{len(rows)}")
        grand_total += len(rows)

    print(f"\nDone. Upserted {grand_total} catalog problems across {len(files)} slab(s).")


if __name__ == "__main__":
    main()
