#!/usr/bin/env python3
"""
Fetch a MoonBoard problem feed from boardsesh's public GraphQL API — the FIRST step of the
catalog pipeline (see docs/catalog-data-pipeline.md and scripts/catalog_lib.py):

    boardsesh ──fetch──► catalog-data/.upstream/<slug>_<angle>.json   (scratch, gitignored)
                               │
                             merge  ──► catalog-data/<slug>_<angle>.json   (canonical, committed)
                               │
                             import ──► Supabase

The fetch is UNFILTERED: it pulls every problem boardsesh has for a (board, angle), because
the merge needs to know which rows boardsesh did NOT return to tell a rename from a drop.
Curation ("benchmark or >= 10 repeats" for new problems) happens in the merge, not here.
The output is scratch — never commit it; the merged snapshot beside it is the canonical copy.

Scratch file shape (one line; the merge reads it, nobody diffs it):

    {"fetched_at": "2026-10-09T20:15:03Z", "layoutId": 7, "angle": 40, "setIds": "28,29,30,31",
     "total_count": 5213,          # totalCount boardsesh reported on the FIRST page
     "count": 5201,                # problems written (hold-less climbs are dropped)
     "problems": [{"uuid", "name", "grade", "userGrade", "setter", "stars", "repeats",
                   "isBenchmark", "method", "holds": [{"c","r","t"}…]}, …]}   # sorted by uuid

`uuid` is boardsesh's key, NOT our id — the merge decides identity. `fetched_at` is the
clock the merge stamps `upstream_last_seen` from.

WHY BOARDSESH
-------------
MoonBoard's own data is no longer reachable by a script: the iOS app's backend
(rest-v1.moonclimbing.com) is cert-pinned + device-attested, and the moonboard.com website
(and its problem API) has been retired (returns 404). boardsesh is a live service that
mirrored the full MoonBoard catalog into its own database before the shutdown and exposes
it via a public GraphQL endpoint.

  Endpoint:  https://ws.boardsesh.com/graphql   (public, no auth for reads)
  Query:     searchClimbs(input: ClimbSearchInput!)
  Input:     boardName="moonboard", layoutId, sizeId=1, setIds, angle, page, pageSize (max 100)

The board table (layoutId -> slug, setIds, angles) lives in catalog_lib.BOARDS. Mini 2025
is split across setIds 28,29,30,31 on boardsesh — "28" alone returns a ~181-problem slice.

HOLD ENCODING
-------------
boardsesh stores each climb's holds as a `frames` string: concatenated `p{holdId}r{roleCode}`
tokens, where (mirroring boardsesh's moonboard-helpers):
    holdId   = (row-1)*11 + colIndex + 1     # colIndex 0..10 = A..K, row 1 = bottom
    roleCode = 42 start, 43 hand/move, 44 finish
We invert holdId -> (col, row), matching the app's model exactly. boardsesh collapses
MoonBoard's left/right/match into a single "hand", so holds are start / right / end only
(the app lights "right" blue, same as beta-off). MoonBoard grid is 11 cols (A-K); rows go to
18 on the full boards, 12 on the Minis. A climb with no decodable holds is dropped.

Examples
--------
  python3 scripts/fetch_boardsesh.py --layout 7 --angle 40     # one slab (~53 pages)
  python3 scripts/fetch_boardsesh.py --layout 3                # both angles of one board
  python3 scripts/fetch_boardsesh.py --all                     # every board, both angles
                                                               # (2016 is ~943 pages, ~8 min)
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_lib as lib  # noqa: E402

ENDPOINT = "https://ws.boardsesh.com/graphql"
SIZE_ID = 1
PAGE_SIZE = 100  # boardsesh caps page size at 100
DEFAULT_OUT_DIR = lib.DATA_DIR
HEADERS = {"Content-Type": "application/json", "User-Agent": "moonboard-led-catalog/1.0"}

# boardsesh difficulty label ("6a+/V3") -> MoonBoard Font grade ("6A+").
LABEL_TO_FONT = {
    "5a/V1": "5+", "5b/V1": "5B", "5c/V2": "5C",
    "6a/V3": "6A", "6a+/V3": "6A+", "6b/V4": "6B", "6b+/V4": "6B+",
    "6c/V5": "6C", "6c+/V5": "6C+",
    "7a/V6": "7A", "7a+/V7": "7A+", "7b/V8": "7B", "7b+/V8": "7B+",
    "7c/V9": "7C", "7c+/V10": "7C+",
    "8a/V11": "8A", "8a+/V12": "8A+", "8b/V13": "8B", "8b+/V14": "8B+",
}

ROLE_TO_TYPE = {42: "start", 44: "end", 43: "right"}  # boardsesh has no l/r split
FRAME_TOKEN = re.compile(r"p(\d+)r(\d+)")

# MoonBoard "method" (foot rules), from boardsesh's `characteristics`. Standard problems
# have no method characteristic.
METHOD_LABELS = {
    "method_no_kickboard": "No kickboard",
    "method_footless": "Footless",
    "method_footless_kickboard": "Footless + kickboard",
}

SEARCH_QUERY = """
query Search($i: ClimbSearchInput!) {
  searchClimbs(input: $i) {
    totalCount hasMore
    climbs { uuid name difficulty benchmark_difficulty stars ascensionist_count setter_username frames characteristics }
  }
}
"""


RETRYABLE_HTTP = (429, 500, 502, 503, 504)


def gql(variables, retries=4):
    body = json.dumps({"query": SEARCH_QUERY, "variables": variables}).encode()
    for attempt in range(retries):
        try:
            with urlopen(Request(ENDPOINT, data=body, headers=HEADERS, method="POST"), timeout=60) as r:
                payload = json.loads(r.read().decode())
            if payload.get("errors"):
                sys.exit("GraphQL error: " + json.dumps(payload["errors"][:2]))
            return payload["data"]
        except HTTPError as e:
            if e.code not in RETRYABLE_HTTP:
                raise
            err = e
        except (URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            err = e
        if attempt < retries - 1:
            print(f"  request failed ({err}); retrying", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    sys.exit(f"boardsesh request failed after {retries} attempts: {err}")


def utc_now_iso():
    """UTC ISO 8601 to the second with a trailing Z, e.g. "2026-10-09T20:15:03Z"."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── per-climb normalization (pure) ──────────────────────────────────────────────────

def decode_frames(frames):
    holds = []
    for hold_id, role in FRAME_TOKEN.findall(frames or ""):
        n = int(hold_id) - 1
        holds.append({"c": n % 11, "r": n // 11 + 1, "t": ROLE_TO_TYPE.get(int(role), "right")})
    return holds


def font_grade(label):
    label = (label or "").strip()
    # Fallback: the part before "/", upper-cased ("9a/V17" -> "9A").
    return LABEL_TO_FONT.get(label, label.split("/")[0].upper() if label else "")


def normalize(climb):
    """One boardsesh climb -> a scratch problem dict, or None when it has no holds."""
    holds = decode_frames(climb.get("frames"))
    if not holds:
        return None
    characteristics = climb.get("characteristics") or []
    method = next((METHOD_LABELS[x] for x in characteristics if x in METHOD_LABELS), None)
    return {
        "uuid": climb.get("uuid"),
        "name": climb.get("name") or "Untitled",
        "grade": font_grade(climb.get("difficulty")),
        "userGrade": None,
        # boardsesh setters sometimes carry a trailing space ('Avien ' vs 'Avien'); strip so
        # one setter can't show up as two.
        "setter": (climb.get("setter_username") or "").strip(),
        "stars": int(round(float(climb.get("stars") or 0))),
        "repeats": climb.get("ascensionist_count") or 0,
        "isBenchmark": bool((climb.get("benchmark_difficulty") or "").strip()),
        # MoonBoard foot-rule method (e.g. "Footless"); null for standard problems.
        "method": method,
        "holds": holds,
    }


# ── paging shell ────────────────────────────────────────────────────────────────────

def fetch_slab(layout, angle, set_ids, delay):
    """Page through the whole feed for one (board, angle). Returns (total_count, problems),
    with total_count the first page's totalCount and problems deduped by uuid (boardsesh
    paging can repeat a row) and sorted by uuid."""
    by_uuid, total, page = {}, None, 0
    while True:
        inp = {"boardName": "moonboard", "layoutId": layout, "sizeId": SIZE_ID,
               "setIds": set_ids, "angle": angle, "page": page, "pageSize": PAGE_SIZE}
        res = gql({"i": inp})["searchClimbs"]
        if total is None:
            total = res.get("totalCount")
        climbs = res["climbs"] or []
        for c in climbs:
            p = normalize(c)
            if p is not None and p["uuid"] not in by_uuid:
                by_uuid[p["uuid"]] = p
        if page % 10 == 0:
            print(f"    page {page}: kept {len(by_uuid)} (scanned ~{(page + 1) * PAGE_SIZE}/{total})")
        if not res.get("hasMore") or not climbs:
            break
        page += 1
        time.sleep(delay)
    return total, [by_uuid[u] for u in sorted(by_uuid)]


def fetch_and_write(layout, angle, out_dir, delay):
    """Fetch one slab and write it to lib.fetch_path(out_dir, layout, angle). Returns the path."""
    board = lib.BOARDS[layout]
    print(f"\n{board.name} @ {angle}° (layout {layout}, sets {board.set_ids})…")
    total, problems = fetch_slab(layout, angle, board.set_ids, delay)
    out = {"fetched_at": utc_now_iso(), "layoutId": layout, "angle": angle, "setIds": board.set_ids,
           "total_count": total, "count": len(problems), "problems": problems}
    path = lib.fetch_path(out_dir, layout, angle)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lib.write_json_atomic(path, json.dumps(out, ensure_ascii=False))
    mb = os.path.getsize(path) / 1e6
    benches = sum(1 for p in problems if p["isBenchmark"])
    print(f"  -> {path}  ({len(problems)} problems of {total} upstream, {benches} benchmarks, {mb:.1f} MB)")
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description="Fetch the unfiltered boardsesh feed into catalog-data/.upstream/")
    ap.add_argument("--layout", type=int, choices=sorted(lib.BOARDS), help="single layout id (see catalog_lib.BOARDS)")
    ap.add_argument("--angle", type=int, choices=(25, 40), help="single angle; default both")
    ap.add_argument("--all", action="store_true", help="every board")
    ap.add_argument("--delay", type=float, default=0.25, help="seconds between page requests")
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR,
                    help="catalog-data dir; the file lands in its .upstream/ subdir (default: %(default)s)")
    args = ap.parse_args(argv)

    if args.all:
        layouts = list(lib.BOARDS)
    elif args.layout:
        layouts = [args.layout]
    else:
        ap.error("pass --all or --layout N")

    out_dir = os.path.abspath(args.out_dir)
    for lid in layouts:
        for angle in ([args.angle] if args.angle else lib.BOARDS[lid].angles):
            fetch_and_write(lid, angle, out_dir, args.delay)


if __name__ == "__main__":
    main()
