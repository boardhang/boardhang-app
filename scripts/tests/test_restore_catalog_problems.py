"""Unit tests for scripts/restore_catalog_problems.py — restore from a backup, plus the slab-scoped
rollback flag that tombstones live rows absent from the backup (no network, no DB).

Run:  python3 scripts/tests/test_restore_catalog_problems.py
"""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

from catalog_fakes import ClampingServer, live_row

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
_spec = importlib.util.spec_from_file_location("restore_catalog_problems", _SCRIPTS / "restore_catalog_problems.py")
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)
lib = mod.lib

ENV = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "service"}
ANON_ENV = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "", "SUPABASE_ANON_KEY": "anon"}


def backup_row(pid, **over):
    row = live_row(pid, **over)
    row["updated_at"] = "2026-10-09T00:00:00+00:00"
    return row


def ids(rows):
    return [r["source_catalog_id"] for r in rows]


class AbsentFromBackupTest(unittest.TestCase):
    def test_live_rows_in_the_slab_missing_from_the_backup(self):
        backup = [backup_row("a"), backup_row("b", angle=25)]
        prod = [live_row("a"), live_row("new"), live_row("b", angle=25), live_row("new25", angle=25)]
        self.assertEqual(mod.absent_from_backup(backup, prod, 3, 40), ["new"])

    def test_tombstoned_rows_and_other_slabs_are_left_alone(self):
        backup = [backup_row("a")]
        prod = [live_row("a"), live_row("zombie", deleted=True), live_row("other", layout_id=2),
                live_row("other25", angle=25), live_row("new")]
        self.assertEqual(mod.absent_from_backup(backup, prod, 3, 40), ["new"])
        self.assertEqual(mod.absent_from_backup(backup, prod, 3, 25), ["other25"])
        self.assertEqual(mod.absent_from_backup(backup, prod, 2, 40), ["other"])

    def test_sorted_and_deduplicated(self):
        prod = [live_row("b"), live_row("a"), live_row("a")]
        self.assertEqual(mod.absent_from_backup([], prod, 3, 40), ["a", "b"])


class ShellCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.backup_path = os.path.join(self._tmp.name, "catalog_problems_backup_test.json")

    def write_backup(self, rows):
        with open(self.backup_path, "w") as f:
            json.dump({"table": "catalog_problems", "count": len(rows), "rows": rows}, f)

    def run_restore(self, server, *argv, env=ENV):
        out = io.StringIO()
        code = None
        with mock.patch.object(lib, "urlopen", server), mock.patch.dict(lib.os.environ, env), \
                contextlib.redirect_stdout(out):
            try:
                mod.main([self.backup_path] + list(argv))
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()


class RestoreTest(ShellCase):
    def test_restores_rows_verbatim_including_deleted_in_batches_of_500(self):
        rows = [backup_row(f"p{i:04d}", repeats=5) for i in range(600)] + [backup_row("t", deleted=True)]
        self.write_backup(rows)
        server = ClampingServer([live_row("p0000", repeats=10), live_row("t", deleted=False)])
        code, out = self.run_restore(server)
        self.assertIn(code, (None, 0), out)
        writes = [(m, body) for m, _, body in server.writes]
        self.assertEqual([m for m, _ in writes], ["POST", "POST"])
        self.assertEqual([len(body) for _, body in writes], [500, 101])
        for _, body in writes:
            for row in body:
                self.assertEqual(set(row), set(lib.ROW_COLUMNS))
                self.assertNotIn("updated_at", row)
        self.assertEqual(server.row("p0000")["repeats"], 5)
        self.assertIs(server.row("t")["deleted"], True)
        self.assertEqual(len(server.rows), 601)

    def test_without_the_flag_nothing_is_tombstoned(self):
        self.write_backup([backup_row("a")])
        server = ClampingServer([live_row("a"), live_row("inserted")])
        code, out = self.run_restore(server)
        self.assertIn(code, (None, 0), out)
        self.assertEqual([m for m, _, _ in server.writes], ["POST"])
        self.assertIs(server.row("inserted")["deleted"], False)

    def test_requires_the_service_role_key(self):
        self.write_backup([backup_row("a")])
        server = ClampingServer([])
        code, out = self.run_restore(server, env=ANON_ENV)
        self.assertNotIn(code, (None, 0))
        self.assertEqual(server.requests, [])

    def test_rejects_a_file_that_is_not_a_dump(self):
        with open(self.backup_path, "w") as f:
            json.dump({"problems": [], "layoutId": 3}, f)
        server = ClampingServer([])
        code, out = self.run_restore(server)
        self.assertNotIn(code, (None, 0))
        self.assertEqual(server.writes, [])


class TombstoneAbsentTest(ShellCase):
    def test_tombstones_live_rows_absent_from_the_backup_in_that_slab_only(self):
        self.write_backup([backup_row("a"), backup_row("b", angle=25)])
        server = ClampingServer([
            live_row("a"), live_row("inserted40"), live_row("zombie", deleted=True),
            live_row("b", angle=25), live_row("inserted25", angle=25),
            live_row("other", layout_id=2),
        ])
        code, out = self.run_restore(server, "--tombstone-absent", "--layout", "3", "--angle", "40")
        self.assertIn(code, (None, 0), out)
        self.assertIn("inserted40", out)
        self.assertIs(server.row("inserted40")["deleted"], True)
        self.assertIs(server.row("inserted25")["deleted"], False)
        self.assertIs(server.row("other")["deleted"], False)
        self.assertIs(server.row("a")["deleted"], False)
        self.assertIs(server.row("b")["deleted"], False)
        self.assertIs(server.row("zombie")["deleted"], True)
        patches = [(url, body) for m, url, body in server.writes if m == "PATCH"]
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0][1], {"deleted": True})
        self.assertIn("source_catalog_id=in.(", patches[0][0])
        self.assertIn("inserted40", patches[0][0])
        self.assertNotIn("inserted25", patches[0][0])
        self.assertNotIn("zombie", patches[0][0])
        # the restore upsert goes first, the tombstone PATCH after
        self.assertEqual([m for m, _, _ in server.writes], ["POST", "PATCH"])

    def test_patch_goes_out_in_batches_of_at_most_200(self):
        self.write_backup([backup_row("a")])
        server = ClampingServer([live_row("a")] + [live_row(f"x{i:04d}") for i in range(450)])
        code, out = self.run_restore(server, "--tombstone-absent", "--layout", "3", "--angle", "40")
        self.assertIn(code, (None, 0), out)
        patches = [url for m, url, _ in server.writes if m == "PATCH"]
        self.assertEqual(len(patches), 3)
        for url in patches:
            self.assertLessEqual(url.count('"') // 2, 200)
        self.assertTrue(all(server.row(f"x{i:04d}")["deleted"] is True for i in range(450)))
        self.assertIs(server.row("a")["deleted"], False)

    def test_nothing_absent_means_no_patch(self):
        self.write_backup([backup_row("a")])
        server = ClampingServer([live_row("a"), live_row("z", deleted=True)])
        code, out = self.run_restore(server, "--tombstone-absent", "--layout", "3", "--angle", "40")
        self.assertIn(code, (None, 0), out)
        self.assertEqual([m for m, _, _ in server.writes], ["POST"])

    def test_flag_refuses_without_layout_and_angle(self):
        self.write_backup([backup_row("a")])
        for argv in (["--tombstone-absent"], ["--tombstone-absent", "--layout", "3"],
                     ["--tombstone-absent", "--angle", "40"]):
            with self.subTest(argv=argv):
                server = ClampingServer([live_row("a"), live_row("inserted")])
                code, out = self.run_restore(server, *argv)
                self.assertNotIn(code, (None, 0))
                self.assertEqual(server.writes, [])
                self.assertIs(server.row("inserted")["deleted"], False)

    def test_refuses_an_unsafe_id_before_building_a_filter(self):
        self.write_backup([backup_row("a")])
        server = ClampingServer([live_row("a"), live_row("bad)id")])
        code, out = self.run_restore(server, "--tombstone-absent", "--layout", "3", "--angle", "40")
        self.assertNotIn(code, (None, 0))
        self.assertEqual([m for m, _, _ in server.writes], ["POST"])
        self.assertIs(server.row("bad)id")["deleted"], False)


if __name__ == "__main__":
    unittest.main()
