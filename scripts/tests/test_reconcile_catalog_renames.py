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


def staged(pid, name, holds, setter="setter", repeats=10):
    return {"id": pid, "name": name, "grade": "6B+", "setter": setter, "repeats": repeats, "holds": holds}


def live(pid, name, holds, setter="setter", repeats=10, deleted=False):
    return {"source_catalog_id": pid, "name": name, "setter": setter, "repeats": repeats,
            "holds": holds, "deleted": deleted}


class EvidenceTest(unittest.TestCase):
    def test_name_beats_setter_beats_repeats(self):
        self.assertEqual(rec.evidence(staged("a", " bingo ", H1, "x", 5), live("b", "BINGO", H1, "y", 9)), "name")
        self.assertEqual(rec.evidence(staged("a", "new", H1, "Avien ", 5), live("b", "old", H1, "avien", 9)), "setter")
        self.assertEqual(rec.evidence(staged("a", "new", H1, "x", 9), live("b", "old", H1, "y", 9)), "repeats")
        self.assertIsNone(rec.evidence(staged("a", "new", H1, "x", 8), live("b", "old", H1, "y", 9)))

    def test_blank_name_or_setter_is_not_evidence(self):
        self.assertEqual(rec.evidence(staged("a", "", H1, "", 8), live("b", "", H1, "", 9)), None)


class ReconcileTest(unittest.TestCase):
    def test_recased_problem_keeps_live_uuid_and_new_name(self):
        s = [staged("new-uuid", "Bingo", H1, repeats=79)]
        remapped, unresolved = rec.reconcile(s, [live("old-uuid", "BINGO", H1, repeats=78)])
        self.assertEqual(remapped, [("new-uuid", "old-uuid", "Bingo", "BINGO", "name")])
        self.assertEqual(unresolved, [])
        self.assertEqual(s[0]["id"], "old-uuid")
        self.assertEqual(s[0]["name"], "Bingo")  # boardsesh's current name wins
        self.assertEqual(s[0]["repeats"], 79)

    def test_retitled_problem_by_same_setter_is_remapped(self):
        s = [staged("new-uuid", "plaktipus", list(reversed(H1)), setter="flexbus")]
        remapped, _ = rec.reconcile(s, [live("old-uuid", "OAKTAPUS", H1, setter="flexbus")])
        self.assertEqual(remapped[0][1:], ("old-uuid", "plaktipus", "OAKTAPUS", "setter"))
        self.assertEqual(s[0]["id"], "old-uuid")

    def test_name_and_setter_both_changed_needs_trust_repeats(self):
        # Same holds, same ascent count, but a different title AND author: could be the same
        # record re-attributed, or a re-set of a deleted problem. Report by default.
        s = [staged("new-uuid", "plaktipus", H1, setter="Modus Murus", repeats=50)]
        lv = [live("old-uuid", "OAKTAPUS", H1, setter="flexbus", repeats=50)]
        remapped, unresolved = rec.reconcile(s, lv)
        self.assertEqual(remapped, [])
        self.assertEqual(unresolved, [("new-uuid", "plaktipus", [("OAKTAPUS", "repeats", False)])])
        self.assertEqual(s[0]["id"], "new-uuid")

        s = [staged("new-uuid", "plaktipus", H1, setter="Modus Murus", repeats=50)]
        remapped, unresolved = rec.reconcile(s, lv, trust_repeats=True)
        self.assertEqual(remapped, [("new-uuid", "old-uuid", "plaktipus", "OAKTAPUS", "repeats")])
        self.assertEqual(s[0]["id"], "old-uuid")

    def test_reset_of_deleted_problem_is_never_merged(self):
        # Fewer ascents than the old row + different name + different setter: a re-set, not a rename.
        s = [staged("new-uuid", "Fresh Copy", H1, setter="someone else", repeats=3)]
        remapped, unresolved = rec.reconcile(s, [live("old-uuid", "OAKTAPUS", H1, setter="flexbus", repeats=50)], trust_repeats=True)
        self.assertEqual(remapped, [])
        self.assertEqual(unresolved, [("new-uuid", "Fresh Copy", [("OAKTAPUS", None, False)])])
        self.assertEqual(s[0]["id"], "new-uuid")

    def test_live_uuid_still_staged_is_untouched(self):
        s = [staged("same-uuid", "BINGO", H1)]
        self.assertEqual(rec.reconcile(s, [live("same-uuid", "BINGO", H1)]), ([], []))
        self.assertEqual(s[0]["id"], "same-uuid")

    def test_genuinely_new_problem_is_left_as_new(self):
        s = [staged("new-uuid", "Ariadne", H2)]
        self.assertEqual(rec.reconcile(s, [live("old-uuid", "BINGO", H1)]), ([], []))
        self.assertEqual(s[0]["id"], "new-uuid")

    def test_distinct_problem_sharing_holds_with_a_still_staged_row_is_not_merged(self):
        # The live row with the same holds is still in the fetch under its own uuid, so the
        # new row is a different problem that happens to use the same holds — keep both.
        s = [staged("a-uuid", "ORIGINAL", H1), staged("b-uuid", "Copycat", H1)]
        self.assertEqual(rec.reconcile(s, [live("a-uuid", "ORIGINAL", H1)]), ([], []))
        self.assertEqual([p["id"] for p in s], ["a-uuid", "b-uuid"])

    def test_two_live_candidates_resolved_by_name(self):
        s = [staged("new-uuid", "Bingo", H1)]
        lv = [live("old-1", "BINGO", H1), live("old-2", "BINGO TWIN", H1)]
        remapped, unresolved = rec.reconcile(s, lv)
        self.assertEqual(remapped, [("new-uuid", "old-1", "Bingo", "BINGO", "name")])
        self.assertEqual(unresolved, [])

    def test_tied_candidates_are_reported_not_remapped(self):
        s = [staged("new-uuid", "Something Else", H1, setter="z", repeats=99)]
        lv = [live("old-1", "BINGO", H1, setter="a"), live("old-2", "BINGO TWIN", H1, setter="b")]
        remapped, unresolved = rec.reconcile(s, lv, trust_repeats=True)
        self.assertEqual(remapped, [])
        self.assertEqual(unresolved, [("new-uuid", "Something Else",
                                       [("BINGO", "repeats", False), ("BINGO TWIN", "repeats", False)])])
        self.assertEqual(s[0]["id"], "new-uuid")

    def test_rename_wins_old_uuid_over_a_new_copy_regardless_of_order(self):
        # 'Bingo 25' is a genuinely new copy of BINGO's holds; 'bingo' is the rename. The rename
        # must take the old uuid even when the copy is processed first.
        for order in (("new-copy", "new-rename"), ("new-rename", "new-copy")):
            rows = {"new-copy": staged("new-copy", "Bingo 25", H1, setter="other", repeats=12),
                    "new-rename": staged("new-rename", "bingo", H1, setter="orig", repeats=80)}
            s = [rows[k] for k in order]
            remapped, unresolved = rec.reconcile(s, [live("old-uuid", "BINGO", H1, setter="orig", repeats=78)],
                                                 trust_repeats=True)
            self.assertEqual(remapped, [("new-rename", "old-uuid", "bingo", "BINGO", "name")], order)
            self.assertEqual(rows["new-rename"]["id"], "old-uuid")
            self.assertEqual(rows["new-copy"]["id"], "new-copy")
            self.assertEqual(unresolved, [("new-copy", "Bingo 25", [])], order)

    def test_tombstoned_counterpart_is_reported_not_remapped(self):
        s = [staged("new-uuid", "Kruse", H1)]
        remapped, unresolved = rec.reconcile(s, [live("old-uuid", "KRUSE", H1, deleted=True)])
        self.assertEqual(remapped, [])
        self.assertEqual(unresolved, [("new-uuid", "Kruse", [("KRUSE", "name", True)])])
        self.assertEqual(s[0]["id"], "new-uuid")


if __name__ == "__main__":
    unittest.main()
