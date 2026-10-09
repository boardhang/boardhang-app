"""Unit tests for scripts/export_catalog_snapshots.py — the one-time seed of the canonical
snapshots from prod (no network, no DB).

Run:  python3 scripts/tests/test_export_catalog_snapshots.py
"""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

from catalog_fakes import ClampingServer, live_row

_SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "export_catalog_snapshots.py"
_spec = importlib.util.spec_from_file_location("export_catalog_snapshots", _SCRIPT)
exp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(exp)
lib = exp.lib

H1 = [{"c": 2, "r": 12, "t": "end"}, {"c": 5, "r": 5, "t": "start"}]


class TransformTest(unittest.TestCase):
    def test_live_row_becomes_a_snapshot_problem(self):
        row = live_row("p1", name="BINGO", holds=H1, setter="flexbus ", repeats=78, grade="6B+",
                       user_grade="6B", stars=4, is_benchmark=True, method="Footless")
        snapshot, retired = exp.build_snapshot(3, 40, [row])
        self.assertEqual(retired, [])
        self.assertEqual(snapshot["setup"], "MoonBoard 2024")
        self.assertEqual((snapshot["layoutId"], snapshot["angle"]), (3, 40))
        self.assertEqual(snapshot["source"], lib.SOURCE)
        self.assertEqual(snapshot["curation"], lib.CURATION)
        self.assertIsNone(snapshot["upstream_total"])
        self.assertEqual(snapshot["count"], 1)
        p = snapshot["problems"][0]
        self.assertEqual(list(p), list(lib.PROBLEM_KEYS))
        self.assertEqual(p["id"], "p1")
        self.assertEqual(p["boardsesh_uuid"], "p1")
        self.assertEqual(p["hold_key"], lib.hold_key(H1))
        self.assertIsNone(p["upstream_last_seen"])
        self.assertEqual((p["name"], p["grade"], p["userGrade"], p["setter"], p["stars"], p["repeats"],
                          p["isBenchmark"], p["method"], p["holds"]),
                         ("BINGO", "6B+", "6B", "flexbus", 4, 78, True, "Footless", H1))

    def test_tombstone_is_skipped_and_reported(self):
        rows = [live_row("live", name="Kruse"), live_row("dead", name="KRUSE", deleted=True)]
        snapshot, retired = exp.build_snapshot(3, 40, rows)
        self.assertEqual([p["id"] for p in snapshot["problems"]], ["live"])
        self.assertEqual(retired, [("dead", "KRUSE")])

    def test_slab_with_zero_live_rows_refuses(self):
        with self.assertRaises(SystemExit):
            exp.build_snapshot(3, 40, [live_row("dead", deleted=True)])
        with self.assertRaises(SystemExit):
            exp.build_snapshot(3, 40, [])

    def test_two_slabs_sharing_an_id_refuse_naming_both(self):
        by_slab = {(3, 40): [live_row("p1", layout_id=3, angle=40)],
                   (3, 25): [live_row("p1", layout_id=3, angle=25)]}
        with self.assertRaises(SystemExit) as cm:
            exp.check_unique_ids(by_slab)
        self.assertIn("3@40", str(cm.exception))
        self.assertIn("3@25", str(cm.exception))

    def test_group_by_slab(self):
        rows = [live_row("a", layout_id=3, angle=40), live_row("b", layout_id=5, angle=25),
                live_row("c", layout_id=3, angle=40)]
        self.assertEqual({k: [r["source_catalog_id"] for r in v] for k, v in exp.group_by_slab(rows).items()},
                         {(3, 40): ["a", "c"], (5, 25): ["b"]})


class ShellTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_ANON_KEY": "a"}

    def tearDown(self):
        self.dir.cleanup()

    def run_export(self, rows, argv=()):
        server = ClampingServer(rows)
        with mock.patch.object(lib, "urlopen", server), mock.patch.dict(lib.os.environ, self.env, clear=True), \
                mock.patch.object(exp.sys, "argv", ["export", "--dir", self.dir.name, *argv]):
            exp.main()
        return server

    def test_writes_every_slab_and_the_retired_ids(self):
        rows = [live_row(f"a{i:04d}", layout_id=3, angle=40, name=f"P{i}") for i in range(1500)]
        rows += [live_row("b1", layout_id=5, angle=25), live_row("dead", layout_id=5, angle=25, name="Gone", deleted=True)]
        self.run_export(rows)
        files = sorted(os.listdir(self.dir.name))
        self.assertEqual(files, ["moonboard2024_40.json", "moonboardmasters2019_25.json", "overrides.json"])
        snap = lib.read_snapshot(os.path.join(self.dir.name, "moonboard2024_40.json"))
        self.assertEqual(snap["count"], 1500)
        self.assertEqual(snap["problems"][0]["id"], "a0000")
        ov = lib.load_overrides(os.path.join(self.dir.name, "overrides.json"))
        self.assertEqual(ov.retired_ids, {"dead"})

    def test_keeps_existing_override_entries(self):
        pin = {"action": "pin", "layout_id": 5, "angle": 40, "id": "p", "field": "isBenchmark", "value": True}
        with open(os.path.join(self.dir.name, "overrides.json"), "w") as f:
            json.dump({"retired_ids": ["stale"], "entries": [pin]}, f)
        self.run_export([live_row("a", layout_id=3, angle=40), live_row("d", layout_id=3, angle=40, deleted=True)])
        ov = lib.load_overrides(os.path.join(self.dir.name, "overrides.json"))
        self.assertEqual(ov.retired_ids, {"d"})
        self.assertEqual(ov.entries, [pin])

    def test_slab_filter(self):
        self.run_export([live_row("a", layout_id=3, angle=40), live_row("b", layout_id=5, angle=25)],
                        argv=["--layout", "3", "--angle", "40"])
        self.assertEqual(sorted(os.listdir(self.dir.name)), ["moonboard2024_40.json", "overrides.json"])


if __name__ == "__main__":
    unittest.main()
