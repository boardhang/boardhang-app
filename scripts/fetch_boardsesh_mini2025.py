#!/usr/bin/env python3
"""
Fetch the Mini MoonBoard 2025 problem catalog from boardsesh's public GraphQL
API and write the read-only catalog JSON this app bundles.

WHY BOARDSESH
-------------
MoonBoard's own data is no longer reachable by a script: the iOS app's backend
(rest-v1.moonclimbing.com) is cert-pinned + device-attested, and the moonboard.com
website (and its problem API) is being retired (returns 404). boardsesh is a live
service that mirrored the full MoonBoard catalog into its own database before the
shutdown and exposes it via a public GraphQL endpoint. We read the Mini 2025
problems from there.

  Endpoint:  https://ws.boardsesh.com/graphql   (public, no auth for reads)
  Query:     searchClimbs(input: ClimbSearchInput!)
  Mini 2025: boardName="moonboard", layoutId=7, sizeId=1, setIds="28,29,30,31", angle=40

HOLD ENCODING
-------------
boardsesh stores each climb's holds as a `frames` string: concatenated
`p{holdId}r{roleCode}` tokens, where (mirroring boardsesh's moonboard-helpers):
    holdId   = (row-1)*11 + colIndex + 1     # colIndex 0..10 = A..K, row 1=bottom
    roleCode = 42 start, 43 hand/move, 44 finish
We invert holdId -> (col,row), matching this app's model exactly. Note boardsesh
collapses MoonBoard's left/right/match into a single "hand", so imported holds are
start / move / end only (the app lights moves blue, same as beta-off).

Output (default): MoonBoardLED/Resources/MiniMoonBoard2025Catalog.json
"""

import json
import os
import re
import sys
from urllib.request import Request, urlopen

ENDPOINT = "https://ws.boardsesh.com/graphql"
# Mini 2025 is split across setIds 28,29,30,31 on boardsesh — "28" alone now returns
# only a ~181-problem slice of the full ~4,870.
PARAMS = {"boardName": "moonboard", "layoutId": 7, "sizeId": 1, "setIds": "28,29,30,31", "angle": 40}
PAGE_SIZE = 100

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

# MoonBoard "method" (foot rules), from boardsesh's `characteristics`. Standard
# problems have no method characteristic.
METHOD_LABELS = {
    "method_no_kickboard": "No kickboard",
    "method_footless": "Footless",
    "method_footless_kickboard": "Footless + kickboard",
}

SEARCH_QUERY = """
query Search($i: ClimbSearchInput!) {
  searchClimbs(input: $i) {
    totalCount
    hasMore
    climbs {
      uuid name difficulty benchmark_difficulty stars
      ascensionist_count setter_username frames characteristics
    }
  }
}
"""


def gql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = Request(ENDPOINT, data=body,
                  headers={"Content-Type": "application/json",
                           "User-Agent": "moonboard-led-catalog/1.0"},
                  method="POST")
    with urlopen(req, timeout=60) as r:
        payload = json.loads(r.read().decode())
    if payload.get("errors"):
        sys.exit("GraphQL error: " + json.dumps(payload["errors"][:2]))
    return payload["data"]


def decode_frames(frames):
    holds = []
    for hold_id, role in FRAME_TOKEN.findall(frames or ""):
        n = int(hold_id) - 1
        col = n % 11           # 0..10  (A..K)
        row = n // 11 + 1      # 1..12  (1 = bottom)
        holds.append({"c": col, "r": row, "t": ROLE_TO_TYPE.get(int(role), "right")})
    return holds


def font_grade(climb):
    label = (climb.get("difficulty") or "").strip()
    if label in LABEL_TO_FONT:
        return LABEL_TO_FONT[label]
    # Fallback: take the part before "/", upper-cased ("6a+/V3" -> "6A+").
    return label.split("/")[0].upper() if label else ""


def fetch_all():
    out, page = [], 0
    while True:
        data = gql(SEARCH_QUERY, {"i": {**PARAMS, "page": page, "pageSize": PAGE_SIZE}})
        res = data["searchClimbs"]
        climbs = res["climbs"] or []
        out.extend(climbs)
        total = res.get("totalCount")
        print(f"  page {page}: +{len(climbs)} (total so far {len(out)} / {total})")
        if not res.get("hasMore") or not climbs:
            break
        page += 1
    return out


def normalize(climb):
    holds = decode_frames(climb.get("frames"))
    bench = (climb.get("benchmark_difficulty") or "").strip()
    characteristics = climb.get("characteristics") or []
    method = next((METHOD_LABELS[c] for c in characteristics if c in METHOD_LABELS), None)
    return {
        "id": climb.get("uuid"),
        "name": climb.get("name") or "Untitled",
        "grade": font_grade(climb),
        "userGrade": None,
        "setter": (climb.get("setter_username") or "").strip(),
        "stars": int(round(float(climb.get("stars") or 0))),
        "repeats": climb.get("ascensionist_count") or 0,
        "isBenchmark": bool(bench),
        # MoonBoard foot-rule method (e.g. "Footless"); null for standard problems.
        "method": method,
        "holds": holds,
    }


def main():
    out_path = (sys.argv[1] if len(sys.argv) > 1
                else os.path.join(os.path.dirname(__file__), "..",
                                  "MoonBoardLED", "Resources",
                                  "MiniMoonBoard2025Catalog.json"))
    print("Fetching Mini MoonBoard 2025 catalog from boardsesh…")
    raw = fetch_all()
    problems = [normalize(c) for c in raw]
    problems = [p for p in problems if p["holds"]]
    problems.sort(key=lambda p: (p["grade"], p["name"]))

    catalog = {
        "setup": "Mini MoonBoard 2025",
        "holdsetup": 22,
        "angle": 40,
        "source": "boardsesh (ws.boardsesh.com/graphql)",
        "count": len(problems),
        "problems": problems,
    }

    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(catalog, f, ensure_ascii=False)

    benches = sum(1 for p in problems if p["isBenchmark"])
    print(f"\nWrote {len(problems)} problems ({benches} benchmarks) -> {out_path}")
    if problems:
        s = problems[0]
        print(f"  e.g. {s['name']} ({s['grade']}) by {s['setter']}, {len(s['holds'])} holds")


if __name__ == "__main__":
    main()
