#!/usr/bin/env python3
"""
Rewrite a staged catalog slab (catalog-data/<slug>_<angle>.json) so problems boardsesh has
RENAMED keep the uuid Supabase already knows them by.

boardsesh derives a problem's uuid from its name AND setter (observed: a trailing space
added to a setter re-keyed 'FM 1' with the name untouched), so a re-cased, retitled or
re-attributed problem comes back from fetch_boardsesh.py under a NEW uuid with the SAME
holds. import_catalog.py upserts on uuid, so without this pass every such change lands as
a second row beside the old one — the same problem twice in the catalog, with user data
(ascents, lists, session queues) attached only to the old copy. Run this between fetch
and import (import_catalog.py refuses to run while any are outstanding):

    fetch_boardsesh.py -> reconcile_catalog_renames.py -> import_catalog.py

A staged problem is a rename candidate when its uuid is not in Supabase and a live row in
the same slab has the identical hold set and is itself absent from the staged set — the
old row disappeared from the fetch as the new one appeared. Identical holds alone are not
proof: a setter can delete a problem and someone else can re-set the same holds. So the
match also needs EVIDENCE that it is the same boardsesh record, in this order:

    name     — same name ignoring case/whitespace ('BINGO' -> 'Bingo')
    setter   — same setter ignoring case/whitespace (retitled, same author)
    repeats  — ascent count carried over (staged >= live; a re-set problem restarts at 0).
               Weakest, so it only remaps with --trust-repeats; otherwise reported.

Several staged rows can share one hold set (a rename plus a genuinely new copy); claims
are settled per hold set, strongest evidence first, so the rename wins the old uuid.
Anything still unresolved is reported, never merged — including matches whose only live
counterpart is a tombstoned row (import never clears `deleted`, so re-keying onto one
would hide the problem; un-tombstone by hand first).

Environment: SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY (reads only —
the anon key is enough; catalog_problems is public-read).

Usage
-----
  SUPABASE_URL=… SUPABASE_ANON_KEY=… python3 scripts/reconcile_catalog_renames.py --layout 3 --angle 40
  … python3 scripts/reconcile_catalog_renames.py --all --dry-run        # report, don't rewrite
  … python3 scripts/reconcile_catalog_renames.py --layout 3 --angle 40 --trust-repeats
"""

import argparse
import glob
import json
import os
import re
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

PAGE = 1000  # hosted PostgREST clamps every response to 1000 rows (see catalog-data-pipeline.md)
# source_catalog_id is interpolated into the keyset-paging filter; refuse anything that
# could break or broaden it (same guard as prune_catalog_orphans.py).
ID_RE = re.compile(r"^[A-Za-z0-9-]+$")
EVIDENCE = ("name", "setter", "repeats")


def hold_key(holds):
    """Order-independent identity of a problem's hold set — the thing a rename doesn't change."""
    return frozenset((h["c"], h["r"], h["t"]) for h in holds or [])


def _norm(s):
    return (s or "").strip().casefold()


def evidence(staged_p, live_r):
    """Strongest reason to believe a geometry match is the same boardsesh record, or None."""
    if _norm(staged_p.get("name")) and _norm(staged_p.get("name")) == _norm(live_r.get("name")):
        return "name"
    if _norm(staged_p.get("setter")) and _norm(staged_p.get("setter")) == _norm(live_r.get("setter")):
        return "setter"
    if int(staged_p.get("repeats") or 0) >= int(live_r.get("repeats") or 0):
        return "repeats"
    return None


def reconcile(staged, live, trust_repeats=False):
    """Remap renamed staged problems onto their live uuid.

    staged: list of catalog-file problems ({id, name, setter, repeats, holds, …}); mutated in place.
    live:   list of {source_catalog_id, name, setter, repeats, holds, deleted} for the slab —
            every row, tombstones included.
    Returns (remapped, unresolved):
      remapped   — [(old_staged_id, live_id, staged_name, live_name, evidence_kind)]
      unresolved — [(staged_id, staged_name, [(live_name, evidence_kind_or_None, deleted)])]
                   geometry matches that were not remapped: no evidence, repeats-only without
                   --trust-repeats, a tie, or a tombstoned counterpart.
    """
    staged_ids = {p["id"] for p in staged}
    live_ids = {r["source_catalog_id"] for r in live}

    # Only live rows the fetch no longer returns can be the "old copy" of a rename. A live row
    # that is still staged under its own uuid is a distinct problem that happens to share holds.
    live_by_key = {}
    for r in live:
        if r["source_catalog_id"] not in staged_ids:
            live_by_key.setdefault(hold_key(r["holds"]), []).append(r)
    claims_by_key = {}
    for p in staged:
        if p["id"] not in live_ids:
            key = hold_key(p["holds"])
            if key in live_by_key:
                claims_by_key.setdefault(key, []).append(p)

    remapped, unresolved = [], []
    accepted = EVIDENCE if trust_repeats else EVIDENCE[:-1]
    for key, claimants in claims_by_key.items():
        candidates = [r for r in live_by_key[key] if not r.get("deleted")]
        # Settle claims strongest-evidence-first so a rename beats a new copy of the same holds.
        for kind in accepted:
            for p in list(claimants):
                matches = [r for r in candidates if evidence(p, r) == kind]
                if len(matches) != 1:
                    continue
                old = matches[0]
                candidates.remove(old)
                claimants.remove(p)
                remapped.append((p["id"], old["source_catalog_id"], p["name"], old["name"], kind))
                p["id"] = old["source_catalog_id"]
        for p in claimants:
            unresolved.append((p["id"], p["name"], [
                (r["name"], evidence(p, r), bool(r.get("deleted"))) for r in live_by_key[key]
                if r in candidates or r.get("deleted")
            ]))
    return remapped, unresolved


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
    """Every row in a slab (tombstones included), paged by id past the 1000-row clamp."""
    rows, last = [], None
    while True:
        after = f"&source_catalog_id=gt.{last}" if last else ""
        url = (f"{base_url}/rest/v1/catalog_problems?select=source_catalog_id,name,setter,repeats,holds,deleted"
               f"&layout_id=eq.{layout}&angle=eq.{angle}{after}"
               f"&order=source_catalog_id.asc&limit={PAGE}")
        page = _get(url, key)
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        last = page[-1]["source_catalog_id"]
        if not ID_RE.match(last):
            sys.exit(f"refusing to page past an unsafe source_catalog_id: {last!r}")


def read_credentials():
    base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not base_url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).")
    return base_url, key


def catalog_files(out_dir, layout, angle):
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


def write_catalog(path, catalog):
    """Atomic replace, so an interrupted dump can't leave a truncated staging file behind."""
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(catalog, f, ensure_ascii=False)
    os.replace(tmp, path)


def report(path, catalog, live, remapped, unresolved):
    print(f"{os.path.basename(path)}: layout {catalog['layoutId']} @ {catalog['angle']}° — "
          f"{len(catalog['problems'])} staged, {len(live)} live, {len(remapped)} renamed, {len(unresolved)} unresolved")
    for _old, live_id, new_name, old_name, kind in remapped:
        print(f"    [{kind}] {old_name!r} -> {new_name!r}  (kept {live_id})")
    for staged_id, name, cands in unresolved:
        why = "; ".join(f"{n!r} ({'tombstoned' if d else (e or 'no evidence')})" for n, e, d in cands)
        print(f"    UNRESOLVED {name!r} ({staged_id}) shares holds with {why} — left as a new row")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", type=int, help="single layout id 1-7 (see fetch_boardsesh.py)")
    ap.add_argument("--angle", type=int, choices=(25, 40), help="single angle; default both")
    ap.add_argument("--all", action="store_true", help="every staged catalog-data file")
    ap.add_argument("--dir", default=os.path.join(os.path.dirname(__file__), "..", "catalog-data"))
    ap.add_argument("--dry-run", action="store_true", help="report remaps without rewriting the file")
    ap.add_argument("--trust-repeats", action="store_true",
                    help="also remap matches whose only evidence is a carried-over ascent count")
    args = ap.parse_args()

    if not args.all and args.layout is None:
        ap.error("pass --all or --layout N")
    base_url, key = read_credentials()
    files = catalog_files(os.path.abspath(args.dir), args.layout, args.angle)
    if not files:
        sys.exit("No matching catalog files")

    for path, catalog in files:
        live = live_rows(base_url, key, catalog["layoutId"], catalog["angle"])
        remapped, unresolved = reconcile(catalog["problems"], live, trust_repeats=args.trust_repeats)
        report(path, catalog, live, remapped, unresolved)
        if remapped and not args.dry_run:
            write_catalog(path, catalog)
            print(f"    rewrote {path}")


if __name__ == "__main__":
    main()
