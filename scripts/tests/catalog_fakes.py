"""Test doubles shared by the catalog pipeline tests (no network, no DB).

`ClampingServer` stands in for hosted PostgREST in front of `catalog_problems`: it honours
PostgREST filters on the URL (`eq.`, `gt.`, `is.`, `in.()`), `order=`, `limit=` and `Range`,
but never returns more than `clamp` rows per response (`db-max-rows`, default 1000) — with a
200, not an error — and reports the total in Content-Range only under `Prefer: count=exact`.
It records every request, applies POST upserts and PATCH updates to its in-memory rows, and
raises injected failures in order so retry paths can be exercised.
"""
import io
import json
import urllib.parse
from urllib.error import HTTPError


class FakeResponse:
    def __init__(self, body, content_range=None, status=200):
        self._body = json.dumps(body).encode() if body is not None else b""
        self.headers = {"Content-Range": content_range} if content_range else {}
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def http_error(code, body=b"busy"):
    return HTTPError("https://x.supabase.co", code, "err", hdrs=None, fp=io.BytesIO(body))


def _matches(row, column, op):
    value = row.get(column)
    if op.startswith("eq."):
        return str(value) == op[3:]
    if op.startswith("gt."):
        return str(value) > op[3:]
    if op.startswith("is."):
        want = {"true": True, "false": False, "null": None}[op[3:]]
        return value is want or value == want
    if op.startswith("in.("):
        wanted = [x.strip('"') for x in op[4:-1].split(",")] if op[4:-1] else []
        return str(value) in wanted
    raise AssertionError(f"unsupported filter {column}={op}")


class ClampingServer:
    """Callable drop-in for `urllib.request.urlopen` over an in-memory `catalog_problems`."""

    def __init__(self, rows, clamp=1000, honour_count=True, failures=()):
        self.rows = [dict(r) for r in rows]
        self.clamp, self.honour_count = clamp, honour_count
        self.failures = list(failures)  # exceptions raised on the next N calls, in order
        self.requests = []              # every Request object, in order
        self.writes = []                # (method, url, body) for POST/PATCH, in order

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        if self.failures:
            raise self.failures.pop(0)
        method = req.get_method()
        if method == "GET":
            return self._get(req)
        body = json.loads(req.data.decode()) if req.data else None
        self.writes.append((method, req.full_url, body))
        if method == "POST":
            return self._upsert(body)
        if method == "PATCH":
            return self._patch(req, body)
        raise AssertionError(f"unsupported method {method}")

    # -- reads -------------------------------------------------------------------------
    def _filtered(self, req):
        parsed = urllib.parse.urlparse(req.full_url)
        params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        rows = list(self.rows)
        order, limit, select = None, None, None
        for column, op in params:
            if column == "select":
                select = op
            elif column == "order":
                order = op
            elif column == "limit":
                limit = int(op)
            elif column == "offset":
                raise AssertionError("offset paging is not supported; page by keyset or Range")
            else:
                rows = [r for r in rows if _matches(r, column, op)]
        if order:
            for term in reversed(order.split(",")):
                column, _, direction = term.partition(".")
                rows.sort(key=lambda r: (r.get(column) is None, r.get(column)), reverse=(direction == "desc"))
        if select and select != "*":
            columns = [c.strip() for c in select.split(",")]
            rows = [{c: r.get(c) for c in columns} for r in rows]
        return rows, limit

    def _get(self, req):
        rows, limit = self._filtered(req)
        total = len(rows)
        lo, hi = 0, None
        if req.get_header("Range"):
            lo, hi = (int(x) for x in req.get_header("Range").split("-"))
        page = rows[lo:]
        if hi is not None:
            page = page[:hi - lo + 1]
        if limit is not None:
            page = page[:limit]
        page = page[:self.clamp]
        exact = self.honour_count and "count=exact" in (req.get_header("Prefer") or "")
        span = f"{lo}-{lo + len(page) - 1}" if page else "*"
        return FakeResponse(page, f"{span}/{total if exact else '*'}")

    # -- writes ------------------------------------------------------------------------
    def _upsert(self, body):
        by_id = {r["source_catalog_id"]: r for r in self.rows}
        for incoming in body:
            row = by_id.get(incoming["source_catalog_id"])
            if row is None:
                row = {"deleted": False}
                self.rows.append(row)
                by_id[incoming["source_catalog_id"]] = row
            row.update(incoming)
        return FakeResponse(None, status=201)

    def _patch(self, req, body):
        rows, _ = self._filtered(req)
        ids = {r["source_catalog_id"] for r in rows}
        for row in self.rows:
            if row["source_catalog_id"] in ids:
                row.update(body)
        return FakeResponse(None, status=204)

    # -- helpers for assertions ----------------------------------------------------------
    def row(self, source_catalog_id):
        return next(r for r in self.rows if r["source_catalog_id"] == source_catalog_id)

    def gets(self):
        return [r for r in self.requests if r.get_method() == "GET"]


def live_row(pid, layout_id=3, angle=40, name="Problem", holds=None, setter="setter", repeats=10,
             grade="6B+", user_grade=None, stars=3, is_benchmark=False, method=None, deleted=False):
    """A `catalog_problems` row as PostgREST returns it."""
    return {"source_catalog_id": pid, "layout_id": layout_id, "angle": angle, "name": name,
            "grade": grade, "user_grade": user_grade, "setter": setter, "stars": stars,
            "repeats": repeats, "is_benchmark": is_benchmark, "method": method,
            "holds": holds if holds is not None else [{"c": 1, "r": 1, "t": "start"}],
            "deleted": deleted}
