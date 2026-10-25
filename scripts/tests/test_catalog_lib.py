"""Unit tests for scripts/catalog_lib.py — the helpers every catalog script shares (no network, no DB).

Run:  python3 scripts/tests/test_catalog_lib.py
"""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

from catalog_fakes import ClampingServer, http_error, live_row

_SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "catalog_lib.py"
_spec = importlib.util.spec_from_file_location("catalog_lib", _SCRIPT)
lib = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lib)

H1 = [{"c": 2, "r": 12, "t": "end"}, {"c": 5, "r": 5, "t": "start"}, {"c": 7, "r": 8, "t": "right"}]
H2 = [{"c": 0, "r": 18, "t": "end"}, {"c": 4, "r": 4, "t": "start"}]


def problem(pid, name="Problem", holds=H1, **over):
    p = {"id": pid, "boardsesh_uuid": pid, "name": name, "grade": "6B+", "userGrade": None,
         "setter": "setter", "stars": 3, "repeats": 10, "isBenchmark": False, "method": None,
         "holds": holds, "hold_key": lib.hold_key(holds), "upstream_last_seen": None}
    p.update(over)
    return p


class HoldKeyTest(unittest.TestCase):
    def test_order_independent(self):
        self.assertEqual(lib.hold_key(H1), lib.hold_key(list(reversed(H1))))

    def test_type_change_changes_key(self):
        changed = [dict(h) for h in H1]
        changed[0]["t"] = "start"
        self.assertNotEqual(lib.hold_key(H1), lib.hold_key(changed))

    def test_is_full_sha256_hex(self):
        key = lib.hold_key(H1)
        self.assertEqual(len(key), 64)
        int(key, 16)  # hex

    def test_empty_holds_have_a_key_too(self):
        self.assertEqual(len(lib.hold_key([])), 64)
        self.assertEqual(lib.hold_key(None), lib.hold_key([]))


class NormalizerTest(unittest.TestCase):
    def legacy_row(self, p, layout_id, angle):
        """Today's import_catalog.py mapper, verbatim, as the contract the normalizer must keep."""
        return {
            "source_catalog_id": p["id"], "layout_id": layout_id, "angle": angle,
            "name": p.get("name") or "", "grade": p.get("grade") or "",
            "user_grade": p.get("userGrade"), "setter": (p.get("setter") or "").strip(),
            "stars": int(p.get("stars") or 0), "repeats": int(p.get("repeats") or 0),
            "is_benchmark": bool(p.get("isBenchmark")), "method": p.get("method"),
            "holds": p.get("holds") or [],
        }

    def test_matches_legacy_mapper(self):
        p = {"id": "x", "name": "", "grade": "6A", "userGrade": None, "setter": "Avien  ",
             "stars": 3.0, "repeats": 12, "isBenchmark": 1, "method": None, "holds": H1}
        got = lib.row_from_problem(p, 3, 40)
        want = self.legacy_row(p, 3, 40)
        want["deleted"] = False
        self.assertEqual(got, want)
        self.assertEqual(got["stars"], 3)
        self.assertIsInstance(got["stars"], int)

    def test_empty_string_nullable_text_collapses_to_null(self):
        a = lib.row_from_problem(problem("x", userGrade="", method=""), 3, 40)
        b = lib.row_from_problem(problem("x", userGrade=None, method=None), 3, 40)
        self.assertEqual(a, b)
        self.assertIsNone(a["user_grade"])
        self.assertIsNone(a["method"])

    def test_live_row_normalizes_the_same_way(self):
        live = live_row("x", name="", setter="Avien  ", stars=3, user_grade="", method="", holds=H1,
                        repeats=12, grade="6A", is_benchmark=True)
        snap = lib.row_from_problem(problem("x", name="", setter="Avien", stars=3.0, repeats=12,
                                            grade="6A", isBenchmark=True, holds=H1), 3, 40)
        self.assertEqual(lib.row_from_live(live), snap)

    def test_live_row_keeps_deleted(self):
        self.assertTrue(lib.row_from_live(live_row("x", deleted=True))["deleted"])

    def test_problem_from_live_seeds_the_owned_fields(self):
        live = live_row("x", name="N", holds=H1, setter="s ", repeats=5, user_grade="6A", method="Footless")
        p = lib.problem_from_live(live)
        self.assertEqual(list(p), list(lib.PROBLEM_KEYS))
        self.assertEqual(p["id"], "x")
        self.assertEqual(p["boardsesh_uuid"], "x")
        self.assertEqual(p["hold_key"], lib.hold_key(H1))
        self.assertIsNone(p["upstream_last_seen"])
        self.assertEqual(p["setter"], "s")
        self.assertEqual(p["userGrade"], "6A")
        self.assertEqual(p["method"], "Footless")


class SnapshotIoTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "moonboard2024_40.json")

    def tearDown(self):
        self.dir.cleanup()

    def snapshot(self, problems):
        return {"setup": "MoonBoard 2024", "layoutId": 3, "angle": 40, "source": lib.SOURCE,
                "curation": lib.CURATION, "upstream_total": None, "count": 0, "problems": problems}

    def test_round_trip_sorted_one_problem_per_line(self):
        lib.write_snapshot(self.path, self.snapshot([problem("b"), problem("a", holds=H2)]))
        text = pathlib.Path(self.path).read_text(encoding="utf-8")
        lines = text.splitlines()
        self.assertEqual(sum(1 for line in lines if line.startswith('{"id": ')), 2)
        self.assertLess(text.index('"id": "a"'), text.index('"id": "b"'))
        back = lib.read_snapshot(self.path)
        self.assertEqual([p["id"] for p in back["problems"]], ["a", "b"])
        self.assertEqual(back["count"], 2)
        self.assertEqual(list(back), list(lib.SNAPSHOT_KEYS))
        self.assertEqual(list(back["problems"][0]), list(lib.PROBLEM_KEYS))
        self.assertEqual(back["problems"][0]["holds"], H2)

    def test_writing_twice_is_byte_identical(self):
        lib.write_snapshot(self.path, self.snapshot([problem("b"), problem("a")]))
        first = pathlib.Path(self.path).read_bytes()
        lib.write_snapshot(self.path, lib.read_snapshot(self.path))
        self.assertEqual(pathlib.Path(self.path).read_bytes(), first)

    def test_non_ascii_is_kept_verbatim(self):
        lib.write_snapshot(self.path, self.snapshot([problem("a", name="122701zxy未完成")]))
        self.assertIn("未完成", pathlib.Path(self.path).read_text(encoding="utf-8"))

    def test_write_is_atomic(self):
        lib.write_snapshot(self.path, self.snapshot([problem("a")]))
        with mock.patch.object(lib.os, "replace", side_effect=OSError("boom")):
            with self.assertRaises(OSError):
                lib.write_snapshot(self.path, self.snapshot([problem("b")]))
        self.assertEqual([p["id"] for p in lib.read_snapshot(self.path)["problems"]], ["a"])
        self.assertEqual(os.listdir(self.dir.name), ["moonboard2024_40.json"])

    def test_unknown_problem_key_is_refused(self):
        bad = problem("a")
        bad["holdsetup"] = 22
        with self.assertRaises(ValueError):
            lib.write_snapshot(self.path, self.snapshot([bad]))

    def test_missing_problem_key_is_refused(self):
        bad = problem("a")
        del bad["hold_key"]
        with self.assertRaises(ValueError):
            lib.write_snapshot(self.path, self.snapshot([bad]))

    def test_snapshot_files_skips_the_overrides_file_and_filters_by_slab(self):
        lib.write_snapshot(self.path, self.snapshot([problem("a")]))
        other = os.path.join(self.dir.name, "moonboard2024_25.json")
        s = self.snapshot([problem("b")])
        s["angle"] = 25
        lib.write_snapshot(other, s)
        with open(os.path.join(self.dir.name, "overrides.json"), "w") as f:
            json.dump({"retired_ids": [], "entries": []}, f)
        self.assertEqual([os.path.basename(p) for p, _ in lib.snapshot_files(self.dir.name, None, None)],
                         ["moonboard2024_25.json", "moonboard2024_40.json"])
        self.assertEqual([s["angle"] for _, s in lib.snapshot_files(self.dir.name, 3, 40)], [40])
        self.assertEqual(lib.snapshot_files(self.dir.name, 5, None), [])

    def test_paths(self):
        self.assertEqual(os.path.basename(lib.snapshot_path(self.dir.name, 3, 40)), "moonboard2024_40.json")
        self.assertEqual(lib.fetch_path(self.dir.name, 7, 40),
                         os.path.join(self.dir.name, ".upstream", "minimoonboard2025_40.json"))


class LiveRowsTest(unittest.TestCase):
    def rows(self, n, layout_id=3, angle=40):
        return [live_row(f"{i:05d}", layout_id=layout_id, angle=angle) for i in range(n)]

    def fetch(self, rows, clamp=1000, **kw):
        server = ClampingServer(rows, clamp)
        with mock.patch.object(lib, "urlopen", server):
            got = lib.live_rows("https://x.supabase.co", "k", **kw)
        return got, server

    def test_reads_a_slab_past_the_clamp(self):
        got, server = self.fetch(self.rows(2500), layout=3, angle=40)
        self.assertEqual([r["source_catalog_id"] for r in got], [f"{i:05d}" for i in range(2500)])
        self.assertEqual(len(server.requests), 3)  # 1000 + 1000 + 500

    def test_stops_on_an_exact_page_boundary_without_an_extra_request(self):
        got, server = self.fetch(self.rows(2000), layout=3, angle=40)
        self.assertEqual(len(got), 2000)
        self.assertEqual(len(server.requests), 2)

    def test_filters_by_slab_and_includes_tombstones(self):
        rows = self.rows(3) + self.rows(2, angle=25) + [live_row("zzz", deleted=True)]
        got, _ = self.fetch(rows, layout=3, angle=40)
        self.assertEqual([r["source_catalog_id"] for r in got], ["00000", "00001", "00002", "zzz"])

    def test_no_slab_reads_the_whole_table(self):
        got, _ = self.fetch(self.rows(3) + self.rows(2, layout_id=5, angle=25))
        self.assertEqual(len(got), 5)

    def test_first_request_asks_for_the_exact_count_and_keysets_after(self):
        _, server = self.fetch(self.rows(1500), layout=3, angle=40)
        first, second = server.requests
        self.assertEqual(first.get_header("Prefer"), "count=exact")
        self.assertIn("order=source_catalog_id.asc", first.full_url)
        self.assertIn("source_catalog_id=gt.00999", second.full_url)

    def test_columns_are_selectable(self):
        got, server = self.fetch(self.rows(2), layout=3, angle=40,
                                 columns=("source_catalog_id", "deleted"))
        self.assertEqual(got[0], {"source_catalog_id": "00000", "deleted": False})
        self.assertIn("select=source_catalog_id,deleted", server.requests[0].full_url)

    def test_advances_when_clamped_below_the_page(self):
        got, server = self.fetch(self.rows(7), clamp=3, layout=3, angle=40)
        self.assertEqual(len(got), 7)
        self.assertEqual(len(server.requests), 3)

    def test_empty_slab(self):
        got, server = self.fetch([], layout=3, angle=40)
        self.assertEqual(got, [])
        self.assertEqual(len(server.requests), 1)

    def test_pages_to_an_empty_page_when_the_server_reports_no_count(self):
        server = ClampingServer(self.rows(2500), honour_count=False)
        with mock.patch.object(lib, "urlopen", server):
            got = lib.live_rows("https://x.supabase.co", "k", layout=3, angle=40)
        self.assertEqual(len(got), 2500)
        self.assertEqual(len(server.requests), 4)

    def test_refuses_to_page_past_an_unsafe_id(self):
        rows = self.rows(1000)
        rows[-1]["source_catalog_id"] = "zz,zz)"
        with self.assertRaises(SystemExit):
            self.fetch(rows + self.rows(5), layout=3, angle=40)

    def test_retries_a_transient_error(self):
        server = ClampingServer(self.rows(3), failures=[http_error(503)])
        with mock.patch.object(lib, "urlopen", server), mock.patch.object(lib.time, "sleep") as sleep:
            got = lib.live_rows("https://x.supabase.co", "k", layout=3, angle=40)
        self.assertEqual(len(got), 3)
        sleep.assert_called_once()


class SbRequestRetryTest(unittest.TestCase):
    URL = "https://x.supabase.co/rest/v1/catalog_problems?select=source_catalog_id&limit=1000"

    def call(self, failures, rows=1, **kw):
        server = ClampingServer([live_row(f"{i:05d}") for i in range(rows)], failures=failures)
        with mock.patch.object(lib, "urlopen", server), mock.patch.object(lib.time, "sleep") as sleep:
            try:
                result = lib.sb_request(self.URL, "k", **kw)
            finally:
                self.sleep, self.server = sleep, server
        return result

    def test_urlerror_once_then_success(self):
        payload, _ = self.call([lib.URLError("reset")])
        self.assertEqual(len(payload), 1)
        self.assertEqual(self.sleep.call_count, 1)

    def test_timeout_once_then_success(self):
        payload, _ = self.call([TimeoutError()])
        self.assertEqual(len(payload), 1)
        self.assertEqual(self.sleep.call_count, 1)

    def test_connection_reset_once_then_success(self):
        payload, _ = self.call([ConnectionResetError()])
        self.assertEqual(len(payload), 1)

    def test_exhaustion_exits_saying_rerun_is_safe(self):
        with self.assertRaises(SystemExit) as ctx:
            self.call([lib.URLError("reset")] * 4, retries=4)
        message = str(ctx.exception)
        self.assertIn("re-running", message)
        self.assertIn("/rest/v1/catalog_problems", message)
        self.assertNotIn("select=", message)
        self.assertEqual(len(self.server.requests), 4)

    def test_http_500_and_504_are_retried(self):
        payload, _ = self.call([http_error(500), http_error(504)])
        self.assertEqual(len(payload), 1)
        self.assertEqual(self.sleep.call_count, 2)

    def test_http_400_exits_without_retry(self):
        with self.assertRaises(SystemExit):
            self.call([http_error(400)])
        self.assertEqual(len(self.server.requests), 1)
        self.sleep.assert_not_called()


class OverridesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "overrides.json")

    def tearDown(self):
        self.dir.cleanup()

    def write(self, obj):
        with open(self.path, "w") as f:
            json.dump(obj, f)
        return self.path

    def test_missing_file_is_empty(self):
        ov = lib.load_overrides(os.path.join(self.dir.name, "nope.json"))
        self.assertEqual(ov.retired_ids, set())
        self.assertEqual(ov.entries, [])

    def test_loads_every_action_and_retired_ids(self):
        entries = [
            {"action": "match", "layout_id": 3, "angle": 40, "uuid": "u1", "id": "p1"},
            {"action": "new", "layout_id": 3, "angle": 40, "uuid": "u2", "id": "p2"},
            {"action": "accept_holds", "layout_id": 3, "angle": 40, "id": "p3", "hold_key": "a" * 64},
            {"action": "pin", "layout_id": 5, "angle": 40, "id": "p4", "field": "isBenchmark", "value": True},
        ]
        ov = lib.load_overrides(self.write({"retired_ids": ["r1", "r2"], "entries": entries}))
        self.assertEqual(ov.retired_ids, {"r1", "r2"})
        self.assertEqual(ov.entries, entries)
        self.assertEqual([e["action"] for e in ov.for_slab(3, 40)], ["match", "new", "accept_holds"])
        self.assertEqual([e["id"] for e in ov.for_slab(5, 40)], ["p4"])

    def test_rejects_unknown_action(self):
        path = self.write({"retired_ids": [], "entries": [{"action": "delete", "layout_id": 3, "angle": 40, "id": "p"}]})
        with self.assertRaises(ValueError):
            lib.load_overrides(path)

    def test_rejects_entry_missing_layout_id(self):
        path = self.write({"retired_ids": [], "entries": [{"action": "match", "angle": 40, "uuid": "u", "id": "p"}]})
        with self.assertRaises(ValueError):
            lib.load_overrides(path)

    def test_rejects_pin_on_an_owned_field(self):
        path = self.write({"retired_ids": [], "entries": [
            {"action": "pin", "layout_id": 3, "angle": 40, "id": "p", "field": "holds", "value": []}]})
        with self.assertRaises(ValueError):
            lib.load_overrides(path)

    def test_rejects_a_file_that_looks_like_a_slab(self):
        path = self.write({"layoutId": 3, "angle": 40, "problems": [], "retired_ids": [], "entries": []})
        with self.assertRaises(ValueError):
            lib.load_overrides(path)

    def test_rejects_a_retired_id_that_is_not_a_string(self):
        with self.assertRaises(ValueError):
            lib.load_overrides(self.write({"retired_ids": [{"id": "r"}], "entries": []}))


class IdsAndCurationTest(unittest.TestCase):
    def test_derived_id_is_deterministic_and_angle_specific(self):
        a = lib.derived_id("ac7d98a1-51b6-5048-8e97-7651c5024a2d", 25)
        self.assertEqual(a, lib.derived_id("ac7d98a1-51b6-5048-8e97-7651c5024a2d", 25))
        self.assertNotEqual(a, lib.derived_id("ac7d98a1-51b6-5048-8e97-7651c5024a2d", 40))
        self.assertNotEqual(a, "ac7d98a1-51b6-5048-8e97-7651c5024a2d")
        self.assertTrue(lib.ID_RE.match(a))
        self.assertEqual(len(a), 36)

    def test_id_guard_rejects_a_trailing_newline_and_filter_characters(self):
        self.assertTrue(lib.ID_RE.match("ac7d98a1-51b6-5048-8e97-7651c5024a2d"))
        for bad in ("abc\n", "a,b", 'a"b', "a)b", "", "a b"):
            self.assertIsNone(lib.ID_RE.match(bad), bad)

    def test_admitted(self):
        self.assertTrue(lib.admitted({"isBenchmark": True, "repeats": 0}))
        self.assertTrue(lib.admitted({"isBenchmark": False, "repeats": 10}))
        self.assertFalse(lib.admitted({"isBenchmark": False, "repeats": 9}))
        self.assertFalse(lib.admitted({"repeats": None}))

    def test_boards_table(self):
        self.assertEqual(lib.BOARDS[7].slug, "minimoonboard2025")
        self.assertEqual(lib.BOARDS[7].set_ids, "28,29,30,31")
        self.assertEqual(lib.slug_for(3), "moonboard2024")


class CredentialsTest(unittest.TestCase):
    def test_prefers_service_role(self):
        env = {"SUPABASE_URL": "https://x.supabase.co/", "SUPABASE_SERVICE_ROLE_KEY": "s", "SUPABASE_ANON_KEY": "a"}
        with mock.patch.dict(lib.os.environ, env, clear=True):
            self.assertEqual(lib.read_credentials(), ("https://x.supabase.co", "s", True))

    def test_falls_back_to_anon(self):
        env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_ANON_KEY": "a"}
        with mock.patch.dict(lib.os.environ, env, clear=True):
            self.assertEqual(lib.read_credentials(), ("https://x.supabase.co", "a", False))

    def test_service_role_required(self):
        env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_ANON_KEY": "a"}
        with mock.patch.dict(lib.os.environ, env, clear=True), self.assertRaises(SystemExit):
            lib.read_credentials(require_service_role=True)

    def test_missing(self):
        with mock.patch.dict(lib.os.environ, {}, clear=True), self.assertRaises(SystemExit):
            lib.read_credentials()


if __name__ == "__main__":
    unittest.main()
