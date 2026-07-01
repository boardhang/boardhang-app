#!/usr/bin/env python3
"""
Derive which hold set each grid position belongs to, by sampling the per-hold-set
overlay PNGs' alpha channel. Runs for every board we bundle a hold-set filter for.

WHY
---
Neither the bundled catalogs nor boardsesh record per-hold set membership for
MoonBoard (boardsesh only tracks set_id per hole for Kilter/Tension; it skips the
set filter for board_name == 'moonboard'). But the imported board art gives it to
us implicitly: each hold set is a transparent overlay that paints only its own
holds. So for every grid cell, the set whose overlay is opaque there owns that
hold.

This lets the app answer "which problems can I climb with only these hold sets
installed?" — a problem is climbable iff every one of its holds is owned by an
active set (see HoldSetMembership / CatalogListView).

Some sets own NO grid holds (e.g. Screw-on Feet — foot accessories placed between
the numbered positions). Those are display-only art layers; the app renders them
but excludes them from the hold-set filter (a 0-count set here signals that).

Output (per board): MoonBoardLED/Resources/<name>HoldSets.json
    { "sets": [ {"id":28,"name":"Hold Set F"}, ... ],
      "membership": { "col-row": setId, ... } }   # col 0-10, row 1=bottom

Requires Pillow:  python3 -m pip install --break-system-packages Pillow
"""

import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required: python3 -m pip install --break-system-packages Pillow")

ASSETS = os.path.join(os.path.dirname(__file__), "..", "MoonBoardLED",
                      "Assets.xcassets", "Boards")
RES = os.path.join(os.path.dirname(__file__), "..", "MoonBoardLED", "Resources")

# Grid geometry per board family (must match MoonBoardGeometry in the app).
MINI = dict(cols=11, rowTop=12, rows=12, L=0.1047, R=0.0508, T=0.0793, B=0.0571)
STD = dict(cols=11, rowTop=18, rows=18, L=0.10, R=0.05, T=0.06, B=0.04)

# board folder, geometry, output name, and (setId, name, overlay-basename) sets.
BOARDS = [
    ("minimoonboard2025", MINI, "MiniMoonBoard2025HoldSets", [
        (28, "Hold Set F", "holdsetf"),
        (29, "Original School Holds", "originalschoolholds"),
        (30, "Wooden Holds B", "woodenholdsb"),
        (31, "Wooden Holds C", "woodenholdsc"),
    ]),
    ("moonboardmasters2019", STD, "MoonBoardMasters2019HoldSets", [
        (17, "Hold Set A", "holdseta"),
        (18, "Hold Set B", "holdsetb"),
        (19, "Original School Holds", "originalschoolholds"),
        (20, "Screw-on Feet", "screw-onfeet"),
        (21, "Wooden Holds", "woodenholds"),
        (22, "Wooden Holds B", "woodenholdsb"),
        (23, "Wooden Holds C", "woodenholdsc"),
    ]),
]

ALPHA_THRESHOLD = 60  # a cell "has a hold" in a set if its center is this opaque


def center_px(col, row, g, w, h):
    gw, gh = 1 - g["L"] - g["R"], 1 - g["T"] - g["B"]
    x = g["L"] + (col + 0.5) / g["cols"] * gw
    y = g["T"] + ((g["rowTop"] - row) + 0.5) / g["rows"] * gh
    return int(x * w), int(y * h)


def max_alpha(px, w, h, cx, cy):
    a = 0
    for dx in range(-6, 7, 3):
        for dy in range(-6, 7, 3):
            xx = min(max(cx + dx, 0), w - 1)
            yy = min(max(cy + dy, 0), h - 1)
            a = max(a, px[xx, yy][3])
    return a


def derive(folder, g, sets):
    membership, counts, conflicts = {}, {}, []
    for set_id, name, basename in sets:
        path = os.path.join(ASSETS, folder, f"{basename}.imageset", f"{basename}.png")
        im = Image.open(path).convert("RGBA")
        w, h = im.size
        px = im.load()
        n = 0
        for col in range(g["cols"]):
            for row in range(1, g["rowTop"] + 1):
                cx, cy = center_px(col, row, g, w, h)
                if max_alpha(px, w, h, cx, cy) > ALPHA_THRESHOLD:
                    key = f"{col}-{row}"
                    if key in membership and membership[key] != set_id:
                        conflicts.append((key, membership[key], set_id))
                    membership[key] = set_id
                    n += 1
        counts[name] = n
    return membership, counts, conflicts


def main():
    for folder, g, out_name, sets in BOARDS:
        membership, counts, conflicts = derive(folder, g, sets)
        out = {
            "sets": [{"id": i, "name": nm} for i, nm, _ in sets],
            "membership": dict(sorted(membership.items())),
        }
        path = os.path.abspath(os.path.join(RES, f"{out_name}.json"))
        with open(path, "w") as f:
            json.dump(out, f, ensure_ascii=False, indent=0)
        total = g["cols"] * g["rowTop"]
        print(f"{folder}: {counts}")
        print(f"  classified {len(membership)}/{total}, conflicts {len(conflicts)} -> {out_name}.json")
        if conflicts:
            print(f"  WARNING conflicts: {conflicts[:8]}")


if __name__ == "__main__":
    main()
