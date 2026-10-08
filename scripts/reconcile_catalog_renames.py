#!/usr/bin/env python3
"""
Rewrite a staged catalog slab (catalog-data/<slug>_<angle>.json) so problems boardsesh has
RENAMED keep the uuid Supabase already knows them by.

boardsesh derives a problem's uuid from its name, so a re-cased or retitled problem comes
back from fetch_boardsesh.py under a NEW uuid with the SAME holds. import_catalog.py upserts
on uuid, so without this pass every rename lands as a second row beside the old one — the
same problem twice in the catalog, with user data (ascents, lists, session queues) attached
only to the old copy. Run this between fetch and import:

    fetch_boardsesh.py -> reconcile_catalog_renames.py -> import_catalog.py

A staged problem is remapped when its uuid is not live AND exactly one live (non-deleted)
row in the same slab has the identical hold set and is itself absent from the staged set —
i.e. the old row disappeared from the fetch at the same time the new one appeared. The
staged row keeps boardsesh's current name/grade/counts and only its `id` changes. Several
candidates fall back to a casefolded name match; still ambiguous → left alone and reported,
so the import can't silently merge two genuinely distinct problems that share holds.

Environment: SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY (reads only —
the anon key is enough; catalog_problems is public-read).

Usage
-----
  SUPABASE_URL=… SUPABASE_ANON_KEY=… python3 scripts/reconcile_catalog_renames.py --layout 3 --angle 40
  … python3 scripts/reconcile_catalog_renames.py --all --dry-run     # report, don't rewrite
"""

import argparse
import glob
import json
import os
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

PAGE = 1000  # hosted PostgREST clamps every response to 1000 rows (see catalog-data-pipeline.md)


def hold_key(holds):
    """Order-independent identity of a problem's hold set — the thing a rename doesn't change."""
    return frozenset((h["c"], h["r"], h["t"]) for h in holds or [])


def reconcile(staged, live):
    """Remap renamed staged problems onto their live uuid.

    staged: list of catalog-file problems ({id, name, holds, …}); mutated in place.
    live:   list of {source_catalog_id, name, holds} for the slab's non-deleted rows.
    Returns (remapped, ambiguous): remapped is [(old_staged_id, live_id, staged_name, live_name)],
    ambiguous is [(staged_id, staged_name, [candidate live names])].
    """
    staged_ids = {p["id"] for p in staged}
    live_ids = {r["source_catalog_id"] for r in live}
    # Only live rows the fetch no longer returns can be the "old copy" of a rename. A live row
    # that is still staged under its own uuid is a distinct problem that happens to share holds.
    by_holds = {}
    for r in live:
        if r["source_catalog_id"] not in staged_ids:
            by_holds.setdefault(hold_key(r["holds"]), []).append(r)

    remapped, ambiguous = [], []
    for p in staged:
        if p["id"] in live_ids:
            continue
        candidates = by_holds.get(hold_key(p["holds"])) or []
        if len(candidates) > 1:
            named = [c for c in candidates if c["name"].casefold() == p["name"].casefold()]
            if len(named) == 1:
                candidates = named
        if len(candidates) != 1:
            if candidates:
                ambiguous.append((p["id"], p["name"], [c["name"] for c in candidates]))
            continue
        old = candidates[0]
        by_holds[hold_key(p["holds"])].remove(old)  # consumed: one live row per staged row
        remapped.append((p["id"], old["source_catalog_id"], p["name"], old["name"]))
        p["id"] = old["source_catalog_id"]
    return remapped, ambiguous


def _get(url, key, retries=4):
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    for attempt in range(retries):
        try:
            with urlopen(Request(url, headers=headers), timeout=120) as r:
                return json.loads(r.read().decode())
        except HTTPError as e:
            if e.code in (429, 502, 503) and attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            sys.exit(f"GET failed ({e.code}): {e.read().decode(errors='replace')}")


def live_rows(base_url, key, layout, angle):
    """Every non-deleted row in a slab, paged by id past the 1000-row clamp."""
    rows, last = [], None
    while True:
        after = f"&source_catalog_id=gt.{last}" if last else ""
        url = (f"{base_url}/rest/v1/catalog_problems?select=source_catalog_id,name,holds"
               f"&layout_id=eq.{layout}&angle=eq.{angle}&deleted=is.false{after}"
               f"&order=source_catalog_id.asc&limit={PAGE}")
        page = _get(url, key)
        if not page:
            return rows
        rows.extend(page)
        last = page[-1]["source_catalog_id"]


def _catalog_files(out_dir, layout, angle):
    selected = []
    for path in sorted(glob.glob(os.path.join(out_dir, "*.json"))):
        with open(path) as f:
            catalog = json.load(f)
        if "problems" not in catalog or "layoutId" not in catalog:
            continue
        if layout is not None and catalog.get("layoutId") != layout:
            continue
        if angle is not None and catalog.get("angle") != angle:
            continue
        selected.append((path, catalog))
    return selected


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", type=int, help="single layout id 1-7 (see fetch_boardsesh.py)")
    ap.add_argument("--angle", type=int, choices=(25, 40), help="single angle; default both")
    ap.add_argument("--all", action="store_true", help="every staged catalog-data file")
    ap.add_argument("--dir", default=os.path.join(os.path.dirname(__file__), "..", "catalog-data"))
    ap.add_argument("--dry-run", action="store_true", help="report remaps without rewriting the file")
    args = ap.parse_args()

    if not args.all and args.layout is None:
        ap.error("pass --all or --layout N")

    base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not base_url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).")

    files = _catalog_files(os.path.abspath(args.dir), args.layout, args.angle)
    if not files:
        sys.exit("No matching catalog files")

    for path, catalog in files:
        layout, angle = catalog["layoutId"], catalog["angle"]
        live = live_rows(base_url, key, layout, angle)
        remapped, ambiguous = reconcile(catalog["problems"], live)
        print(f"{os.path.basename(path)}: layout {layout} @ {angle}° — {len(catalog['problems'])} staged, "
              f"{len(live)} live, {len(remapped)} renamed, {len(ambiguous)} ambiguous")
        for _old, live_id, new_name, old_name in remapped:
            print(f"    {old_name!r} -> {new_name!r}  (kept {live_id})")
        for staged_id, name, names in ambiguous:
            print(f"    AMBIGUOUS {name!r} ({staged_id}) matches holds of {names} — left as a new row")
        if remapped and not args.dry_run:
            with open(path, "w") as f:
                json.dump(catalog, f, ensure_ascii=False)
            print(f"    rewrote {path}")


if __name__ == "__main__":
    main()
