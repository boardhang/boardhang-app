#!/usr/bin/env python3
"""
Shared helpers for the catalog pipeline — the one module `fetch_boardsesh.py`,
`merge_catalog.py`, `import_catalog.py`, `export_catalog_snapshots.py` and
`restore_catalog_problems.py` all build on (see docs/catalog-data-pipeline.md).

    boardsesh ──fetch──► catalog-data/.upstream/<slug>_<angle>.json   (scratch, gitignored)
                               │
                             merge  ◄── catalog-data/overrides.json   (committed verdicts)
                               ▼
                 catalog-data/<slug>_<angle>.json   (CANONICAL snapshot, committed)
                               │
                             import ──► Supabase public.catalog_problems   (a deployment of it)

The snapshot is ours: `id` is OUR identity for a problem (the boardsesh uuid first seen for
it, or a derived id for a second-angle twin), and it never changes once minted. The
`boardsesh_uuid` beside it is the upstream key, which boardsesh re-derives from name+setter
and so may change. `hold_key` is the geometry identity the merge matches renames on.

Snapshot shape — header keys in SNAPSHOT_KEYS order, problems sorted by `id`, ONE PROBLEM PER
LINE so a refresh diffs by problem, each problem's keys in PROBLEM_KEYS order:

    {"setup": "MoonBoard 2024", "layoutId": 3, "angle": 40, "source": "…", "curation": "…",
     "upstream_total": 38643, "count": 5858, "problems": [
    {"id": "…", "boardsesh_uuid": "…", "name": …, "grade": …, "userGrade": …, "setter": …,
     "stars": …, "repeats": …, "isBenchmark": …, "method": …, "holds": [{"c","r","t"}…],
     "hold_key": "<sha256 hex>", "upstream_last_seen": "2026-10-09"},
    …
    ]}

`upstream_total` is the `total_count` boardsesh reported for the fetch last merged (null after
the seed) — the short-fetch guard compares the next fetch against it. `upstream_last_seen` is
the date of the fetch a problem last appeared in; null means no fetch has returned it yet.

Overrides file (catalog-data/overrides.json) — every entry is slab-scoped:

    {"retired_ids": ["<id tombstoned in prod that no snapshot holds>", …],
     "entries": [
       {"action": "match",        "layout_id": 3, "angle": 40, "uuid": "<upstream>", "id": "<ours>"},
       {"action": "new",          "layout_id": 3, "angle": 40, "uuid": "<upstream>", "id": "<mint as>"},
       {"action": "accept_holds", "layout_id": 3, "angle": 40, "id": "<ours>", "hold_key": "<sha256>"},
       {"action": "pin",          "layout_id": 5, "angle": 40, "id": "<ours>", "field": "isBenchmark", "value": true}
     ]}

Every entry may carry a free-form "note". The file must never carry both `problems` and
`layoutId` at top level — the slab selectors treat any such file as a snapshot.

Tests load this module by path (scripts/tests/test_catalog_lib.py).
"""

import glob
import hashlib
import json
import os
import re
import sys
import time
import uuid
from collections import namedtuple
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# ── constants ─────────────────────────────────────────────────────────────────────────

DATA_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "catalog-data"))
UPSTREAM_SUBDIR = ".upstream"   # gitignored scratch for fetch output
OVERRIDES_FILE = "overrides.json"

SOURCE = "boardsesh (ws.boardsesh.com/graphql)"
MIN_REPEATS = 10
CURATION = f"benchmark or repeats >= {MIN_REPEATS}"  # admission rule for NEW problems, recorded in the header

PAGE = 1000  # hosted PostgREST clamps every response to 1000 rows (see catalog-data-pipeline.md)
# source_catalog_id is interpolated into PostgREST filters (keyset paging, in.() lists); refuse
# anything that could break or broaden a filter.
ID_RE = re.compile(r"^[A-Za-z0-9-]+$")

SNAPSHOT_KEYS = ("setup", "layoutId", "angle", "source", "curation", "upstream_total", "count", "problems")
PROBLEM_KEYS = ("id", "boardsesh_uuid", "name", "grade", "userGrade", "setter", "stars", "repeats",
                "isBenchmark", "method", "holds", "hold_key", "upstream_last_seen")
# Fields boardsesh owns (the merge overwrites them from the feed); we own the rest (R9).
UPSTREAM_FIELDS = ("name", "grade", "userGrade", "setter", "stars", "repeats", "isBenchmark", "method")
# The columns the import uploads, plus `deleted` — the shape both sides of the import diff share.
ROW_COLUMNS = ("source_catalog_id", "layout_id", "angle", "name", "grade", "user_grade", "setter",
               "stars", "repeats", "is_benchmark", "method", "holds", "deleted")

OVERRIDE_ACTIONS = {
    "match": ("uuid", "id"),            # upstream uuid is our row `id`
    "new": ("uuid", "id"),              # upstream uuid is a new problem, minted as `id`
    "accept_holds": ("id", "hold_key"),  # accept this exact geometry change on our row
    "pin": ("id", "field", "value"),    # hold an upstream-owned field at `value`
}

# Derived ids for a problem boardsesh keys identically at both angles (R26): uuid5 of the
# upstream uuid and the angle under this fixed namespace, so every operator mints the same id.
DERIVED_ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://boardhang.app/catalog/derived-id")

Board = namedtuple("Board", "slug name set_ids angles")
# layoutId -> board. setIds verified against the live API. Mini 2025 was re-partitioned by
# boardsesh into 28,29,30,31 (setId "28" alone returns a ~181-problem slice).
BOARDS = {
    1: Board("moonboard2010",        "MoonBoard 2010",         "1",                    (40, 25)),
    2: Board("moonboard2016",        "MoonBoard 2016",         "2,3,4",                (40, 25)),
    3: Board("moonboard2024",        "MoonBoard 2024",         "5,6,7,8,9,10",         (40, 25)),
    4: Board("moonboardmasters2017", "MoonBoard Masters 2017", "11,12,13,14,15,16",    (40, 25)),
    5: Board("moonboardmasters2019", "MoonBoard Masters 2019", "17,18,19,20,21,22,23", (40, 25)),
    6: Board("minimoonboard2020",    "Mini MoonBoard 2020",    "24,25,26,27",          (40, 25)),
    7: Board("minimoonboard2025",    "Mini MoonBoard 2025",    "28,29,30,31",          (40, 25)),
}


def slug_for(layout):
    return BOARDS[layout].slug


# ── identity ──────────────────────────────────────────────────────────────────────────

def hold_key(holds):
    """Geometry identity of a problem: sha256 hex of the canonical sorted `c,r,t` list.

    Order-independent, so a re-serialized hold set keys the same. The full digest is an
    identity key — never truncate it; changing this format means re-exporting every snapshot.
    """
    canon = sorted(f"{h['c']},{h['r']},{h['t']}" for h in holds or [])
    return hashlib.sha256(";".join(canon).encode()).hexdigest()


def derived_id(upstream_uuid, angle):
    """Our id for the second-angle twin of a problem whose upstream uuid is already our id elsewhere."""
    return str(uuid.uuid5(DERIVED_ID_NAMESPACE, f"{upstream_uuid}:{angle}"))


def admitted(problem):
    """Curation rule for NEW problems (existing ones are updated regardless): CURATION."""
    return bool(problem.get("isBenchmark")) or int(problem.get("repeats") or 0) >= MIN_REPEATS


def norm_text(s):
    """Case- and whitespace-insensitive text for rename evidence."""
    return (s or "").strip().casefold()


# ── row normalization (the import diff compares exactly this shape on both sides) ────────

def nullable_text(value):
    """Collapse '' to null on the two nullable text columns so a missing method and an empty
    one never diff as a change."""
    if value is None:
        return None
    value = str(value)
    return value if value != "" else None


def row_from_problem(problem, layout_id, angle, deleted=False):
    """A snapshot problem as the `catalog_problems` row the import would write (ROW_COLUMNS)."""
    return {
        "source_catalog_id": problem["id"],
        "layout_id": layout_id,
        "angle": angle,
        "name": problem.get("name") or "",
        "grade": problem.get("grade") or "",
        "user_grade": nullable_text(problem.get("userGrade")),
        "setter": (problem.get("setter") or "").strip(),
        "stars": int(problem.get("stars") or 0),
        "repeats": int(problem.get("repeats") or 0),
        "is_benchmark": bool(problem.get("isBenchmark")),
        "method": nullable_text(problem.get("method")),
        "holds": problem.get("holds") or [],
        "deleted": bool(deleted),
    }


def row_from_live(row):
    """A PostgREST `catalog_problems` row normalized exactly like `row_from_problem`."""
    return {
        "source_catalog_id": row["source_catalog_id"],
        "layout_id": row["layout_id"],
        "angle": row["angle"],
        "name": row.get("name") or "",
        "grade": row.get("grade") or "",
        "user_grade": nullable_text(row.get("user_grade")),
        "setter": (row.get("setter") or "").strip(),
        "stars": int(row.get("stars") or 0),
        "repeats": int(row.get("repeats") or 0),
        "is_benchmark": bool(row.get("is_benchmark")),
        "method": nullable_text(row.get("method")),
        "holds": row.get("holds") or [],
        "deleted": bool(row.get("deleted")),
    }


def problem_from_live(row):
    """A snapshot problem built from a live row — the seed export (boardsesh_uuid = id,
    upstream_last_seen unknown until a fetch returns it)."""
    holds = row.get("holds") or []
    return {
        "id": row["source_catalog_id"],
        "boardsesh_uuid": row["source_catalog_id"],
        "name": row.get("name") or "",
        "grade": row.get("grade") or "",
        "userGrade": nullable_text(row.get("user_grade")),
        "setter": (row.get("setter") or "").strip(),
        "stars": int(row.get("stars") or 0),
        "repeats": int(row.get("repeats") or 0),
        "isBenchmark": bool(row.get("is_benchmark")),
        "method": nullable_text(row.get("method")),
        "holds": holds,
        "hold_key": hold_key(holds),
        "upstream_last_seen": None,
    }


# ── snapshot files ────────────────────────────────────────────────────────────────────

def snapshot_path(data_dir, layout, angle):
    return os.path.join(data_dir, f"{slug_for(layout)}_{angle}.json")


def fetch_path(data_dir, layout, angle):
    return os.path.join(data_dir, UPSTREAM_SUBDIR, f"{slug_for(layout)}_{angle}.json")


def overrides_path(data_dir):
    return os.path.join(data_dir, OVERRIDES_FILE)


def read_snapshot(path):
    with open(path, encoding="utf-8") as f:
        snapshot = json.load(f)
    if "problems" not in snapshot or "layoutId" not in snapshot or "angle" not in snapshot:
        raise ValueError(f"{path} is not a catalog snapshot (needs layoutId, angle, problems)")
    return snapshot


def _ordered_problem(problem):
    extra = set(problem) - set(PROBLEM_KEYS)
    missing = set(PROBLEM_KEYS) - set(problem)
    if extra or missing:
        raise ValueError(f"problem {problem.get('id')!r}: unknown keys {sorted(extra)}, missing {sorted(missing)}")
    return {k: problem[k] for k in PROBLEM_KEYS}


def write_json_atomic(path, text):
    """Write via a sibling temp file and rename, so an interrupted write never leaves a
    truncated file behind."""
    tmp = f"{path}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def write_snapshot(path, snapshot):
    """Write a snapshot in canonical form: header keys in SNAPSHOT_KEYS order, problems sorted
    by id with their keys in PROBLEM_KEYS order, one problem per line. Byte-identical on re-run."""
    problems = sorted((_ordered_problem(p) for p in snapshot["problems"]), key=lambda p: p["id"])
    header = {k: snapshot.get(k) for k in SNAPSHOT_KEYS if k != "problems"}
    header["count"] = len(problems)
    head = json.dumps(header, ensure_ascii=False)
    assert head.endswith("}")
    lines = [head[:-1] + ', "problems": [']
    for i, p in enumerate(problems):
        lines.append(json.dumps(p, ensure_ascii=False) + ("," if i < len(problems) - 1 else ""))
    lines.append("]}")
    write_json_atomic(path, "\n".join(lines) + "\n")


def snapshot_files(data_dir, layout=None, angle=None):
    """Every canonical snapshot in `data_dir` as (path, snapshot), optionally one slab.
    Skips files without a slab header (the overrides file, scratch)."""
    selected = []
    for path in sorted(glob.glob(os.path.join(data_dir, "*.json"))):
        with open(path, encoding="utf-8") as f:
            snapshot = json.load(f)
        if "problems" not in snapshot or "layoutId" not in snapshot:
            continue
        if layout is not None and snapshot.get("layoutId") != layout:
            continue
        if angle is not None and snapshot.get("angle") != angle:
            continue
        selected.append((path, snapshot))
    return selected


# ── overrides ─────────────────────────────────────────────────────────────────────────

class Overrides:
    def __init__(self, retired_ids=(), entries=()):
        self.retired_ids = set(retired_ids)
        self.entries = list(entries)

    def for_slab(self, layout, angle):
        return [e for e in self.entries if e["layout_id"] == layout and e["angle"] == angle]


def load_overrides(path):
    """Read and validate catalog-data/overrides.json; a missing file is an empty overrides set."""
    if not os.path.exists(path):
        return Overrides()
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected an object")
    if "problems" in data and "layoutId" in data:
        raise ValueError(f"{path}: looks like a snapshot slab (has both problems and layoutId)")
    retired = data.get("retired_ids", [])
    if not isinstance(retired, list) or not all(isinstance(x, str) and ID_RE.match(x) for x in retired):
        raise ValueError(f"{path}: retired_ids must be a list of plain id strings")
    entries = data.get("entries", [])
    if not isinstance(entries, list):
        raise ValueError(f"{path}: entries must be a list")
    for i, e in enumerate(entries):
        where = f"{path}: entries[{i}]"
        if not isinstance(e, dict):
            raise ValueError(f"{where}: expected an object")
        action = e.get("action")
        if action not in OVERRIDE_ACTIONS:
            raise ValueError(f"{where}: unknown action {action!r} (one of {sorted(OVERRIDE_ACTIONS)})")
        for key in ("layout_id", "angle"):
            if not isinstance(e.get(key), int):
                raise ValueError(f"{where}: missing integer {key}")
        for key in OVERRIDE_ACTIONS[action]:
            if key not in e:
                raise ValueError(f"{where}: {action} needs {key}")
        for key in ("uuid", "id"):
            if key in e and not (isinstance(e[key], str) and ID_RE.match(e[key])):
                raise ValueError(f"{where}: {key} must be a plain id string")
        if action == "accept_holds" and not re.fullmatch(r"[0-9a-f]{64}", str(e["hold_key"])):
            raise ValueError(f"{where}: hold_key must be a 64-char sha256 hex digest")
        if action == "pin" and e["field"] not in UPSTREAM_FIELDS:
            raise ValueError(f"{where}: can only pin an upstream-owned field {UPSTREAM_FIELDS}")
    return Overrides(retired, entries)


# ── Supabase REST ─────────────────────────────────────────────────────────────────────

def read_credentials(require_service_role=False):
    """(base_url, key, is_service_role) from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or
    SUPABASE_ANON_KEY. Reads work with either key (catalog_problems is public-read); writes
    need the service role."""
    base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("SUPABASE_ANON_KEY")
    if require_service_role and not (base_url and service):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (writes need the service-role key).")
    key = service or anon
    if not base_url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).")
    return base_url, key, bool(service)


def sb_request(url, key, method="GET", body=None, prefer=None, retries=4, timeout=120):
    """One REST request → (parsed JSON or None, Content-Range). Retries 429/502/503 with a
    short backoff; any other HTTP error exits with the status and body."""
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if prefer:
        headers["Prefer"] = prefer
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    for attempt in range(retries):
        try:
            with urlopen(Request(url, data=data, headers=headers, method=method), timeout=timeout) as r:
                raw = r.read()
                payload = json.loads(raw.decode()) if raw else None
                return payload, r.headers.get("Content-Range")
        except HTTPError as e:
            if e.code in (429, 502, 503) and attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            detail = e.read().decode(errors="replace") if e.fp else ""
            sys.exit(f"{method} failed ({e.code}): {detail[:300]}")


def live_rows(base_url, key, layout=None, angle=None, columns=ROW_COLUMNS):
    """Every `catalog_problems` row (tombstones included) for a slab — or the whole table when
    no slab is given — paged by keyset on source_catalog_id past the 1000-row clamp.

    The first request asks for the exact count so the loop stops at the total instead of
    after an extra empty page; a server that ignores `Prefer: count=exact` still terminates
    on the first empty page.
    """
    where = ""
    if layout is not None:
        where += f"&layout_id=eq.{int(layout)}"
    if angle is not None:
        where += f"&angle=eq.{int(angle)}"
    base = (f"{base_url}/rest/v1/catalog_problems?select={','.join(columns)}{where}"
            f"&order=source_catalog_id.asc&limit={PAGE}")
    rows, last, total = [], None, None
    while total is None or len(rows) < total:
        after = f"&source_catalog_id=gt.{last}" if last else ""
        page, content_range = sb_request(base + after, key, prefer=None if last else "count=exact")
        if total is None:
            tail = (content_range or "").rsplit("/", 1)[-1]
            total = int(tail) if tail.isdigit() else None
        if not page:
            break
        rows.extend(page)
        last = page[-1]["source_catalog_id"]
        if not ID_RE.match(last):
            sys.exit(f"refusing to page past an unsafe source_catalog_id: {last!r}")
    return rows


def sb_upsert(base_url, key, rows):
    """Upsert a batch into catalog_problems (merge on the PK). The caller batches."""
    _, _ = sb_request(f"{base_url}/rest/v1/catalog_problems", key, method="POST", body=rows,
                      prefer="resolution=merge-duplicates,return=minimal")
