"""Unit tests for scripts/import_catalog.py — the diff-only import that never deletes (no network, no DB).

Run:  python3 scripts/tests/test_import_catalog.py
"""
import contextlib
import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

from catalog_fakes import ClampingServer, http_error, live_row

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
_spec = importlib.util.spec_from_file_location("import_catalog", _SCRIPTS / "import_catalog.py")
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)
lib = mod.lib

H1 = [{"c": 2, "r": 12, "t": "end"}, {"c": 5, "r": 5, "t": "start"}, {"c": 7, "r": 8, "t": "right"}]

SERVICE_ENV = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "service",
               "SUPABASE_ANON_KEY": "anon"}
ANON_ENV = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "", "SUPABASE_ANON_KEY": "anon"}


def problem(pid, name="Problem", holds=H1, **over):
    p = {"id": pid, "boardsesh_uuid": pid, "name": name, "grade": "6B+", "userGrade": None,
         "setter": "setter", "stars": 3, "repeats": 10, "isBenchmark": False, "method": None,
         "holds": holds, "hold_key": lib.hold_key(holds), "upstream_last_seen": None}
    p.update(over)
    return p


def snapshot(problems, layout=3, angle=40):
    return {"setup": lib.BOARDS[layout].name, "layoutId": layout, "angle": angle, "source": lib.SOURCE,
            "curation": lib.CURATION, "upstream_total": None, "count": len(problems), "problems": problems}


def live(pid, **over):
    """A live row that matches `problem(pid)` exactly (so it classifies as unchanged)."""
    return live_row(pid, holds=H1, **over)


def snap_rows(problems, layout=3, angle=40):
    return [lib.row_from_problem(p, layout, angle) for p in problems]


def live_rows(rows):
    return [lib.row_from_live(r) for r in rows]


def ids(rows):
    return [r["source_catalog_id"] for r in rows]


def posts(server):
    return [(url, body) for method, url, body in server.writes if method == "POST"]


# ── classify (pure core) ───────────────────────────────────────────────────────────────

class ClassifyTest(unittest.TestCase):
    def test_identical_snapshot_and_live_write_nothing(self):
        plan = mod.classify(snap_rows([problem("a"), problem("b")]), live_rows([live("a"), live("b")]))
        self.assertEqual((plan.inserts, plan.updates, plan.undeletes, plan.orphans), ([], [], [], []))
        self.assertEqual(ids(plan.unchanged), ["a", "b"])
        self.assertEqual(plan.predicted_events, 0)

    def test_repeats_change_is_an_update(self):
        plan = mod.classify(snap_rows([problem("a", repeats=11)]), live_rows([live("a", repeats=10)]))
        self.assertEqual(ids(plan.updates), ["a"])
        self.assertEqual(plan.unchanged, [])

    def test_null_versus_empty_method_is_unchanged(self):
        plan = mod.classify(snap_rows([problem("a", method="")]), live_rows([live("a", method=None)]))
        self.assertEqual(ids(plan.unchanged), ["a"])
        plan = mod.classify(snap_rows([problem("a")]), live_rows([live("a", method="")]))
        self.assertEqual(ids(plan.unchanged), ["a"])
        del_method = problem("a")
        del del_method["method"]
        plan = mod.classify(snap_rows([del_method]), live_rows([live("a", method=None)]))
        self.assertEqual(ids(plan.unchanged), ["a"])

    def test_missing_live_row_is_an_insert(self):
        plan = mod.classify(snap_rows([problem("a"), problem("b")]), live_rows([live("a")]))
        self.assertEqual(ids(plan.inserts), ["b"])
        self.assertEqual(ids(plan.unchanged), ["a"])

    def test_tombstoned_live_row_in_snapshot_is_an_undelete_sent_with_deleted_false(self):
        plan = mod.classify(snap_rows([problem("a")]), live_rows([live("a", deleted=True)]))
        self.assertEqual(ids(plan.undeletes), ["a"])
        self.assertIs(plan.undeletes[0]["deleted"], False)
        self.assertEqual(plan.updates, [])
        self.assertEqual(plan.unchanged, [])

    def test_tombstoned_live_row_absent_from_snapshot_is_ignored(self):
        plan = mod.classify(snap_rows([problem("a")]), live_rows([live("a"), live("zombie", deleted=True)]))
        self.assertEqual(plan.orphans, [])
        self.assertEqual(plan.undeletes, [])

    def test_live_row_absent_from_snapshot_is_an_orphan(self):
        plan = mod.classify(snap_rows([problem("a")]), live_rows([live("a"), live("extra")]))
        self.assertEqual(ids(plan.orphans), ["extra"])

    def test_compares_every_uploaded_column(self):
        for column, over in (("name", {"name": "X"}), ("grade", {"grade": "7A"}), ("userGrade", {"userGrade": "7A"}),
                             ("setter", {"setter": "other"}), ("stars", {"stars": 1}),
                             ("isBenchmark", {"isBenchmark": True}), ("method", {"method": "Feet follow hands"}),
                             ("holds", {"holds": [{"c": 0, "r": 0, "t": "start"}]})):
            plan = mod.classify(snap_rows([problem("a", **over)]), live_rows([live("a")]))
            self.assertEqual(ids(plan.updates), ["a"], column)

    def test_predicted_events_count_rising_edges_and_benchmark_inserts(self):
        snap = snap_rows([
            problem("ins-bench", isBenchmark=True),     # insert, benchmark → 1
            problem("ins-plain"),                        # insert, not benchmark → 0
            problem("up-rise", isBenchmark=True),        # update false→true → 1
            problem("up-hold", isBenchmark=True, repeats=99),  # update true→true → 0
            problem("up-drop", isBenchmark=False),       # update true→false → 0
            problem("und-rise", isBenchmark=True),       # undelete false→true → 1
            problem("und-hold", isBenchmark=True),       # undelete true→true → 0
        ])
        prod = live_rows([
            live("up-rise", is_benchmark=False), live("up-hold", is_benchmark=True, repeats=1),
            live("up-drop", is_benchmark=True),
            live("und-rise", is_benchmark=False, deleted=True), live("und-hold", is_benchmark=True, deleted=True),
        ])
        plan = mod.classify(snap, prod)
        self.assertEqual(sorted(ids(plan.inserts)), ["ins-bench", "ins-plain"])
        self.assertEqual(sorted(ids(plan.updates)), ["up-drop", "up-hold", "up-rise"])
        self.assertEqual(sorted(ids(plan.undeletes)), ["und-hold", "und-rise"])
        self.assertEqual(plan.predicted_events, 3)

    def test_written_rows_carry_exactly_the_uploaded_columns(self):
        plan = mod.classify(snap_rows([problem("a"), problem("b", repeats=1)]),
                            live_rows([live("b"), live("c", deleted=True)]) + live_rows([]))
        for row in plan.inserts + plan.updates:
            self.assertEqual(set(row), set(lib.ROW_COLUMNS))


# ── the shell ──────────────────────────────────────────────────────────────────────────

class ShellCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def write(self, problems, layout=3, angle=40):
        lib.write_snapshot(lib.snapshot_path(self.dir, layout, angle), snapshot(problems, layout, angle))

    def overrides(self, retired_ids):
        with open(lib.overrides_path(self.dir), "w") as f:
            json.dump({"retired_ids": retired_ids, "entries": []}, f)

    def run_import(self, server, *argv, env=SERVICE_ENV):
        """main() under the fake server → (exit code or None, stdout)."""
        out = io.StringIO()
        code = None
        argv = list(argv) + ["--dir", self.dir]
        with mock.patch.object(lib, "urlopen", server), mock.patch.dict(lib.os.environ, env), \
                contextlib.redirect_stdout(out):
            try:
                mod.main(argv)
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()


class DryRunTest(ShellCase):
    def test_identical_slab_reports_zero_everywhere_and_writes_nothing(self):
        self.write([problem("a"), problem("b")])
        server = ClampingServer([live("a"), live("b")])
        code, out = self.run_import(server, "--layout", "3", "--angle", "40")
        self.assertIn(code, (None, 0), out)
        self.assertIn("moonboard2024_40.json: 0 inserts, 0 updates, 0 undeletes, 0 orphans, "
                      "0 retired-id hits, 0 predicted events", out)
        self.assertIn("2 unchanged", out)
        self.assertEqual(server.writes, [])

    def test_dry_run_reports_every_class_and_every_undelete_by_id(self):
        self.write([problem("ins", isBenchmark=True), problem("upd", repeats=99), problem("und"), problem("same")])
        server = ClampingServer([live("upd"), live("und", deleted=True), live("same")])
        code, out = self.run_import(server, "--layout", "3")
        self.assertIn(code, (None, 0), out)
        self.assertIn("1 inserts, 1 updates, 1 undeletes, 0 orphans, 0 retired-id hits, 1 predicted events", out)
        self.assertIn("und", out)
        self.assertEqual(server.writes, [])

    def test_dry_run_works_with_the_anon_key(self):
        self.write([problem("a")])
        server = ClampingServer([live("a")])
        code, out = self.run_import(server, "--all", env=ANON_ENV)
        self.assertIn(code, (None, 0), out)
        self.assertEqual(server.writes, [])

    def test_apply_refuses_without_the_service_role_key(self):
        self.write([problem("a")])
        server = ClampingServer([])
        code, out = self.run_import(server, "--all", "--apply", env=ANON_ENV)
        self.assertNotIn(code, (None, 0))
        self.assertEqual(server.requests, [])

    def test_pages_a_5900_row_slab_completely(self):
        n = 5900
        self.write([problem(f"p{i:05d}") for i in range(n)])
        server = ClampingServer([live(f"p{i:05d}") for i in range(n)])
        code, out = self.run_import(server, "--layout", "3", "--angle", "40")
        self.assertIn(code, (None, 0), out)
        self.assertIn("5900 unchanged", out)
        self.assertIn("0 inserts, 0 updates, 0 undeletes, 0 orphans", out)
        self.assertGreaterEqual(len(server.gets()), 6)

    def test_all_selects_every_slab_and_layout_angle_filters(self):
        self.write([problem("a")], 3, 40)
        self.write([problem("b")], 3, 25)
        server = ClampingServer([live("a"), live("b", angle=25)])
        code, out = self.run_import(server, "--all")
        self.assertIn(code, (None, 0), out)
        self.assertIn("moonboard2024_40.json:", out)
        self.assertIn("moonboard2024_25.json:", out)
        code, out = self.run_import(server, "--layout", "3", "--angle", "25")
        self.assertNotIn("moonboard2024_40.json:", out)
        self.assertIn("moonboard2024_25.json:", out)


class RefusalTest(ShellCase):
    def test_orphan_refuses_and_writes_nothing_without_allow_orphans(self):
        self.write([problem("a", repeats=99)])
        server = ClampingServer([live("a"), live("extra", name="Lost one")])
        code, out = self.run_import(server, "--layout", "3", "--apply")
        self.assertNotIn(code, (None, 0))
        self.assertIn("extra", out)
        self.assertIn("1 orphans", out)
        self.assertEqual(server.writes, [])

    def test_orphan_proceeds_with_allow_orphans_and_never_touches_the_orphan(self):
        self.write([problem("a", repeats=99)])
        server = ClampingServer([live("a"), live("extra")])
        code, out = self.run_import(server, "--layout", "3", "--apply", "--allow-orphans")
        self.assertIn(code, (None, 0), out)
        self.assertEqual(len(posts(server)), 1)
        self.assertEqual(ids(posts(server)[0][1]), ["a"])
        self.assertIs(server.row("extra")["deleted"], False)

    def test_orphans_in_one_slab_block_every_slab(self):
        self.write([problem("a", repeats=99)], 3, 40)
        self.write([problem("b", repeats=99)], 3, 25)
        server = ClampingServer([live("a"), live("b", angle=25), live("extra", angle=25)])
        code, out = self.run_import(server, "--all", "--apply")
        self.assertNotIn(code, (None, 0))
        self.assertEqual(server.writes, [])

    def test_insert_whose_id_lives_under_another_slab_refuses_and_names_both(self):
        for deleted in (False, True):
            with self.subTest(deleted=deleted):
                self.write([problem("a"), problem("shared")])
                server = ClampingServer([live("a"), live("shared", angle=25, deleted=deleted)])
                code, out = self.run_import(server, "--layout", "3", "--angle", "40", "--apply")
                self.assertNotIn(code, (None, 0))
                self.assertIn("shared", out)
                self.assertIn("layout 3 @ 40°", out)
                self.assertIn("layout 3 @ 25°", out)
                self.assertEqual(server.writes, [])
                lookups = [r for r in server.gets() if "source_catalog_id=in.(" in r.full_url]
                self.assertEqual(len(lookups), 1)
                self.assertIn("shared", lookups[0].full_url)

    def test_cross_slab_lookup_is_batched(self):
        self.write([problem(f"n{i:04d}") for i in range(250)])
        server = ClampingServer([])
        code, out = self.run_import(server, "--layout", "3", "--angle", "40")
        self.assertIn(code, (None, 0), out)
        lookups = [r for r in server.gets() if "source_catalog_id=in.(" in r.full_url]
        self.assertEqual(len(lookups), 3)
        for r in lookups:
            self.assertLessEqual(r.full_url.count('"') // 2, 100)

    def test_retired_id_is_reported_and_refuses_an_apply(self):
        self.write([problem("a"), problem("old")])
        self.overrides(["old"])
        server = ClampingServer([live("a"), live("old", deleted=True)])
        code, out = self.run_import(server, "--layout", "3")
        self.assertIn("1 retired-id hits", out)
        self.assertIn("old", out)
        code, out = self.run_import(server, "--layout", "3", "--apply")
        self.assertNotIn(code, (None, 0))
        self.assertEqual(server.writes, [])

    def test_unsafe_id_refuses_before_any_filter(self):
        self.write([problem("a"), problem("bad)id,or=1")])
        server = ClampingServer([live("a")])
        code, out = self.run_import(server, "--layout", "3")
        self.assertNotIn(code, (None, 0))
        self.assertEqual(server.writes, [])
        self.assertFalse([r for r in server.gets() if "in.(" in r.full_url])


class FailSecondPost:
    """urlopen double: delegates to a ClampingServer but fails the second POST."""

    def __init__(self, server, error):
        self.server, self.error, self.posts = server, error, 0

    def __call__(self, req, timeout=None):
        if req.get_method() == "POST":
            self.posts += 1
            if self.posts == 2:
                raise self.error
        return self.server(req, timeout)


class ApplyTest(ShellCase):
    def test_apply_writes_inserts_then_updates_then_undeletes_in_batches_of_500(self):
        inserts = [problem(f"i{i:04d}") for i in range(600)]
        self.write(inserts + [problem("u1", repeats=99), problem("u2", repeats=99), problem("d1")])
        server = ClampingServer([live("u1"), live("u2"), live("d1", deleted=True)])
        code, out = self.run_import(server, "--layout", "3", "--apply")
        self.assertIn(code, (None, 0), out)
        writes = posts(server)
        self.assertEqual([len(body) for _, body in writes], [500, 100, 2, 1])
        self.assertEqual(ids(writes[0][1]) + ids(writes[1][1]), [p["id"] for p in inserts])
        self.assertEqual(ids(writes[2][1]), ["u1", "u2"])
        self.assertEqual(ids(writes[3][1]), ["d1"])
        for _, body in writes:
            for row in body:
                self.assertEqual(set(row), set(lib.ROW_COLUMNS))
                self.assertIs(row["deleted"], False)
        self.assertIs(server.row("d1")["deleted"], False)
        self.assertEqual(server.row("u1")["repeats"], 99)
        self.assertEqual(len(server.rows), 603)

    def test_apply_stops_on_the_first_http_error_and_rerun_writes_only_the_rest(self):
        inserts = [problem(f"i{i:04d}") for i in range(600)]
        self.write(inserts + [problem("u1", repeats=99)])
        server = ClampingServer([live("u1")])
        failing = FailSecondPost(server, http_error(500))
        code, out = self.run_import(failing, "--layout", "3", "--apply")
        self.assertNotIn(code, (None, 0))
        self.assertEqual(len(posts(server)), 1)
        self.assertEqual(len(posts(server)[0][1]), 500)
        self.assertEqual(server.row("u1")["repeats"], 10)

        code, out = self.run_import(server, "--layout", "3", "--apply")
        self.assertIn(code, (None, 0), out)
        writes = posts(server)[1:]
        self.assertEqual([len(body) for _, body in writes], [100, 1])
        self.assertEqual(ids(writes[0][1]), [p["id"] for p in inserts[500:]])
        self.assertEqual(ids(writes[1][1]), ["u1"])

        code, out = self.run_import(server, "--layout", "3")
        self.assertIn("0 inserts, 0 updates, 0 undeletes, 0 orphans", out)

    def test_apply_never_writes_deleted_true(self):
        self.write([problem("a", repeats=99)])
        server = ClampingServer([live("a"), live("gone", deleted=True)])
        code, out = self.run_import(server, "--layout", "3", "--apply")
        self.assertIn(code, (None, 0), out)
        for method, _, body in server.writes:
            self.assertEqual(method, "POST")
            self.assertTrue(all(row["deleted"] is False for row in body))
        self.assertIs(server.row("gone")["deleted"], True)


if __name__ == "__main__":
    unittest.main()
