#!/usr/bin/env python3
"""
Dump the current `public.catalog_problems` table to a local JSON file — the rollback point
and the FIRST step of the operator runbook before every `import_catalog.py --apply`.

The catalog pipeline is fetch -> merge -> import: fetch_boardsesh.py pulls a board from
boardsesh, merge_catalog.py folds it into the canonical committed snapshot in catalog-data/,
and import_catalog.py deploys the snapshot's diff to prod. The import never deletes or
tombstones, but it does insert, update and un-delete rows, and each 500-row batch is its own
transaction, so take this dump right before the apply:

    fetch -> merge -> catalog-data/*.json -> [BACKUP] -> import --apply -> prod
                                                |                            |
                                   restore_catalog_problems.py  <------  (rollback)

The dump preserves EVERY column (incl. updated_at and deleted), so it is a faithful copy of
the table. The rollback is restore_catalog_problems.py: it upserts the dump's rows verbatim,
`deleted` included, which undoes updates and un-deletes; its slab-scoped
`--tombstone-absent --layout N --angle A` flag tombstones the rows an apply INSERTED into
that slab (the only code path in the repo that writes `deleted: true`). Do NOT feed this
file to import_catalog.py — that reads the snapshot shape, not this `{table, count, rows[]}`
dump.

Assumes no concurrent writers during the dump (offset paging over a stable PK order can
skip a row if one is inserted mid-dump). Backups are taken right before a manual import,
so this holds in practice.

Environment
-----------
  SUPABASE_URL               e.g. https://abcdefgh.supabase.co
  SUPABASE_SERVICE_ROLE_KEY  service_role key (anon also works — catalog is public-read —
                             but service-role is used for parity with the import step)

Usage
-----
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/backup_catalog_problems.py
  # writes ./catalog_problems_backup_<UTC-timestamp>.json  (override with a path arg)
"""

import json
import os
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError

PAGE = 1000  # rows per PostgREST range request


def _get(url, headers):
    req = Request(url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode()), r.headers.get("Content-Range")
    except HTTPError as e:
        sys.exit(f"Read failed ({e.code}): {e.read().decode(errors='replace')}")


def main():
    base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.")

    out_path = sys.argv[1] if len(sys.argv) > 1 else (
        "catalog_problems_backup_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".json")

    # Order by the PK so paging is stable. Terminate on the Content-Range total, advancing
    # by rows actually returned — so a server capping responses below PAGE neither under-reads
    # (short page misread as the last) nor over-reads past the end (416 on an out-of-range offset).
    base = f"{base_url}/rest/v1/catalog_problems?select=*&order=source_catalog_id.asc"
    rows, offset, total = [], 0, None
    while total is None or offset < total:
        headers = {
            "apikey": key, "Authorization": f"Bearer {key}",
            "Range-Unit": "items", "Range": f"{offset}-{offset + PAGE - 1}",
        }
        batch, content_range = _get(base, headers)
        rows.extend(batch)
        if content_range and "/" in content_range:
            tail = content_range.rsplit("/", 1)[-1]
            if tail.isdigit():
                total = int(tail)
        print(f"  fetched {len(rows)}" + (f"/{total}" if total else ""))
        if not batch:
            break
        offset += len(batch)

    with open(out_path, "w") as f:
        json.dump({"table": "catalog_problems", "count": len(rows),
                   "dumped_at": datetime.now(timezone.utc).isoformat(), "rows": rows}, f, ensure_ascii=False)
    print(f"\nBacked up {len(rows)} rows -> {os.path.abspath(out_path)}")
    print("Restore (if needed): python3 scripts/restore_catalog_problems.py " + os.path.basename(out_path))


if __name__ == "__main__":
    main()
