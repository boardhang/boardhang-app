---
title: Paginate Supabase REST reads — hosted PostgREST silently clamps every response to 1000 rows
date: 2026-09-03
category: docs/solutions/developer-experience
module: Python scripts talking to Supabase REST with the service role (seed_beta_videos.py & co.)
problem_type: developer_experience
component: database
severity: high
applies_when:
  - "A script or job reads 'every row' of a Supabase table over /rest/v1 in one request"
  - "You are sending a big Range header (e.g. Range: 0-99999) and trusting the response to be complete"
  - "A table that used to be small has grown past 1000 rows and a script's logic quietly went wrong"
related_components:
  - database
tags: [supabase, postgrest, pagination, range, content-range, max-rows, scripts, silent-truncation]
---

# Paginate Supabase REST reads — hosted PostgREST silently clamps every response to 1000 rows

## Context

`scripts/seed_beta_videos.py` tops each benchmark problem up to a cap of 6 seed videos. To know
which problems are already at the cap, it fetched *every* row of `problem_beta_videos` in one
request with `Range: 0-99999`, then counted per problem.

The hosted Supabase project runs PostgREST with its default `db-max-rows = 1000`. That setting
**clamps every response to 1000 rows and says nothing about it**: the request returns `200 OK`,
exactly 1000 rows, and `Content-Range: 0-999/*`. No error, no warning. Without an `order=` the
1000 rows you get are arbitrary heap order, so *which* rows go missing can change between runs.

The table crossed 1000 rows during the 2019 Masters top-up (1301 rows at the time). The 301
invisible rows happened to be that board's newest batch, so:

- 68 problems that were truly at the cap looked below it and were re-searched on YouTube, at
  100 quota units each, for nothing;
- the exclusion set (every video id ever stored per problem) was built from the same truncated
  read, so the computed shortfall was wrong and *new* matches were inserted on top of full
  problems — 6 problems ended up with 7 live seed clips;
- the `--revalidate` and `--enrich-pending` modes read the table the same way, so revalidate
  only ever checked the first 1000 live clips for dead videos.

The failure mode is the nasty part: it surfaces as **wrong business logic**, not as an error, and
only once the table is big enough — long after the code was written and tested.

## Guidance

Never read "everything" in one request. Page, in a stable order, and stop on the server's exact
count. `scripts/prune_catalog_orphans.py` (`live_ids`) and `scripts/backup_catalog_problems.py`
already page this way, advancing by the rows returned (they stop on an empty page rather than
asking for the count); `seed_beta_videos.py` now has `sb_get_all`:

```python
PAGE = 1000  # hosted PostgREST's `db-max-rows` — the server clamps EVERY response to this

def sb_get_all(base_url, key, query, order="id.asc"):
    rows, offset, total = [], 0, None
    url = f"{base_url}/rest/v1/{query}&order={order}"
    while total is None or offset < total:
        req = Request(url, headers=_sb_headers(key, {
            "Prefer": "count=exact", "Range-Unit": "items",
            "Range": f"{offset}-{offset + PAGE - 1}"}))
        with urlopen(req, timeout=60) as r:
            batch = json.load(r)
            tail = (r.headers.get("Content-Range") or "").rsplit("/", 1)[-1]
        if tail.isdigit():
            total = int(tail)
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
    return rows
```

(The real helper routes each page through `_sb_get_page`, which retries 429/502/503 with a
short backoff — a paged read is several requests where there used to be one — and exits with the
status and body on anything else.)

The three details that make it correct:

1. **A stable `order=`** (the primary key, or `created_at.asc,id.asc` with a tiebreak). Without
   one, PostgREST's page boundaries aren't stable and rows can repeat or vanish between pages.
2. **`Prefer: count=exact`** so `Content-Range` carries the real total (`0-999/1301`, or `*/0`
   for an empty table). Then the loop ends *at* the total — no trailing empty request, no 416
   from asking past the end.
3. **Advance by `len(batch)`, not by `PAGE`.** If the server ever clamps below your page size,
   the offset still tracks what you actually received.

Test it with a fake server that clamps: `scripts/tests/test_seed_beta_videos.py` has
`_ClampingServer`, a stand-in for `urlopen` that honours `Range` but never returns more than
`clamp` rows per call. It pins that `sb_get_all` reads past the clamp, sends the order/count
headers, stops on the total, and that `seed_state` counts rows that sit beyond the first page.

## Why This Matters

Every service-role script in `scripts/` that reads a table to make a decision (what's already
seeded, what's orphaned, what's dead) is one table-growth away from this bug. The symptom is
never a crash — it's wasted API quota, duplicate or over-cap rows, or a sweep that quietly
skips the tail of the table.

## When to Apply

- Any `urlopen`/`fetch` against `/rest/v1/<table>` whose result feeds a "have we already…"
  decision.
- Reviewing a script: grep for `0-99999` or a lone `Range:` header without a loop.
- Client code is already fine: `web/src/catalog/catalogSync.ts` pages 1000 rows at a time
  (see `docs/catalog-data-pipeline.md`).

## Examples

Verifying the clamp against the live project (read-only):

```python
# 1) real row count
Request(url, headers={..., "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"})
#   → Content-Range: 0-0/1301
# 2) what a single "fetch everything" request actually returns
Request(url, headers={..., "Range-Unit": "items", "Range": "0-99999"})
#   → 200, 1000 rows, Content-Range: 0-999/*
```

## Related

- `docs/catalog-data-pipeline.md` — Gotchas bullet pointing here; the same doc covers how the
  PWA pages the catalog on the client side.
- `scripts/prune_catalog_orphans.py` (`live_ids`) and `scripts/backup_catalog_problems.py` —
  the paging pattern this fix mirrors.
- `docs/plans/2026-07-10-001-feat-web-beta-videos-plan.md` — the top-up seed this bit.
