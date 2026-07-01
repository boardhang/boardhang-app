#!/usr/bin/env python3
"""
Fetch MoonBoard problem catalogs from boardsesh's public GraphQL API for ANY of
the 7 MoonBoard setups, and write per-(setup, angle) catalog JSON.

This is the generalized version of fetch_boardsesh_mini2025.py — same endpoint,
decoding, and output schema, but parameterized over every board. Use it to
pre-stage data for boards you intend to add to the app later.

Output goes to ../catalog-data/ by default (a NON-bundled dir, so these files
don't bloat the app). When you add a board to the app, copy the file you want
into MoonBoardLED/Resources/ and point the loader at it.

Examples
--------
  # everything, both angles (big + slow — hits boardsesh hard):
  python3 scripts/fetch_boardsesh.py --all

  # one board / angle:
  python3 scripts/fetch_boardsesh.py --layout 3 --angle 40

  # only the good stuff (benchmarks, or a popularity floor) — recommended for
  # the huge boards like 2016:
  python3 scripts/fetch_boardsesh.py --all --angle 40 --min-ascents 50

Data source & hold encoding: see fetch_boardsesh_mini2025.py's docstring.
MoonBoard grid is 11 cols (A-K); rows go to 18 on the full boards, 12 on the Minis.
"""

import argparse
import json
import os
import re
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ENDPOINT = "https://ws.boardsesh.com/graphql"
SIZE_ID = 1
PAGE_SIZE = 100  # boardsesh caps page size at 100

# layoutId -> (slug, display name, "setIds" string, [supported angles]).
# setIds verified against the live API; counts (per angle) are rough guides.
BOARDS = {
    1: ("moonboard2010",        "MoonBoard 2010",        "1",                    [40, 25]),
    2: ("moonboard2016",        "MoonBoard 2016",        "2,3,4",                [40, 25]),
    3: ("moonboard2024",        "MoonBoard 2024",        "5,6,7,8,9,10",         [40, 25]),
    4: ("moonboardmasters2017", "MoonBoard Masters 2017","11,12,13,14,15,16",    [40, 25]),
    5: ("moonboardmasters2019", "MoonBoard Masters 2019","17,18,19,20,21,22,23", [40, 25]),
    6: ("minimoonboard2020",    "Mini MoonBoard 2020",   "24,25,26,27",          [40, 25]),
    7: ("minimoonboard2025",    "Mini MoonBoard 2025",   "28",                   [40, 25]),
}

LABEL_TO_FONT = {
    "5a/V1": "5+", "5b/V1": "5B", "5c/V2": "5C",
    "6a/V3": "6A", "6a+/V3": "6A+", "6b/V4": "6B", "6b+/V4": "6B+",
    "6c/V5": "6C", "6c+/V5": "6C+",
    "7a/V6": "7A", "7a+/V7": "7A+", "7b/V8": "7B", "7b+/V8": "7B+",
    "7c/V9": "7C", "7c+/V10": "7C+",
    "8a/V11": "8A", "8a+/V12": "8A+", "8b/V13": "8B", "8b+/V14": "8B+",
}
# benchmark flag misses genuine benchmarks; force-flag these by uuid.
# (uuid is stable per problem across angles, so one entry covers 25° and 40°.)
BENCHMARK_OVERRIDES = {
    "ac7d98a1-51b6-5048-8e97-7651c5024a2d",  # THE WARM UP PROBLEM (6A+)
    "8fe54ddb-c8c1-51fe-8418-45e3da379a07",  # FULL SWINGS (7A)
}

ROLE_TO_TYPE = {42: "start", 44: "end", 43: "right"}
FRAME_TOKEN = re.compile(r"p(\d+)r(\d+)")
HEADERS = {"Content-Type": "application/json", "User-Agent": "moonboard-led-catalog/1.0"}

SEARCH_QUERY = """
query Search($i: ClimbSearchInput!) {
  searchClimbs(input: $i) {
    totalCount hasMore
    climbs { uuid name difficulty benchmark_difficulty stars ascensionist_count setter_username frames }
  }
}
"""


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
            if e.code in (429, 502, 503) and attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise


def decode_frames(frames):
    holds = []
    for hold_id, role in FRAME_TOKEN.findall(frames or ""):
        n = int(hold_id) - 1
        holds.append({"c": n % 11, "r": n // 11 + 1, "t": ROLE_TO_TYPE.get(int(role), "right")})
    return holds


def font_grade(label):
    label = (label or "").strip()
    return LABEL_TO_FONT.get(label, label.split("/")[0].upper() if label else "")


def _fetch_filtered(layout, angle, set_ids, server_filter, delay):
    """Page through every problem matching one server-side filter dict."""
    out, page = [], 0
    while True:
        inp = {"boardName": "moonboard", "layoutId": layout, "sizeId": SIZE_ID,
               "setIds": set_ids, "angle": angle, "page": page, "pageSize": PAGE_SIZE}
        inp.update(server_filter)
        res = gql({"i": inp})["searchClimbs"]
        climbs = res["climbs"] or []
        for c in climbs:
            bench = bool((c.get("benchmark_difficulty") or "").strip()) or \
                c.get("uuid") in BENCHMARK_OVERRIDES
            holds = decode_frames(c.get("frames"))
            if not holds:
                continue
            out.append({
                "id": c.get("uuid"), "name": c.get("name") or "Untitled",
                "grade": font_grade(c.get("difficulty")), "userGrade": None,
                "setter": c.get("setter_username") or "",
                "stars": int(round(float(c.get("stars") or 0))),
                "repeats": c.get("ascensionist_count") or 0, "isBenchmark": bench,
                "holds": holds,
            })
        if page % 10 == 0:
            print(f"    page {page}: kept {len(out)} (scanned ~{(page+1)*PAGE_SIZE}/{res.get('totalCount')})")
        if not res.get("hasMore") or not climbs:
            break
        page += 1
        time.sleep(delay)
    return out


def fetch_board(layout, angle, set_ids, min_ascents, benchmarks_only, delay):
    """Fetch matching problems as the UNION of the requested filters, deduped by uuid.

    Many of the most-repeated problems
    (e.g. 'THE WARM UP PROBLEM', 16k ascents) aren't flagged. So when both
    --benchmarks-only and --min-ascents are given we union the two result sets
    rather than intersect: keep every flagged benchmark AND every popular problem.
    """
    filters = []
    if benchmarks_only:
        filters.append({"onlyBenchmarks": True})
    if min_ascents:
        filters.append({"minAscents": min_ascents})
    if not filters:
        filters.append({})  # no filter -> everything

    by_id, out = set(), []
    for i, f in enumerate(filters):
        if len(filters) > 1:
            print(f"  filter {i+1}/{len(filters)}: {f}")
        for p in _fetch_filtered(layout, angle, set_ids, f, delay):
            if p["id"] in by_id:
                continue
            by_id.add(p["id"])
            out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", type=int, help="single layout id 1-7 (see BOARDS)")
    ap.add_argument("--angle", type=int, choices=(25, 40), help="single angle; default both")
    ap.add_argument("--all", action="store_true", help="every board")
    ap.add_argument("--min-ascents", type=int, default=0, help="skip problems below this ascent count")
    ap.add_argument("--benchmarks-only", action="store_true")
    ap.add_argument("--delay", type=float, default=0.25, help="seconds between page requests")
    ap.add_argument("--out-dir", default=os.path.join(os.path.dirname(__file__), "..", "catalog-data"))
    args = ap.parse_args()

    if args.all:
        layouts = list(BOARDS)
    elif args.layout:
        layouts = [args.layout]
    else:
        ap.error("pass --all or --layout N")

    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)

    for lid in layouts:
        slug, name, set_ids, angles = BOARDS[lid]
        for angle in ([args.angle] if args.angle else angles):
            print(f"\n{name} @ {angle}° (layout {lid}, sets {set_ids})…")
            problems = fetch_board(lid, angle, set_ids, args.min_ascents, args.benchmarks_only, args.delay)
            problems.sort(key=lambda p: (p["grade"], p["name"]))
            catalog = {"setup": name, "layoutId": lid, "angle": angle,
                       "source": "boardsesh (ws.boardsesh.com/graphql)",
                       "count": len(problems), "problems": problems}
            path = os.path.join(out_dir, f"{slug}_{angle}.json")
            with open(path, "w") as f:
                json.dump(catalog, f, ensure_ascii=False)
            mb = os.path.getsize(path) / 1e6
            benches = sum(1 for p in problems if p["isBenchmark"])
            print(f"  -> {path}  ({len(problems)} problems, {benches} benchmarks, {mb:.1f} MB)")


if __name__ == "__main__":
    main()
