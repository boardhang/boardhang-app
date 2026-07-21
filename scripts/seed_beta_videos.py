#!/usr/bin/env python3
"""
Seed `public.problem_beta_videos` with short YouTube "beta" clips for benchmark problems,
so a stuck climber sees how a problem is done. This is the server-side seed half of the
Beta Videos feature (see docs/plans/2026-07-10-001-feat-web-beta-videos-plan.md); user
submissions are a deferred Phase 2.

Pipeline (mirrors import_catalog.py's shape):

    catalog-data/*.json  ->  seed_beta_videos.py  ->  Supabase problem_beta_videos
       (benchmarks)          (YouTube Data API)        (clients read approved rows)

For each benchmark (most-repeated first) it runs one YouTube `search.list`
(`"<name> <board suffix>"`), enriches the top hits with `videos.list` (duration + views),
and keeps the first candidate whose normalized name is a substring of the video title
(the confidence gate validated in the pilots: ~zero wrong matches, misses are just no-match).

Two safety behaviours from the ce-doc-review:
  • Manual-review gate (two conditions to AUTO-APPROVE) — the name is DISTINCTIVE (normalized
    length >= NAME_MIN_SPECIFIC) AND the matched title actually NAMES THE BOARD (every board-
    suffix token — MOONBOARD, the variant, the year — is present). Otherwise the row is held
    `status='pending'` for a human glance. This closes the false-positive the substring gate
    alone allowed: a generic name (e.g. "Send It") matching an unrelated video ("How to send
    it") whose title never mentions the board, and a problem matching the WRONG board's clip.
    Print flags: OK=approved, SML=held (short/generic name), OFF=held (title doesn't name board).
  • Resumable / idempotent — already-seeded problems (source='seed', this board) are fetched
    up front and skipped, so a daily run processes the NEXT --limit unseeded benchmarks and
    picks up where the last left off. That skip is what makes re-runs non-duplicating: each
    batch is all-new problems, so a plain INSERT can't self-conflict. (We can't PostgREST
    `on_conflict` the dedupe index because it's PARTIAL — `…where not deleted` — and Postgres
    won't infer a partial index as an ON CONFLICT arbiter; a stray collision is skipped
    per-row.) On a YouTube quota error (403/429) the run stops cleanly — resume tomorrow.

Boards: seed the DEFAULT board (Mini 2025) first; 2024, 2019 Masters, 2017 Masters, and 2016
are separate runs — pick via `--board`.

Environment
-----------
  YOUTUBE_API_KEY            YouTube Data API v3 key (search costs 100 units; 10k/day free)
  SUPABASE_URL               e.g. https://abcdefgh.supabase.co   (no trailing slash)
  SUPABASE_SERVICE_ROLE_KEY  the project's service_role key (bypasses RLS; never ship it)

Examples
--------
  # seed the next 100 unseeded Mini 2025 benchmarks (default board):
  YOUTUBE_API_KEY=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
      python3 scripts/seed_beta_videos.py --board mini2025 --limit 100

  # dry run (offline: no YouTube calls, no quota, no keys) — preview WHICH benchmarks run:
  python3 scripts/seed_beta_videos.py --board mini2025 --limit 20 --dry-run

  # re-validate stored clips and soft-delete dead ones (freshness / seed-rot cleanup):
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… YOUTUBE_API_KEY=… \
      python3 scripts/seed_beta_videos.py --revalidate

  # Phase 2: fill metadata on USER submissions + print the pending moderation queue:
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… YOUTUBE_API_KEY=… \
      python3 scripts/seed_beta_videos.py --enrich-pending
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
from urllib.request import Request, urlopen
from urllib.error import HTTPError

SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
CANDIDATES = 5          # top-N search hits to consider per problem
NAME_MIN_SPECIFIC = 6   # normalized-name length at/above which a match auto-approves
SHORT_MAX_SECS = 60     # <= this = a "Short"

# Board slug (for the catalog-data filename) + the YouTube query suffix climbers actually type.
# Suffix convention is "moonboard <year>" — the year is what disambiguates on YouTube; climbers
# don't reliably type "masters" even for the Masters boards (matches the 2019 pattern).
BOARDS = {
    "mini2025": ("minimoonboard2025", "moonboard mini 2025"),
    "2024":     ("moonboard2024", "moonboard 2024"),
    "2019":     ("moonboardmasters2019", "moonboard 2019"),
    "2017":     ("moonboardmasters2017", "moonboard 2017"),
    "2016":     ("moonboard2016", "moonboard 2016"),
}


# ── helpers shared with the pilot ────────────────────────────────────────────
def strip_symbols(s):
    """Drop emoji / pictographs so the query is a clean search string."""
    return "".join(c for c in (s or "") if ord(c) < 0x2000).strip()


def norm(s):
    """Uppercase, alphanumerics only — for substring confidence matching."""
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def tokens(s):
    """Normalized alphanumeric word tokens of a string (for token-presence checks)."""
    return [norm(w) for w in re.findall(r"[A-Za-z0-9]+", strip_symbols(s)) if norm(w)]


def title_names_board(title, suffix):
    """True when EVERY board-suffix token (e.g. MOONBOARD, MINI, 2025) appears in the title.
    The board suffix is added to the search QUERY but YouTube ranks loosely, so the top hit can
    be an unrelated video that merely contains the problem name as a substring. Requiring the
    board tokens in the MATCHED title is what rejects those false positives — and stops a
    mini-2025 problem from auto-approving a 2019-board clip (wrong holds = wrong beta)."""
    t = norm(title)
    return all(tok in t for tok in tokens(suffix))


def iso_to_secs(d):
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return None
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s


class QuotaExhausted(Exception):
    """Raised on a YouTube 403/429 so the caller can stop cleanly and resume later."""


def _yt_get(url, params):
    q = urllib.parse.urlencode(params)
    try:
        with urlopen(f"{url}?{q}", timeout=30) as r:
            return json.load(r)
    except HTTPError as e:
        if e.code in (403, 429):
            # A 403 is quota ONLY when the body says so — it also covers keyInvalid /
            # accessNotConfigured / ipRefererBlocked, none of which clear by waiting a day.
            # Misreporting those as "quota, resume tomorrow" sends the operator to wait on a
            # bug that never resolves, so re-raise anything that isn't a rate/quota reason.
            body = e.read().decode(errors="replace")
            if e.code == 429 or "quotaExceeded" in body or "rateLimitExceeded" in body:
                raise QuotaExhausted(body[:300]) from e
            sys.exit(f"YouTube API error {e.code} (not quota): {body[:300]}")
        raise


# ── YouTube ──────────────────────────────────────────────────────────────────
def search(name, suffix, key):
    q = f"{strip_symbols(name)} {suffix}"
    data = _yt_get(SEARCH_URL, {"part": "snippet", "q": q, "type": "video",
                                "maxResults": CANDIDATES, "key": key})
    return q, [{
        "video_id": it["id"]["videoId"],
        "title": it["snippet"]["title"],
        "channel": it["snippet"]["channelTitle"],
    } for it in data.get("items", []) if it["id"].get("videoId")]


def _video_metrics(it):
    """duration_s / is_short / views from one videos.list item. Shared by the seed enrich() and the
    user-submission fetch_video_meta() so Short-detection and view-count handling can't drift."""
    secs = iso_to_secs(it.get("contentDetails", {}).get("duration"))
    return {
        "duration_s": secs,
        "is_short": secs is not None and secs <= SHORT_MAX_SECS,
        "views": int(it.get("statistics", {}).get("viewCount") or 0),
    }


def enrich(cands, key):
    """Attach duration + views (one videos.list call for the whole candidate batch)."""
    if not cands:
        return cands
    ids = ",".join(c["video_id"] for c in cands)
    meta = {it["id"]: it for it in _yt_get(
        VIDEOS_URL, {"part": "contentDetails,statistics", "id": ids, "key": key}
    ).get("items", [])}
    for c in cands:
        c.update(_video_metrics(meta.get(c["video_id"], {})))
    return cands


def fetch_video_meta(video_ids, key):
    """title + channel + views + duration for a list of video_ids (videos.list, 50 ids / 1 unit).
    Unlike enrich() this requests `snippet` too — snippet carries channelTitle/title, which the
    user-submission enrich pass (--enrich-pending) must write and which enrich() (contentDetails,
    statistics only) never fetched. Returns {video_id: {title, channel, views, duration_s,
    is_short}} for ids YouTube still returns; a removed/private id is simply absent."""
    meta = {}
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i:i + 50]
        got = _yt_get(VIDEOS_URL, {"part": "snippet,contentDetails,statistics",
                                   "id": ",".join(chunk), "key": key})
        for it in got.get("items", []):
            m = _video_metrics(it)
            m["title"] = it.get("snippet", {}).get("title", "")
            m["channel"] = it.get("snippet", {}).get("channelTitle", "")
            meta[it["id"]] = m
    return meta


def pick_match(name, cands):
    """First candidate whose normalized name is a substring of its title, else None."""
    nkey = norm(strip_symbols(name))
    if not nkey:
        return None
    for c in cands:
        if nkey in norm(c["title"]):
            return c
    return None


# ── Supabase (service role) ──────────────────────────────────────────────────
def _sb_headers(key, extra=None):
    h = {"Content-Type": "application/json", "apikey": key, "Authorization": f"Bearer {key}"}
    if extra:
        h.update(extra)
    return h


def seeded_ids(base_url, key):
    """source_catalog_ids already seeded (source='seed') — the resumable checkpoint."""
    url = (f"{base_url}/rest/v1/problem_beta_videos"
           f"?select=source_catalog_id&source=eq.seed")
    req = Request(url, headers=_sb_headers(key, {"Range-Unit": "items", "Range": "0-99999"}))
    with urlopen(req, timeout=60) as r:
        return {row["source_catalog_id"] for row in json.load(r)}


def _insert(url, key, payload):
    req = Request(url, data=json.dumps(payload).encode(),
                  headers=_sb_headers(key, {"Prefer": "return=minimal"}), method="POST")
    return urlopen(req, timeout=120)


def insert_rows(base_url, key, rows):
    """Insert this run's matched rows. Idempotency across runs comes from the seeded_ids()
    skip (already-seeded problems are filtered out before we get here), so the batch is all-new
    problems and never self-conflicts. We deliberately DON'T PostgREST-`on_conflict` the dedupe
    index: it's PARTIAL (`…where not deleted`), and Postgres won't infer a partial index as an
    ON CONFLICT arbiter (that's the 42P10 error). If the batch does hit a live duplicate (e.g. a
    re-run racing a prior partial write), fall back to per-row inserts and skip the 409s so the
    run still makes progress. Returns the number of rows actually written."""
    url = f"{base_url}/rest/v1/problem_beta_videos"
    try:
        with _insert(url, key, rows):
            return len(rows)
    except HTTPError as e:
        if e.code != 409:
            sys.exit(f"Insert failed ({e.code}): {e.read().decode(errors='replace')}")
    # Batch hit an existing live clip — retry row-by-row, skipping the duplicates.
    written = 0
    for row in rows:
        try:
            with _insert(url, key, [row]):
                written += 1
        except HTTPError as e:
            if e.code == 409:
                continue  # already-present live clip — skip
            sys.exit(f"Insert failed ({e.code}): {e.read().decode(errors='replace')}")
    return written


# ── modes ────────────────────────────────────────────────────────────────────
def board_file(slug, angle, catalog_dir):
    return os.path.join(catalog_dir, f"{slug}_{angle}.json")


def run_seed(args, yt_key, base_url, sb_key):
    slug, suffix = BOARDS[args.board]
    path = board_file(slug, args.angle, os.path.abspath(args.dir))
    if not os.path.exists(path):
        sys.exit(f"No catalog file: {path}")

    benchmarks = [p for p in json.load(open(path))["problems"] if p.get("isBenchmark")]
    benchmarks.sort(key=lambda p: p.get("repeats", 0), reverse=True)

    # A real run always reads the seeded checkpoint. A dry run reads it too WHEN Supabase creds
    # are present (so the preview reflects the true next batch), but falls back to the full list
    # when they're absent — keeping dry-run usable with no keys at all.
    read_db = bool(base_url and sb_key)  # a dry run with no creds skips the DB read entirely
    done = seeded_ids(base_url, sb_key) if (read_db or not args.dry_run) else set()
    todo = [p for p in benchmarks if p["id"] not in done][:args.limit]
    print(f"{args.board} @{args.angle}°: {len(benchmarks)} benchmarks, "
          f"{len(done)} already seeded → processing next {len(todo)} (limit {args.limit})")

    if args.dry_run:
        # Offline preview — no YouTube calls (so zero quota) and no writes. Shows WHICH benchmarks
        # would be fetched, most-repeated first; can't show real video matches without the API.
        note = ("already-seeded excluded via DB" if read_db
                else "no DB creds → not excluding already-seeded")
        print(f"[dry-run] would fetch YouTube betas for these benchmarks "
              f"(no API calls, no quota, no writes; {note}):")
        for i, p in enumerate(todo, 1):
            print(f"  {i:>3}. {p.get('repeats', 0):>5}×  {(p.get('name') or '')[:50]}")
        return

    rows, approved, pending, missed = [], 0, 0, 0
    try:
        for i, p in enumerate(todo, 1):
            name = p.get("name") or ""
            _, cands = search(name, suffix, yt_key)
            best = pick_match(name, enrich(cands, yt_key))
            if not best:
                missed += 1
                print(f"  {i:>3}. ——   {name[:40]}  (no confident match)")
                continue
            # Manual-review gate: auto-approve ONLY a DISTINCTIVE name (not short/generic) whose
            # matched title actually NAMES THIS BOARD. A short name, or a match on a title that
            # doesn't mention the board, is held `pending` for a human glance rather than
            # published live — the substring match alone is too weak to trust in those cases.
            distinctive = len(norm(strip_symbols(name))) >= NAME_MIN_SPECIFIC
            on_board = title_names_board(best["title"], suffix)
            status = "approved" if (distinctive and on_board) else "pending"
            approved += status == "approved"
            pending += status == "pending"
            rows.append({
                "source_catalog_id": p["id"], "provider": "youtube",
                "video_id": best["video_id"], "title": best["title"],
                "channel": best["channel"], "duration_s": best["duration_s"],
                "is_short": best["is_short"], "views": best["views"],
                "source": "seed", "status": status,
            })
            if status == "approved":
                flag = "OK "
            else:
                flag = "REV" if distinctive else "SML"  # SML = held on a short/generic name
                if distinctive and not on_board:
                    flag = "OFF"  # OFF = matched a title that doesn't name the board
            print(f"  {i:>3}. {flag}  {name[:40]:40} → {best['title'][:44]}")
    except QuotaExhausted as e:
        print(f"\n⚠️  YouTube quota exhausted — stopping cleanly, resume tomorrow. ({e})")

    print(f"\nMatched {len(rows)} ({approved} approved, {pending} held for review), "
          f"{missed} no-match.")
    if not rows:
        return

    # Persist the matched rows BEFORE writing — the YouTube search that produced them is the
    # expensive, quota-limited step, so an insert failure (or a quota stop mid-run) must never
    # throw it away. Reinsert any time with `--from-file <path>` at zero quota.
    cache = os.path.join(os.path.dirname(os.path.abspath(path)), f".beta_matches_{args.board}.json")
    with open(cache, "w") as f:
        json.dump(rows, f, indent=2)
    print(f"Saved {len(rows)} matched rows → {cache}  (reinsert with --from-file if this write fails)")

    n = insert_rows(base_url, sb_key, rows)
    print(f"Inserted {n} beta rows.")


def run_from_file(args, base_url, sb_key):
    """Insert previously-matched rows from a sidecar JSON (written by a prior run). No YouTube
    calls — this is the zero-quota recovery path when a seed matched but the write failed."""
    if not os.path.exists(args.from_file):
        sys.exit(f"No such sidecar file: {args.from_file}")
    rows = json.load(open(args.from_file))
    print(f"Loaded {len(rows)} matched rows from {args.from_file}")
    if not rows:
        return
    n = insert_rows(base_url, sb_key, rows)
    print(f"Inserted {n} beta rows.")


def run_revalidate(args, yt_key, base_url, sb_key):
    """Fetch stored video_ids, check they still exist on YouTube, soft-delete dead ones."""
    url = (f"{base_url}/rest/v1/problem_beta_videos"
           f"?select=id,video_id&provider=eq.youtube&deleted=eq.false")
    req = Request(url, headers=_sb_headers(sb_key, {"Range-Unit": "items", "Range": "0-99999"}))
    with urlopen(req, timeout=60) as r:
        stored = json.load(r)
    print(f"Re-validating {len(stored)} stored clips…")

    alive, dead = set(), []
    try:
        for i in range(0, len(stored), 50):  # videos.list takes up to 50 ids / 1 unit
            chunk = stored[i:i + 50]
            got = _yt_get(VIDEOS_URL, {"part": "id",
                                       "id": ",".join(c["video_id"] for c in chunk),
                                       "key": yt_key})
            alive |= {it["id"] for it in got.get("items", [])}
    except QuotaExhausted as e:
        sys.exit(f"Quota exhausted during revalidate: {e}")
    dead = [c for c in stored if c["video_id"] not in alive]

    print(f"{len(dead)} dead clip(s).")
    if not dead or args.dry_run:
        print("[dry-run] not soft-deleting." if args.dry_run and dead else "Nothing to do.")
        return
    done = 0
    for c in dead:  # soft-delete each dead row by id
        u = f"{base_url}/rest/v1/problem_beta_videos?id=eq.{urllib.parse.quote(str(c['id']))}"
        req = Request(u, data=json.dumps({"deleted": True}).encode(),
                      headers=_sb_headers(sb_key, {"Prefer": "return=minimal"}), method="PATCH")
        try:
            with urlopen(req, timeout=30):  # context-manage so the connection is released
                done += 1
        except HTTPError as e:  # one bad PATCH shouldn't abort the whole sweep
            print(f"  ! soft-delete failed for {c['id']} ({e.code}); continuing")
    print(f"Soft-deleted {done}/{len(dead)} dead clips.")


def _patch_row(base_url, key, row_id, payload):
    u = f"{base_url}/rest/v1/problem_beta_videos?id=eq.{urllib.parse.quote(str(row_id))}"
    req = Request(u, data=json.dumps(payload).encode(),
                  headers=_sb_headers(key, {"Prefer": "return=minimal"}), method="PATCH")
    with urlopen(req, timeout=30):
        pass


def _fmt_dur(secs):
    return "  ?  " if secs is None else f"{secs // 60}:{secs % 60:02d}"


def run_enrich_pending(args, yt_key, base_url, sb_key):
    """Fill title/channel/views/duration_s/is_short on USER submissions from the YouTube API
    (server-side — the key never ships to the client, so this is how a user row gets its metadata).
    Selects rows still missing metadata, including `approved`-but-blank ones so an out-of-order
    approve (owner flipped status before enriching) is still repairable — not just `pending`.
    Does NOT approve; approval stays a manual dashboard action. Then prints the pending moderation
    queue (the authoritative reconciliation list, independent of the notification), flagging
    non-Shorts so a long compilation is a one-glance reject.

    The "needs enrichment" signal is `channel = ''` ONLY — a successful videos.list always returns
    a channelTitle, so a fetched row is done. We deliberately do NOT re-select on
    `duration_s is null`: a live stream / premiere legitimately has no duration, and filtering on
    it would re-fetch that row (burning a quota unit) on every run forever without ever clearing."""
    q = ("?select=id,source_catalog_id,video_id,status"
         "&source=eq.user&deleted=eq.false&status=in.(pending,approved)"
         "&channel=eq.")
    req = Request(f"{base_url}/rest/v1/problem_beta_videos{q}",
                  headers=_sb_headers(sb_key, {"Range-Unit": "items", "Range": "0-99999"}))
    with urlopen(req, timeout=60) as r:
        rows = json.load(r)
    print(f"{len(rows)} user submission(s) need enrichment.")

    if rows and args.dry_run:
        print("[dry-run] would enrich these (no API calls, no writes):")
        for c in rows:
            print(f"  {c['status']:8} {c['video_id']}  (problem {c['source_catalog_id']})")
    elif rows:
        try:
            meta = fetch_video_meta([c["video_id"] for c in rows], yt_key)
        except QuotaExhausted as e:
            sys.exit(f"Quota exhausted during enrich: {e}")
        filled = skipped = 0
        for c in rows:
            m = meta.get(c["video_id"])
            if not m:  # removed/private video — leave untouched, report it
                skipped += 1
                print(f"  ! {c['video_id']} not returned by YouTube (removed/private?) — skipped")
                continue
            _patch_row(base_url, sb_key, c["id"], m)
            filled += 1
        print(f"Enriched {filled} row(s); {skipped} skipped (video gone).")

    # Reconciliation list: every pending user clip awaiting a moderation decision. This — not the
    # submission notification — is the authoritative "what's waiting for me" surface.
    pq = ("?select=source_catalog_id,video_id,channel,duration_s,is_short"
          "&source=eq.user&status=eq.pending&deleted=eq.false&order=created_at.asc")
    req = Request(f"{base_url}/rest/v1/problem_beta_videos{pq}",
                  headers=_sb_headers(sb_key, {"Range-Unit": "items", "Range": "0-99999"}))
    with urlopen(req, timeout=60) as r:
        pending = json.load(r)
    print(f"\n── Pending moderation queue: {len(pending)} clip(s) ──")
    for c in pending:
        flag = "" if c.get("is_short") else "  ⚠ non-Short"
        chan = c.get("channel") or "(unenriched)"
        print(f"  {_fmt_dur(c.get('duration_s'))}  {c['video_id']}  {chan[:30]:30}"
              f"  prob {c['source_catalog_id']}{flag}")
    if pending:
        print("Approve:  update problem_beta_videos set status='approved' where id='<id>';")
        print("Reject :  update problem_beta_videos set status='rejected', deleted=true where id='<id>';")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", choices=sorted(BOARDS), default="mini2025",
                    help="which board to seed (default: mini2025 — the app default)")
    ap.add_argument("--angle", type=int, choices=(25, 40), default=40)
    ap.add_argument("--limit", type=int, default=100, help="max problems to process this run")
    ap.add_argument("--dir", default=os.path.join(os.path.dirname(__file__), "..", "catalog-data"))
    ap.add_argument("--dry-run", action="store_true", help="no Supabase writes")
    ap.add_argument("--revalidate", action="store_true",
                    help="check stored clips still exist; soft-delete dead ones")
    ap.add_argument("--enrich-pending", action="store_true",
                    help="fill title/channel/views/duration on user submissions (server-side) "
                         "and print the pending moderation queue")
    ap.add_argument("--from-file", metavar="PATH",
                    help="insert previously-matched rows from a sidecar JSON (zero-quota "
                         "recovery after a failed write); no YouTube calls")
    args = ap.parse_args()

    # --from-file is an insert-only recovery path: needs Supabase creds, no YouTube key.
    needs_yt = not args.dry_run and not args.from_file
    yt_key = os.environ.get("YOUTUBE_API_KEY")
    if needs_yt and not yt_key:
        # A dry run is offline, and --from-file re-inserts saved rows — neither hits YouTube.
        sys.exit("Set YOUTUBE_API_KEY in the environment (or pass --dry-run / --from-file).")
    base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    # --enrich-pending always reads the DB (even --dry-run, which just previews the queue).
    db_needed = not args.dry_run or args.enrich_pending
    if db_needed and (not base_url or not sb_key):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --dry-run).")

    if args.from_file:
        run_from_file(args, base_url, sb_key)
    elif args.enrich_pending:
        run_enrich_pending(args, yt_key, base_url, sb_key)
    elif args.revalidate:
        run_revalidate(args, yt_key, base_url, sb_key)
    else:
        run_seed(args, yt_key, base_url, sb_key)


if __name__ == "__main__":
    main()
