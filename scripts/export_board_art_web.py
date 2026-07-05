#!/usr/bin/env python3
"""
Export the board art the web PWA renders (U7 CatalogBoard) from the iOS asset
catalog into web/public/boards/.

The iOS app stores art as Xcode imagesets:
    Assets.xcassets/Boards/<bg>.imageset/<bg>.png            (shared backgrounds)
    Assets.xcassets/Boards/<folder>/<name>.imageset/<name>.png  (per-hold-set overlays)

The web renderer stacks a background + the visible hold-set overlays + hold
markers, so it needs the same PNGs at stable URLs:
    web/public/boards/<bg>.png                 -> /boards/<bg>.png
    web/public/boards/<folder>/<name>.png      -> /boards/<folder>/<name>.png

This is a straight copy (same PNGs iOS ships), so no image libraries are needed.
Board folders / backgrounds / overlay basenames mirror web/src/board/boards.ts.

RE-RUN this after the iOS Assets.xcassets/Boards art changes, or after adding a
board / hold set to web/src/board/boards.ts. The board-art coverage test
(web/src/board/boardArt.test.ts) fails if boards.ts references art this script
did not export, so drift is caught by `npm run test`.
"""

import os
import shutil
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
ASSETS = os.path.join(ROOT, "ios", "MoonBoardLED", "Assets.xcassets", "Boards")
OUT = os.path.join(ROOT, "web", "public", "boards")

# (folder, background, [overlay basenames]) — mirrors web/src/board/boards.ts.
BOARDS = [
    ("minimoonboard2025", "minimoonboard-bg",
     ["holdsetf", "originalschoolholds", "woodenholdsb", "woodenholdsc"]),
    ("moonboardmasters2019", "moonboard-bg",
     ["holdseta", "holdsetb", "originalschoolholds", "screw-onfeet",
      "woodenholds", "woodenholdsb", "woodenholdsc"]),
    ("moonboard2024", "moonboard-bg",
     ["holdsetd", "holdsete", "holdsetf", "woodenholds", "woodenholdsb", "woodenholdsc"]),
    ("moonboardmasters2017", "moonboard-bg",
     ["holdseta", "holdsetb", "holdsetc", "originalschoolholds", "screw-onfeet", "woodenholds"]),
    ("moonboard2016", "moonboard-bg",
     ["holdseta", "holdsetb", "originalschoolholds"]),
]


def imageset_png(*parts, name):
    """Path to the PNG inside a `<name>.imageset` directory."""
    return os.path.join(ASSETS, *parts, f"{name}.imageset", f"{name}.png")


def copy(src, dest):
    if not os.path.isfile(src):
        sys.exit(f"missing asset: {os.path.relpath(src, ROOT)}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copyfile(src, dest)
    return os.path.getsize(dest)


def main():
    total = 0
    seen_bg = set()
    for folder, bg, overlays in BOARDS:
        if bg not in seen_bg:
            total += copy(imageset_png(name=bg), os.path.join(OUT, f"{bg}.png"))
            seen_bg.add(bg)
        for name in overlays:
            total += copy(imageset_png(folder, name=name),
                          os.path.join(OUT, folder, f"{name}.png"))
        print(f"  {folder}: bg {bg} + {len(overlays)} overlays")
    print(f"exported to {os.path.relpath(OUT, ROOT)} ({total / 1024:.0f} KiB)")


if __name__ == "__main__":
    main()
