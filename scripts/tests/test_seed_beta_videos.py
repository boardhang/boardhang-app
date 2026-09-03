"""Unit tests for the pure top-up logic in seed_beta_videos.py (no network, no DB).

Run:  python3 scripts/tests/test_seed_beta_videos.py
"""
import importlib.util
import io
import json
import pathlib
import unittest
from unittest import mock
from urllib.error import HTTPError

_SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "seed_beta_videos.py"
_spec = importlib.util.spec_from_file_location("seed_beta_videos", _SCRIPT)
seed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed)


def cand(vid, title):
    return {"video_id": vid, "title": title}


class PickMatchesTest(unittest.TestCase):
    def test_returns_all_matches_in_order(self):
        cands = [
            cand("a", "SLABBY GABBY moonboard mini 2025"),
            cand("b", "unrelated crimp ladder"),
            cand("c", "slabby gabby repeat!"),
            cand("d", "Slabby Gabby 6C+ benchmark"),
        ]
        got = seed.pick_matches("Slabby Gabby", cands)
        self.assertEqual([c["video_id"] for c in got], ["a", "c", "d"])

    def test_no_match_returns_empty(self):
        self.assertEqual(seed.pick_matches("Slabby Gabby", [cand("a", "something else")]), [])

    def test_blank_or_symbol_only_name_matches_nothing(self):
        cands = [cand("a", "anything")]
        self.assertEqual(seed.pick_matches("", cands), [])
        self.assertEqual(seed.pick_matches("☺☺", cands), [])


class SelectNewTest(unittest.TestCase):
    MATCHES = [cand(v, f"title {v}") for v in ("a", "b", "c", "d")]

    def test_excludes_seen_ids(self):
        got = seed.select_new(self.MATCHES, {"a", "c"}, 6)
        self.assertEqual([c["video_id"] for c in got], ["b", "d"])

    def test_caps_at_need(self):
        got = seed.select_new(self.MATCHES, set(), 2)
        self.assertEqual([c["video_id"] for c in got], ["a", "b"])

    def test_skips_in_batch_duplicates(self):
        matches = [cand("a", "t1"), cand("a", "t2"), cand("b", "t3")]
        got = seed.select_new(matches, set(), 6)
        self.assertEqual([c["video_id"] for c in got], ["a", "b"])

    def test_returns_fewer_when_not_enough(self):
        self.assertEqual(len(seed.select_new(self.MATCHES, set(), 10)), 4)

    def test_zero_need_returns_nothing(self):
        self.assertEqual(seed.select_new(self.MATCHES, set(), 0), [])


class AggregateSeedStateTest(unittest.TestCase):
    def row(self, pid, vid, source="seed", deleted=False):
        return {"source_catalog_id": pid, "video_id": vid, "source": source, "deleted": deleted}

    def test_live_counts_seed_rows_only(self):
        live, _ = seed.aggregate_seed_state([
            self.row("p1", "a"),
            self.row("p1", "b"),
            self.row("p1", "c", deleted=True),          # deleted seed: frees its slot
            self.row("p1", "d", source="user"),          # user rows never count toward the cap
            self.row("p2", "e"),
        ])
        self.assertEqual(live, {"p1": 2, "p2": 1})

    def test_seen_includes_every_source_and_deleted_state(self):
        _, seen = seed.aggregate_seed_state([
            self.row("p1", "a"),
            self.row("p1", "b", deleted=True),           # moderator-removed: excluded forever
            self.row("p1", "c", source="user"),          # user-added: never re-seeded
            self.row("p1", "d", source="user", deleted=True),  # rejected: excluded forever
            self.row("p2", "a"),                         # same video on another problem is fine
        ])
        self.assertEqual(seen, {"p1": {"a", "b", "c", "d"}, "p2": {"a"}})

    def test_empty_db(self):
        self.assertEqual(seed.aggregate_seed_state([]), ({}, {}))


class TopUpSpecTest(unittest.TestCase):
    """Pin the top-up semantics end-to-end over the pure pieces: a deleted clip frees its
    slot for a DIFFERENT video, but can never itself return."""

    def test_deleted_slot_refills_with_new_video_only(self):
        live, seen = seed.aggregate_seed_state([
            {"source_catalog_id": "p1", "video_id": v, "source": "seed", "deleted": False}
            for v in ("v1", "v2", "v3", "v4", "v5")
        ] + [{"source_catalog_id": "p1", "video_id": "bad", "source": "seed", "deleted": True}])
        need = seed.PER_PROBLEM_CAP - live.get("p1", 0)
        self.assertEqual(need, 1)  # 5 live + 1 deleted → one open slot
        matches = [cand("bad", "the removed clip resurfaces"), cand("v6", "a fresh clip")]
        got = seed.select_new(matches, seen.get("p1", set()), need)
        self.assertEqual([c["video_id"] for c in got], ["v6"])


class _FakeResponse:
    def __init__(self, body, content_range):
        self._body = json.dumps(body).encode()
        self.headers = {"Content-Range": content_range}

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _ClampingServer:
    """Stands in for hosted PostgREST: honours `Range` but never returns more than `clamp` rows
    per response (`db-max-rows`, default 1000) — with a 200, not an error — and reports the
    total in Content-Range only under `Prefer: count=exact` (otherwise `/*`)."""

    def __init__(self, rows, clamp=1000, honour_count=True, failures=()):
        self.rows, self.clamp, self.requests = rows, clamp, []
        self.honour_count = honour_count  # False = a server that ignores Prefer: count=exact
        self.failures = list(failures)    # exceptions to raise on the first N calls, in order

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        if self.failures:
            raise self.failures.pop(0)
        lo, hi = (int(x) for x in req.get_header("Range").split("-"))
        page = self.rows[lo:min(hi, lo + self.clamp - 1) + 1]
        exact = self.honour_count and "count=exact" in (req.get_header("Prefer") or "")
        total = str(len(self.rows)) if exact else "*"
        span = f"{lo}-{lo + len(page) - 1}" if page else "*"
        return _FakeResponse(page, f"{span}/{total}")


def _http_error(code):
    return HTTPError("https://x.supabase.co", code, "err", hdrs=None, fp=io.BytesIO(b"busy"))


class SbGetAllTest(unittest.TestCase):
    """Hosted PostgREST clamps every response to db-max-rows (1000) SILENTLY, so a 'fetch
    everything' read must page. This is the bug that made at-cap problems look below the cap
    (and get re-searched + topped up past it) once problem_beta_videos passed 1000 rows."""

    def rows(self, n):
        return [{"id": f"{i:05d}", "video_id": f"v{i}"} for i in range(n)]

    def fetch(self, n, clamp=1000):
        server = _ClampingServer(self.rows(n), clamp)
        with mock.patch.object(seed, "urlopen", server):
            got = seed.sb_get_all("https://x.supabase.co", "k",
                                  "problem_beta_videos?select=id,video_id")
        return got, server

    def test_reads_past_the_server_clamp(self):
        got, server = self.fetch(2501)
        self.assertEqual(got, self.rows(2501))
        self.assertEqual(len(server.requests), 3)  # 1000 + 1000 + 501

    def test_requests_are_ordered_and_counted(self):
        _, server = self.fetch(5)
        req = server.requests[0]
        self.assertTrue(req.full_url.endswith("&order=id.asc"))  # stable paging order
        self.assertEqual(req.get_header("Prefer"), "count=exact")
        self.assertEqual(req.get_header("Range"), "0-999")

    def test_stops_on_total_without_a_trailing_empty_request(self):
        got, server = self.fetch(1000)
        self.assertEqual(len(got), 1000)
        self.assertEqual(len(server.requests), 1)

    def test_advances_by_rows_returned_when_clamped_below_page(self):
        got, server = self.fetch(7, clamp=3)
        self.assertEqual(got, self.rows(7))
        self.assertEqual([r.get_header("Range") for r in server.requests],
                         ["0-999", "3-1002", "6-1005"])

    def test_empty_table(self):
        got, server = self.fetch(0)
        self.assertEqual(got, [])
        self.assertEqual(len(server.requests), 1)

    def test_pages_to_an_empty_page_when_the_server_reports_no_count(self):
        # A server that ignores Prefer: count=exact answers `…/*`; the loop must still read
        # everything and stop on the first empty page (one extra request).
        server = _ClampingServer(self.rows(2501), honour_count=False)
        with mock.patch.object(seed, "urlopen", server):
            got = seed.sb_get_all("https://x.supabase.co", "k", "problem_beta_videos?select=id")
        self.assertEqual(got, self.rows(2501))
        self.assertEqual(len(server.requests), 4)  # 1000 + 1000 + 501 + empty

    def test_retries_a_transient_page_error(self):
        server = _ClampingServer(self.rows(3), failures=[_http_error(503)])
        with mock.patch.object(seed, "urlopen", server), \
                mock.patch.object(seed.time, "sleep") as sleep:
            got = seed.sb_get_all("https://x.supabase.co", "k", "problem_beta_videos?select=id")
        self.assertEqual(got, self.rows(3))
        self.assertEqual(len(server.requests), 2)  # the failed attempt + the retry
        sleep.assert_called_once()

    def test_exits_on_a_non_transient_page_error(self):
        server = _ClampingServer(self.rows(3), failures=[_http_error(500)])
        with mock.patch.object(seed, "urlopen", server), self.assertRaises(SystemExit):
            seed.sb_get_all("https://x.supabase.co", "k", "problem_beta_videos?select=id")
        self.assertEqual(len(server.requests), 1)  # no retry on a non-transient status

    def test_order_override_reaches_the_request(self):
        server = _ClampingServer(self.rows(1))
        with mock.patch.object(seed, "urlopen", server):
            seed.sb_get_all("https://x.supabase.co", "k", "problem_beta_videos?select=id",
                            order="created_at.asc,id.asc")
        self.assertTrue(server.requests[0].full_url.endswith("&order=created_at.asc,id.asc"))

    def test_seed_state_counts_rows_beyond_the_first_page(self):
        # 1000 one-video problems, then a 6-video one — exactly what the clamp hid.
        rows = [{"id": f"0{i:04d}", "source_catalog_id": f"p{i}", "video_id": f"v{i}",
                 "source": "seed", "deleted": False} for i in range(1000)]
        rows += [{"id": f"1{i:04d}", "source_catalog_id": "full", "video_id": f"f{i}",
                  "source": "seed", "deleted": False} for i in range(seed.PER_PROBLEM_CAP)]
        with mock.patch.object(seed, "urlopen", _ClampingServer(rows)):
            live, seen = seed.seed_state("https://x.supabase.co", "k")
        self.assertEqual(live["full"], seed.PER_PROBLEM_CAP)
        self.assertEqual(seen["full"], {f"f{i}" for i in range(seed.PER_PROBLEM_CAP)})


if __name__ == "__main__":
    unittest.main()
