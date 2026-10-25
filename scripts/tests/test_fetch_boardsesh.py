"""Unit tests for scripts/fetch_boardsesh.py — the boardsesh feed fetch (no network).

Run:  python3 scripts/tests/test_fetch_boardsesh.py
"""
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock
from urllib.error import HTTPError, URLError

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("fetch_boardsesh", _SCRIPTS / "fetch_boardsesh.py")
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)
lib = mod.lib

PROBLEM_KEYS = ["uuid", "name", "grade", "userGrade", "setter", "stars", "repeats",
                "isBenchmark", "method", "holds"]
HEADER_KEYS = ["fetched_at", "layoutId", "angle", "setIds", "total_count", "count", "problems"]


def climb(uuid="u1", name="Crimpy", frames="p45r43p124r44p62r42", **over):
    c = {"uuid": uuid, "name": name, "difficulty": "6b+/V4", "benchmark_difficulty": None,
         "stars": 3.0, "ascensionist_count": 12, "setter_username": "setter",
         "frames": frames, "characteristics": []}
    c.update(over)
    return c


def page(climbs, total, has_more):
    return {"searchClimbs": {"totalCount": total, "hasMore": has_more, "climbs": climbs}}


class NormalizeTest(unittest.TestCase):
    def test_frames_decode_to_columns_rows_and_types(self):
        p = mod.normalize(climb(frames="p45r43p124r44p62r42"))
        self.assertEqual(p["holds"], [
            {"c": 0, "r": 5, "t": "right"},    # hold 45: (45-1)%11=0, (45-1)//11+1=5
            {"c": 2, "r": 12, "t": "end"},     # hold 124
            {"c": 6, "r": 6, "t": "start"},    # hold 62
        ])

    def test_unknown_role_falls_back_to_right(self):
        self.assertEqual(mod.normalize(climb(frames="p1r99"))["holds"], [{"c": 0, "r": 1, "t": "right"}])

    def test_no_frames_is_dropped(self):
        self.assertIsNone(mod.normalize(climb(frames="")))
        self.assertIsNone(mod.normalize(climb(frames=None)))

    def test_empty_name_becomes_untitled(self):
        self.assertEqual(mod.normalize(climb(name=""))["name"], "Untitled")
        self.assertEqual(mod.normalize(climb(name=None))["name"], "Untitled")

    def test_setter_is_stripped(self):
        self.assertEqual(mod.normalize(climb(setter_username="Avien "))["setter"], "Avien")
        self.assertEqual(mod.normalize(climb(setter_username=None))["setter"], "")

    def test_benchmark_difficulty_marks_a_benchmark(self):
        self.assertTrue(mod.normalize(climb(benchmark_difficulty="6b+/V4"))["isBenchmark"])
        self.assertFalse(mod.normalize(climb(benchmark_difficulty=None))["isBenchmark"])
        self.assertFalse(mod.normalize(climb(benchmark_difficulty="  "))["isBenchmark"])

    def test_method_characteristic_maps_to_label(self):
        self.assertEqual(mod.normalize(climb(characteristics=["method_no_kickboard"]))["method"], "No kickboard")
        self.assertEqual(mod.normalize(climb(characteristics=["other", "method_footless"]))["method"], "Footless")
        self.assertIsNone(mod.normalize(climb(characteristics=[]))["method"])
        self.assertIsNone(mod.normalize(climb(characteristics=None))["method"])

    def test_grade_label_table_and_fallback(self):
        self.assertEqual(mod.normalize(climb(difficulty="6a+/V3"))["grade"], "6A+")
        self.assertEqual(mod.normalize(climb(difficulty="5a/V1"))["grade"], "5+")
        self.assertEqual(mod.normalize(climb(difficulty="9a/V17"))["grade"], "9A")
        self.assertEqual(mod.normalize(climb(difficulty=" 6a+/V3 "))["grade"], "6A+")
        self.assertEqual(mod.normalize(climb(difficulty=None))["grade"], "")

    def test_stars_are_rounded_ints(self):
        p = mod.normalize(climb(stars=4.6))
        self.assertEqual(p["stars"], 5)
        self.assertIsInstance(p["stars"], int)
        self.assertEqual(mod.normalize(climb(stars=None))["stars"], 0)

    def test_repeats_default_to_zero(self):
        self.assertEqual(mod.normalize(climb(ascensionist_count=None))["repeats"], 0)

    def test_problem_keys_in_order_with_boardsesh_uuid_under_uuid(self):
        p = mod.normalize(climb(uuid="abc"))
        self.assertEqual(list(p), PROBLEM_KEYS)
        self.assertEqual(p["uuid"], "abc")
        self.assertNotIn("id", p)
        self.assertIsNone(p["userGrade"])


class FetchSlabTest(unittest.TestCase):
    def setUp(self):
        self.sleep = mock.patch.object(mod.time, "sleep").start()
        self.addCleanup(mock.patch.stopall)

    def test_pages_until_has_more_is_false_and_reports_first_page_total(self):
        pages = [page([climb("b"), climb("a")], 250, True),
                 page([climb("c")], 999, False)]
        with mock.patch.object(mod, "gql", side_effect=pages) as gql, redirect_stdout(io.StringIO()):
            total, problems = mod.fetch_slab(7, 40, "28,29,30,31", delay=0.5)
        self.assertEqual(total, 250)
        self.assertEqual([p["uuid"] for p in problems], ["a", "b", "c"])  # sorted by uuid
        inputs = [call.args[0]["i"] for call in gql.call_args_list]
        self.assertEqual([i["page"] for i in inputs], [0, 1])
        self.assertEqual(inputs[0]["layoutId"], 7)
        self.assertEqual(inputs[0]["angle"], 40)
        self.assertEqual(inputs[0]["setIds"], "28,29,30,31")
        self.assertEqual(inputs[0]["pageSize"], mod.PAGE_SIZE)
        for key in ("minAscents", "onlyBenchmarks"):
            self.assertNotIn(key, inputs[0])
        self.sleep.assert_called_once_with(0.5)

    def test_uuid_repeated_across_pages_is_written_once(self):
        pages = [page([climb("a", ascensionist_count=1)], 3, True),
                 page([climb("a", ascensionist_count=2), climb("b")], 3, False)]
        with mock.patch.object(mod, "gql", side_effect=pages), redirect_stdout(io.StringIO()):
            _, problems = mod.fetch_slab(7, 40, "28", delay=0)
        self.assertEqual([p["uuid"] for p in problems], ["a", "b"])
        self.assertEqual(problems[0]["repeats"], 1)  # first occurrence wins

    def test_holdless_climbs_are_dropped_from_count(self):
        pages = [page([climb("a", frames=""), climb("b")], 2, False)]
        with mock.patch.object(mod, "gql", side_effect=pages), redirect_stdout(io.StringIO()):
            total, problems = mod.fetch_slab(7, 40, "28", delay=0)
        self.assertEqual(total, 2)
        self.assertEqual([p["uuid"] for p in problems], ["b"])

    def test_empty_page_stops_the_loop(self):
        pages = [page([], 0, True)]
        with mock.patch.object(mod, "gql", side_effect=pages), redirect_stdout(io.StringIO()):
            total, problems = mod.fetch_slab(7, 40, "28", delay=0)
        self.assertEqual((total, problems), (0, []))


class FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class GqlRetryTest(unittest.TestCase):
    OK = {"data": {"searchClimbs": {"totalCount": 0, "hasMore": False, "climbs": []}}}

    def setUp(self):
        self.sleep = mock.patch.object(mod.time, "sleep").start()
        self.addCleanup(mock.patch.stopall)

    def run_gql(self, outcomes, retries=4):
        """Each outcome is an exception to raise or a payload to return."""
        self.calls = 0

        def fake_urlopen(*args, **kwargs):
            outcome = outcomes[self.calls]
            self.calls += 1
            if isinstance(outcome, BaseException):
                raise outcome
            return FakeResponse(outcome)

        with mock.patch.object(mod, "urlopen", side_effect=fake_urlopen), \
                redirect_stdout(io.StringIO()):
            return mod.gql({}, retries=retries)

    def test_url_error_is_retried_once_then_succeeds(self):
        data = self.run_gql([URLError("boom"), self.OK])
        self.assertEqual(data, self.OK["data"])
        self.assertEqual(self.calls, 2)
        self.sleep.assert_called_once_with(2)

    def test_http_500_is_retried_then_succeeds(self):
        err = HTTPError("http://x", 500, "boom", {}, None)
        data = self.run_gql([err, self.OK])
        self.assertEqual(data, self.OK["data"])
        self.assertEqual(self.calls, 2)
        self.sleep.assert_called_once_with(2)

    def test_timeout_reset_and_bad_json_are_retried(self):
        bad = json.JSONDecodeError("bad", "", 0)
        data = self.run_gql([TimeoutError(), ConnectionResetError(), bad, self.OK])
        self.assertEqual(data, self.OK["data"])
        self.assertEqual(self.calls, 4)

    def test_non_retryable_http_error_is_raised_immediately(self):
        err = HTTPError("http://x", 404, "nope", {}, None)
        with self.assertRaises(HTTPError):
            self.run_gql([err, self.OK])
        self.assertEqual(self.calls, 1)
        self.sleep.assert_not_called()

    def test_exhaustion_exits_cleanly_after_all_attempts(self):
        with self.assertRaises(SystemExit) as ctx:
            self.run_gql([URLError("boom")] * 3, retries=3)
        self.assertEqual(self.calls, 3)
        self.assertIn("failed after 3 attempts", str(ctx.exception))
        self.assertIn("boom", str(ctx.exception))


class WriteFetchTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        mock.patch.object(mod.time, "sleep").start()
        mock.patch.object(mod, "utc_now_iso", return_value="2026-10-09T20:15:03Z").start()
        self.addCleanup(mock.patch.stopall)

    def run_fetch(self, pages, layout=7, angle=40):
        with mock.patch.object(mod, "gql", side_effect=pages), redirect_stdout(io.StringIO()):
            return mod.fetch_and_write(layout, angle, self.dir.name, delay=0)

    def test_header_shape_and_file_location(self):
        pages = [page([climb("b"), climb("a")], 3, True), page([climb("c")], 3, False)]
        path = self.run_fetch(pages)
        self.assertEqual(path, lib.fetch_path(self.dir.name, 7, 40))
        self.assertTrue(path.endswith(os.path.join(".upstream", "minimoonboard2025_40.json")))
        data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        self.assertEqual(list(data), HEADER_KEYS)
        self.assertEqual(data["fetched_at"], "2026-10-09T20:15:03Z")
        self.assertTrue(data["fetched_at"].endswith("Z"))
        self.assertEqual(data["layoutId"], 7)
        self.assertEqual(data["angle"], 40)
        self.assertEqual(data["setIds"], "28,29,30,31")
        self.assertEqual(data["total_count"], 3)
        self.assertEqual(data["count"], 3)
        self.assertEqual(len(data["problems"]), data["count"])
        self.assertEqual([p["uuid"] for p in data["problems"]], ["a", "b", "c"])
        self.assertEqual(list(data["problems"][0]), PROBLEM_KEYS)
        self.assertFalse(os.path.exists(path + ".tmp"))

    def test_count_excludes_dropped_climbs_but_total_is_upstreams(self):
        pages = [page([climb("a", frames=""), climb("b")], 2, False)]
        data = json.loads(pathlib.Path(self.run_fetch(pages)).read_text(encoding="utf-8"))
        self.assertEqual(data["total_count"], 2)
        self.assertEqual(data["count"], 1)

    def test_non_ascii_names_kept_verbatim(self):
        pages = [page([climb("a", name="未完成")], 1, False)]
        self.assertIn("未完成", pathlib.Path(self.run_fetch(pages)).read_text(encoding="utf-8"))

    def test_other_board_lands_under_its_slug(self):
        path = self.run_fetch([page([climb("a")], 1, False)], layout=3, angle=25)
        self.assertTrue(path.endswith(os.path.join(".upstream", "moonboard2024_25.json")))
        data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        self.assertEqual((data["layoutId"], data["angle"], data["setIds"]), (3, 25, "5,6,7,8,9,10"))


class CliTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        mock.patch.object(mod.time, "sleep").start()
        mock.patch.object(mod, "utc_now_iso", return_value="2026-10-09T20:15:03Z").start()
        self.addCleanup(mock.patch.stopall)

    def test_layout_and_angle_fetch_one_slab(self):
        with mock.patch.object(mod, "gql", side_effect=[page([climb("a")], 1, False)]), \
                redirect_stdout(io.StringIO()):
            mod.main(["--layout", "7", "--angle", "40", "--out-dir", self.dir.name])
        self.assertTrue(os.path.exists(lib.fetch_path(self.dir.name, 7, 40)))
        self.assertFalse(os.path.exists(lib.fetch_path(self.dir.name, 7, 25)))

    def test_layout_without_angle_fetches_both_angles(self):
        pages = [page([climb("a")], 1, False), page([climb("a")], 1, False)]
        with mock.patch.object(mod, "gql", side_effect=pages), redirect_stdout(io.StringIO()):
            mod.main(["--layout", "7", "--out-dir", self.dir.name])
        self.assertTrue(os.path.exists(lib.fetch_path(self.dir.name, 7, 40)))
        self.assertTrue(os.path.exists(lib.fetch_path(self.dir.name, 7, 25)))

    def test_dropped_filter_flags_are_rejected(self):
        for flag in (["--min-ascents", "10"], ["--benchmarks-only"]):
            with self.assertRaises(SystemExit), redirect_stdout(io.StringIO()), \
                    mock.patch("sys.stderr", new=io.StringIO()):
                mod.main(["--layout", "7", *flag, "--out-dir", self.dir.name])

    def test_requires_layout_or_all(self):
        with self.assertRaises(SystemExit), mock.patch("sys.stderr", new=io.StringIO()):
            mod.main(["--out-dir", self.dir.name])

    def test_out_dir_defaults_to_data_dir(self):
        self.assertEqual(mod.DEFAULT_OUT_DIR, lib.DATA_DIR)


if __name__ == "__main__":
    unittest.main()
