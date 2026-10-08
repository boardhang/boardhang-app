"""Unit tests for the pure remap logic in reconcile_catalog_renames.py (no network, no DB).

Run:  python3 scripts/tests/test_reconcile_catalog_renames.py
"""
import importlib.util
import pathlib
import unittest

_SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "reconcile_catalog_renames.py"
_spec = importlib.util.spec_from_file_location("reconcile_catalog_renames", _SCRIPT)
rec = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rec)

H1 = [{"c": 2, "r": 12, "t": "end"}, {"c": 5, "r": 5, "t": "start"}, {"c": 7, "r": 8, "t": "right"}]
H2 = [{"c": 0, "r": 18, "t": "end"}, {"c": 4, "r": 4, "t": "start"}]


def staged(pid, name, holds, **extra):
    return {"id": pid, "name": name, "grade": "6B+", "repeats": 10, "holds": holds, **extra}


def live(pid, name, holds):
    return {"source_catalog_id": pid, "name": name, "holds": holds}


class ReconcileTest(unittest.TestCase):
    def test_renamed_problem_keeps_live_uuid_and_new_name(self):
        s = [staged("new-uuid", "Bingo", H1, repeats=79)]
        remapped, ambiguous = rec.reconcile(s, [live("old-uuid", "BINGO", H1)])
        self.assertEqual(remapped, [("new-uuid", "old-uuid", "Bingo", "BINGO")])
        self.assertEqual(ambiguous, [])
        self.assertEqual(s[0]["id"], "old-uuid")
        self.assertEqual(s[0]["name"], "Bingo")  # boardsesh's current name wins
        self.assertEqual(s[0]["repeats"], 79)

    def test_hold_order_does_not_matter(self):
        s = [staged("new-uuid", "plaktipus", list(reversed(H1)))]
        remapped, _ = rec.reconcile(s, [live("old-uuid", "OAKTAPUS", H1)])
        self.assertEqual(len(remapped), 1)
        self.assertEqual(s[0]["id"], "old-uuid")

    def test_live_uuid_still_staged_is_untouched(self):
        s = [staged("same-uuid", "BINGO", H1)]
        remapped, ambiguous = rec.reconcile(s, [live("same-uuid", "BINGO", H1)])
        self.assertEqual((remapped, ambiguous), ([], []))
        self.assertEqual(s[0]["id"], "same-uuid")

    def test_genuinely_new_problem_is_left_as_new(self):
        s = [staged("new-uuid", "Ariadne", H2)]
        remapped, ambiguous = rec.reconcile(s, [live("old-uuid", "BINGO", H1)])
        self.assertEqual((remapped, ambiguous), ([], []))
        self.assertEqual(s[0]["id"], "new-uuid")

    def test_distinct_problem_sharing_holds_with_a_still_staged_row_is_not_merged(self):
        # The live row with the same holds is still in the fetch under its own uuid, so the
        # new row is a different problem that happens to use the same holds — keep both.
        s = [staged("a-uuid", "ORIGINAL", H1), staged("b-uuid", "Copycat", H1)]
        remapped, ambiguous = rec.reconcile(s, [live("a-uuid", "ORIGINAL", H1)])
        self.assertEqual((remapped, ambiguous), ([], []))
        self.assertEqual([p["id"] for p in s], ["a-uuid", "b-uuid"])

    def test_two_candidates_resolved_by_casefolded_name(self):
        s = [staged("new-uuid", "Bingo", H1)]
        lv = [live("old-1", "BINGO", H1), live("old-2", "BINGO TWIN", H1)]
        remapped, ambiguous = rec.reconcile(s, lv)
        self.assertEqual(remapped, [("new-uuid", "old-1", "Bingo", "BINGO")])
        self.assertEqual(ambiguous, [])

    def test_unresolvable_candidates_are_reported_not_remapped(self):
        s = [staged("new-uuid", "Something Else", H1)]
        lv = [live("old-1", "BINGO", H1), live("old-2", "BINGO TWIN", H1)]
        remapped, ambiguous = rec.reconcile(s, lv)
        self.assertEqual(remapped, [])
        self.assertEqual(ambiguous, [("new-uuid", "Something Else", ["BINGO", "BINGO TWIN"])])
        self.assertEqual(s[0]["id"], "new-uuid")

    def test_each_live_row_is_consumed_once(self):
        # Two staged rows with identical holds, one old live row: only one may claim it.
        s = [staged("new-1", "Bingo", H1), staged("new-2", "Bingo 25", H1)]
        remapped, ambiguous = rec.reconcile(s, [live("old-uuid", "BINGO", H1)])
        self.assertEqual(len(remapped), 1)
        self.assertEqual(ambiguous, [])
        self.assertEqual(sorted(p["id"] for p in s), ["new-2", "old-uuid"])


if __name__ == "__main__":
    unittest.main()
