"""Unit tests for the pure merge in scripts/merge_catalog.py (no network, no DB).

The first block ports every scenario of the retired rename reconciler's tests into the new world:
"staged" rows are the incoming fetch, "live" rows are the snapshot, the repeats tier of the
evidence ladder is gone, and a tombstoned counterpart lives in overrides.retired_ids instead
of the snapshot. The rest are the plan's scenarios (U3) and the shell.

Run:  python3 scripts/tests/test_merge_catalog.py
"""
import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))  # merge_catalog imports catalog_lib as a sibling


def _load(name):
    spec = importlib.util.spec_from_file_location(name, _SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


merge_mod = _load("merge_catalog")
lib = merge_mod.lib
Quarantine = merge_mod.Quarantine

H1 = [{"c": 2, "r": 12, "t": "end"}, {"c": 5, "r": 5, "t": "start"}, {"c": 7, "r": 8, "t": "right"}]
H2 = [{"c": 0, "r": 18, "t": "end"}, {"c": 4, "r": 4, "t": "start"}]
H3 = [{"c": 1, "r": 17, "t": "end"}, {"c": 3, "r": 3, "t": "start"}, {"c": 9, "r": 9, "t": "left"}]
H4 = [{"c": 6, "r": 17, "t": "end"}, {"c": 6, "r": 2, "t": "start"}]
DATE = "2026-10-09"


# ── factories ─────────────────────────────────────────────────────────────────────────

def snap_problem(pid, name, holds, setter="setter", repeats=10, uuid=None, is_benchmark=False,
                 last_seen=None, **over):
    p = {"id": pid, "boardsesh_uuid": uuid or pid, "name": name, "grade": "6B+", "userGrade": None,
         "setter": setter, "stars": 3, "repeats": repeats, "isBenchmark": is_benchmark, "method": None,
         "holds": holds, "hold_key": lib.hold_key(holds), "upstream_last_seen": last_seen}
    p.update(over)
    return p


def incoming(uuid, name, holds, setter="setter", repeats=10, is_benchmark=False, **over):
    p = {"uuid": uuid, "name": name, "grade": "6B+", "userGrade": None, "setter": setter, "stars": 3,
         "repeats": repeats, "isBenchmark": is_benchmark, "method": None, "holds": holds}
    p.update(over)
    return p


def fetch(problems, total_count=None, fetched_at=f"{DATE}T20:00:00Z", layout=3, angle=40):
    return {"fetched_at": fetched_at, "layoutId": layout, "angle": angle, "setIds": "5,6,7,8,9,10",
            "total_count": len(problems) if total_count is None else total_count,
            "count": len(problems), "problems": problems}


def snapshot(problems, layout=3, angle=40, upstream_total=1):
    # upstream_total=1 keeps the previous-total guard and its "first merge" warning quiet;
    # the guard tests pass their own value.
    return {"setup": lib.BOARDS[layout].name, "layoutId": layout, "angle": angle, "source": lib.SOURCE,
            "curation": lib.CURATION, "upstream_total": upstream_total, "count": len(problems),
            "problems": problems}


def overrides(entries=(), retired=()):
    return lib.Overrides(retired, entries)


def match(uuid, pid, layout=3, angle=40):
    return {"action": "match", "layout_id": layout, "angle": angle, "uuid": uuid, "id": pid}


def new(uuid, pid, layout=3, angle=40):
    return {"action": "new", "layout_id": layout, "angle": angle, "uuid": uuid, "id": pid}


def accept_holds(pid, key, layout=3, angle=40):
    return {"action": "accept_holds", "layout_id": layout, "angle": angle, "id": pid, "hold_key": key}


def pin(pid, field, value, layout=3, angle=40):
    return {"action": "pin", "layout_id": layout, "angle": angle, "id": pid, "field": field, "value": value}


def run(snap, fetched, ov=None, all_ids=None, others=(), **kw):
    """merge() with the global id index built the way the shell builds it: from every snapshot."""
    if all_ids is None:
        all_ids = merge_mod.index_ids([s for s in [snap, *others] if s is not None])
    return merge_mod.merge(snap, ov or overrides(), fetched, all_ids, **kw)


def by_id(snap):
    return {p["id"]: p for p in snap["problems"]}


class MergeCase(unittest.TestCase):
    def refuse(self, *args, **kw):
        with self.assertRaises(Quarantine) as cm:
            run(*args, **kw)
        return cm.exception

    def kinds(self, exc):
        return [c.kind for c in exc.cases]


# ── ported from the retired rename reconciler's tests (the evidence-ladder spec) ───────

class EvidenceTest(unittest.TestCase):
    def test_name_beats_setter_and_repeats_are_not_evidence(self):
        ev = merge_mod.evidence
        self.assertEqual(ev(incoming("a", " bingo ", H1, "x", 5), snap_problem("b", "BINGO", H1, "y", 9)), "name")
        self.assertEqual(ev(incoming("a", "new", H1, "Avien ", 5), snap_problem("b", "old", H1, "avien", 9)), "setter")
        # A carried-over ascent count was the reconciler's weakest tier; it is gone (R5).
        self.assertIsNone(ev(incoming("a", "new", H1, "x", 9), snap_problem("b", "old", H1, "y", 9)))
        self.assertIsNone(ev(incoming("a", "new", H1, "x", 8), snap_problem("b", "old", H1, "y", 9)))

    def test_blank_name_or_setter_is_not_evidence(self):
        self.assertIsNone(merge_mod.evidence(incoming("a", "", H1, "", 8), snap_problem("b", "", H1, "", 9)))


class PortedReconcileTest(MergeCase):
    def test_recased_problem_keeps_id_and_takes_new_name(self):
        snap = snapshot([snap_problem("old-uuid", "BINGO", H1, repeats=78)])
        out, report = run(snap, fetch([incoming("new-uuid", "Bingo", H1, repeats=79)]))
        row = by_id(out)["old-uuid"]
        self.assertEqual(row["boardsesh_uuid"], "new-uuid")
        self.assertEqual(row["name"], "Bingo")  # boardsesh's current name wins (R9)
        self.assertEqual(row["repeats"], 79)
        self.assertEqual([(r.id, r.old_name, r.new_name, r.evidence, r.old_uuid, r.new_uuid) for r in report.renamed],
                         [("old-uuid", "BINGO", "Bingo", "name", "old-uuid", "new-uuid")])
        self.assertEqual(report.minted, [])
        self.assertEqual(report.cases, [])

    def test_retitled_problem_by_same_setter_is_a_rename(self):
        snap = snapshot([snap_problem("old-uuid", "OAKTAPUS", H1, setter="flexbus")])
        out, report = run(snap, fetch([incoming("new-uuid", "plaktipus", list(reversed(H1)), setter="flexbus")]))
        self.assertEqual(report.renamed[0].evidence, "setter")
        self.assertEqual(by_id(out)["old-uuid"]["boardsesh_uuid"], "new-uuid")
        self.assertEqual(by_id(out)["old-uuid"]["holds"], H1)  # we own holds; the re-ordered list is not a change

    def test_name_and_setter_both_changed_is_quarantined_no_evidence(self):
        # Same holds, same ascent count, different title AND author: the reconciler needed
        # --trust-repeats; the merge never guesses (KTD4).
        snap = snapshot([snap_problem("old-uuid", "OAKTAPUS", H1, setter="flexbus", repeats=50)])
        exc = self.refuse(snap, fetch([incoming("new-uuid", "plaktipus", H1, setter="Modus Murus", repeats=50)]))
        self.assertEqual(self.kinds(exc), ["no evidence"])
        case = exc.cases[0]
        self.assertEqual(case.uuid, "new-uuid")
        self.assertEqual(case.ids, ["old-uuid"])
        self.assertEqual(case.override, {"action": "match", "layout_id": 3, "angle": 40, "uuid": "new-uuid",
                                         "id": "old-uuid", "note": case.override["note"]})
        self.assertEqual(case.alternative["action"], "new")

    def test_reset_of_a_vanished_problem_is_never_merged(self):
        snap = snapshot([snap_problem("old-uuid", "OAKTAPUS", H1, setter="flexbus", repeats=50)])
        exc = self.refuse(snap, fetch([incoming("new-uuid", "Fresh Copy", H1, setter="someone else", repeats=3)]))
        self.assertEqual(self.kinds(exc), ["no evidence"])

    def test_known_uuid_still_returned_is_an_update(self):
        snap = snapshot([snap_problem("same-uuid", "BINGO", H1)])
        out, report = run(snap, fetch([incoming("same-uuid", "BINGO", H1)]))
        self.assertEqual(report.renamed, [])
        self.assertEqual(report.minted, [])
        self.assertEqual(report.updated, 1)
        self.assertEqual(by_id(out)["same-uuid"]["boardsesh_uuid"], "same-uuid")

    def test_genuinely_new_problem_is_minted(self):
        snap = snapshot([snap_problem("old-uuid", "BINGO", H1)])
        out, report = run(snap, fetch([incoming("old-uuid", "BINGO", H1), incoming("new-uuid", "Ariadne", H2)]))
        self.assertEqual([(m.id, m.uuid, m.name, m.derived) for m in report.minted],
                         [("new-uuid", "new-uuid", "Ariadne", False)])
        self.assertEqual(sorted(by_id(out)), ["new-uuid", "old-uuid"])

    def test_distinct_problem_sharing_holds_with_a_returned_row_is_minted(self):
        # The snapshot row with the same holds is still in the fetch under its own uuid, so the
        # new row is a different problem that happens to use the same holds (R6).
        snap = snapshot([snap_problem("a-uuid", "ORIGINAL", H1)])
        out, report = run(snap, fetch([incoming("a-uuid", "ORIGINAL", H1), incoming("b-uuid", "Copycat", H1)]))
        self.assertEqual(sorted(by_id(out)), ["a-uuid", "b-uuid"])
        self.assertEqual(report.renamed, [])
        self.assertEqual([m.id for m in report.minted], ["b-uuid"])

    def test_two_absent_candidates_resolved_by_name(self):
        snap = snapshot([snap_problem("old-1", "BINGO", H1), snap_problem("old-2", "BINGO TWIN", H1)])
        out, report = run(snap, fetch([incoming("new-uuid", "Bingo", H1)]))
        self.assertEqual([(r.id, r.evidence) for r in report.renamed], [("old-1", "name")])
        self.assertEqual(by_id(out)["old-2"]["boardsesh_uuid"], "old-2")  # untouched

    def test_no_evidence_against_several_candidates_is_quarantined(self):
        snap = snapshot([snap_problem("old-1", "BINGO", H1, setter="a"), snap_problem("old-2", "BINGO TWIN", H1, setter="b")])
        exc = self.refuse(snap, fetch([incoming("new-uuid", "Something Else", H1, setter="z", repeats=99)]))
        self.assertEqual(self.kinds(exc), ["no evidence"])
        self.assertEqual(exc.cases[0].ids, ["old-1", "old-2"])

    def test_rename_wins_old_row_over_a_new_copy_regardless_of_order(self):
        # 'Bingo 25' is a genuinely new copy of BINGO's holds; 'bingo' is the rename. The rename
        # must take the old row whichever is processed first, and the copy is minted.
        for order in (("new-copy", "new-rename"), ("new-rename", "new-copy")):
            rows = {"new-copy": incoming("new-copy", "Bingo 25", H1, setter="other", repeats=12),
                    "new-rename": incoming("new-rename", "bingo", H1, setter="orig", repeats=80)}
            snap = snapshot([snap_problem("old-uuid", "BINGO", H1, setter="orig", repeats=78)])
            out, report = run(snap, fetch([rows[k] for k in order]))
            self.assertEqual([(r.id, r.new_uuid, r.evidence) for r in report.renamed],
                             [("old-uuid", "new-rename", "name")], order)
            self.assertEqual([m.id for m in report.minted], ["new-copy"], order)
            self.assertEqual(sorted(by_id(out)), ["new-copy", "old-uuid"], order)

    def test_retired_counterpart_is_quarantined_not_minted(self):
        # The reconciler's "tombstoned counterpart": the tombstone is not in the snapshot, its id
        # is in retired_ids, and boardsesh re-keying a problem back to it must not mint it (KTD6).
        snap = snapshot([snap_problem("live-twin", "Kruse", H1, setter="k")])
        ov = overrides(retired=["old-uuid"])
        exc = self.refuse(snap, fetch([incoming("live-twin", "Kruse", H1, setter="k"),
                                       incoming("old-uuid", "KRUSE", H1, setter="k")]), ov)
        self.assertEqual(self.kinds(exc), ["retired id"])
        self.assertEqual(exc.cases[0].uuid, "old-uuid")
        self.assertEqual(exc.cases[0].override["action"], "new")
        self.assertNotEqual(exc.cases[0].override["id"], "old-uuid")


# ── plan scenarios: matching ──────────────────────────────────────────────────────────

class UuidMatchTest(MergeCase):
    def test_uuid_match_updates_upstream_fields_and_last_seen_only(self):
        snap = snapshot([snap_problem("p1", "Old Name", H1, repeats=10, last_seen="2026-09-01")])
        out, report = run(snap, fetch([incoming("p1", "New Name", list(reversed(H1)), repeats=42, stars=2,
                                                grade="7A", userGrade="7A+", method="Footless", is_benchmark=True)]))
        row = by_id(out)["p1"]
        self.assertEqual(row["id"], "p1")
        self.assertEqual(row["holds"], H1)  # ours; the re-ordered list is not taken
        self.assertEqual(row["hold_key"], lib.hold_key(H1))
        self.assertEqual((row["name"], row["repeats"], row["stars"], row["grade"], row["userGrade"],
                          row["method"], row["isBenchmark"]), ("New Name", 42, 2, "7A", "7A+", "Footless", True))
        self.assertEqual(row["upstream_last_seen"], DATE)
        self.assertEqual(report.updated, 1)
        self.assertEqual(report.changed, 1)
        self.assertEqual(list(row), list(lib.PROBLEM_KEYS))

    def test_absent_row_keeps_every_field_and_old_last_seen(self):
        absent = snap_problem("gone", "Gone", H2, repeats=3, last_seen="2026-09-01", is_benchmark=True)
        snap = snapshot([absent, snap_problem("p1", "P1", H1)])
        out, _ = run(snap, fetch([incoming("p1", "P1", H1)]))
        self.assertEqual(by_id(out)["gone"], absent)  # R10, R11: nothing removed, nothing touched

    def test_existing_row_dropping_to_three_repeats_is_updated_not_dropped(self):
        snap = snapshot([snap_problem("p1", "P1", H1, repeats=50)])
        out, report = run(snap, fetch([incoming("p1", "P1", H1, repeats=3)]))
        self.assertEqual(by_id(out)["p1"]["repeats"], 3)
        self.assertEqual(report.dropped, 0)

    def test_empty_upstream_text_is_stored_as_null(self):
        # The seed stores null for an empty method/userGrade; the feed must not flip it to "".
        snap = snapshot([snap_problem("p1", "P1", H1)])
        out, report = run(snap, fetch([incoming("p1", "P1", H1, userGrade="", method="", setter=" setter ")]))
        row = by_id(out)["p1"]
        self.assertIsNone(row["userGrade"])
        self.assertIsNone(row["method"])
        self.assertEqual(row["setter"], "setter")
        self.assertEqual(report.changed, 0)


class HoldsDifferTest(MergeCase):
    def test_uuid_match_with_different_holds_is_quarantined(self):
        snap = snapshot([snap_problem("p1", "P1", H1)])
        exc = self.refuse(snap, fetch([incoming("p1", "P1", H2)]))
        self.assertEqual(self.kinds(exc), ["holds differ"])
        case = exc.cases[0]
        self.assertEqual(case.ids, ["p1"])
        self.assertEqual(case.override, {"action": "accept_holds", "layout_id": 3, "angle": 40, "id": "p1",
                                         "hold_key": lib.hold_key(H2), "note": case.override["note"]})

    def test_accept_holds_for_that_exact_key_updates_holds_and_hold_key(self):
        snap = snapshot([snap_problem("p1", "P1", H1)])
        out, report = run(snap, fetch([incoming("p1", "P1", H2)]), overrides([accept_holds("p1", lib.hold_key(H2))]))
        self.assertEqual(by_id(out)["p1"]["holds"], H2)
        self.assertEqual(by_id(out)["p1"]["hold_key"], lib.hold_key(H2))
        self.assertEqual(report.warnings, [])

    def test_accept_holds_for_another_key_still_quarantines(self):
        snap = snapshot([snap_problem("p1", "P1", H1)])
        exc = self.refuse(snap, fetch([incoming("p1", "P1", H2)]), overrides([accept_holds("p1", lib.hold_key(H3))]))
        self.assertEqual(self.kinds(exc), ["holds differ"])

    def test_accepted_holds_stay_silent_on_the_next_run(self):
        snap = snapshot([snap_problem("p1", "P1", H2)])
        _, report = run(snap, fetch([incoming("p1", "P1", H2)]), overrides([accept_holds("p1", lib.hold_key(H2))]))
        self.assertEqual(report.warnings, [])


class ContentionTest(MergeCase):
    def test_two_incoming_rows_with_evidence_for_one_absent_row_is_contention(self):
        snap = snapshot([snap_problem("old", "BINGO", H1, setter="orig")])
        exc = self.refuse(snap, fetch([incoming("u1", "Bingo", H1, setter="x"), incoming("u2", "bingo", H1, setter="y")]))
        self.assertEqual(self.kinds(exc), ["contention", "contention"])
        self.assertEqual({c.uuid for c in exc.cases}, {"u1", "u2"})
        self.assertEqual(exc.cases[0].ids, ["old"])
        self.assertEqual(exc.cases[0].override["action"], "match")
        self.assertEqual(exc.cases[0].alternative["action"], "new")
        self.assertEqual(exc.report.renamed, [])  # an order-dependent rename is exactly what we refuse

    def test_setter_evidence_losing_to_name_evidence_is_contention(self):
        snap = snapshot([snap_problem("old", "BINGO", H1, setter="orig")])
        exc = self.refuse(snap, fetch([incoming("u1", "Bingo", H1, setter="x"), incoming("u2", "Variant", H1, setter="orig")]))
        self.assertEqual([(c.kind, c.uuid) for c in exc.cases], [("contention", "u2")])
        self.assertEqual([(r.id, r.new_uuid) for r in exc.report.renamed], [("old", "u1")])

    def test_one_incoming_row_tied_between_two_absent_rows_is_contention(self):
        snap = snapshot([snap_problem("old-1", "BINGO", H1, setter="a"), snap_problem("old-2", "bingo", H1, setter="b")])
        exc = self.refuse(snap, fetch([incoming("u1", "Bingo", H1, setter="z")]))
        self.assertEqual(self.kinds(exc), ["contention"])
        self.assertEqual(exc.cases[0].ids, ["old-1", "old-2"])


class CrossSlabTest(MergeCase):
    """R26 / KTD8: boardsesh keys a problem identically at both angles."""

    def setUp(self):
        self.forty = snapshot([snap_problem("shared", "Bingo", H1, setter="orig")], angle=40)

    def test_uuid_of_another_slab_with_in_slab_geometry_match_is_a_rename_to_the_shared_uuid(self):
        snap25 = snapshot([snap_problem("old-25", "BINGO", H1, setter="orig")], angle=25)
        out, report = run(snap25, fetch([incoming("shared", "Bingo", H1, setter="orig")], angle=25), others=[self.forty])
        self.assertEqual([(r.id, r.new_uuid, r.evidence) for r in report.renamed], [("old-25", "shared", "name")])
        self.assertEqual(sorted(by_id(out)), ["old-25"])

    def test_uuid_of_another_slab_with_equal_holds_is_minted_with_a_derived_id_twice(self):
        snap25 = snapshot([], angle=25)
        f = fetch([incoming("shared", "Bingo", H1, setter="orig")], angle=25)
        out, report = run(snap25, f, others=[self.forty])
        want = lib.derived_id("shared", 25)
        self.assertEqual([(m.id, m.uuid, m.derived) for m in report.minted], [(want, "shared", True)])
        self.assertEqual(by_id(out)[want]["boardsesh_uuid"], "shared")
        again, report2 = run(out, f, others=[self.forty])
        self.assertEqual(sorted(by_id(again)), [want])
        self.assertEqual(report2.minted, [])
        self.assertEqual(report2.updated, 1)

    def test_uuid_of_another_slab_with_different_holds_is_a_collision(self):
        snap25 = snapshot([], angle=25)
        exc = self.refuse(snap25, fetch([incoming("shared", "Bingo", H2, setter="orig")], angle=25), others=[self.forty])
        self.assertEqual(self.kinds(exc), ["uuid collision"])
        case = exc.cases[0]
        self.assertEqual(case.ids, ["shared"])
        self.assertEqual(case.override["action"], "new")
        self.assertEqual(case.override["uuid"], "shared")
        self.assertNotEqual(case.override["id"], "shared")

    def test_collision_resolved_by_a_new_override_mints_the_given_id(self):
        snap25 = snapshot([], angle=25)
        ov = overrides([new("shared", "fresh-id", angle=25)])
        out, report = run(snap25, fetch([incoming("shared", "Bingo", H2, setter="orig")], angle=25), ov, others=[self.forty])
        self.assertEqual([(m.id, m.uuid) for m in report.minted], [("fresh-id", "shared")])
        self.assertEqual(by_id(out)["fresh-id"]["boardsesh_uuid"], "shared")
        self.assertEqual(by_id(out)["fresh-id"]["upstream_last_seen"], DATE)

    def test_collision_candidate_failing_curation_is_dropped_not_quarantined(self):
        snap25 = snapshot([], angle=25)
        _, report = run(snap25, fetch([incoming("shared", "Bingo", H2, setter="orig", repeats=3)], angle=25), others=[self.forty])
        self.assertEqual(report.dropped, 1)
        self.assertEqual(report.cases, [])

    def test_collision_candidate_passing_curation_reaches_the_check(self):
        snap25 = snapshot([], angle=25)
        exc = self.refuse(snap25, fetch([incoming("shared", "Bingo", H2, setter="orig", repeats=10)], angle=25), others=[self.forty])
        self.assertEqual(self.kinds(exc), ["uuid collision"])

    def test_uuid_equal_to_an_id_in_this_slab_under_another_upstream_key_is_a_collision(self):
        # Our row keeps id A after a rename re-pointed its boardsesh_uuid to B; if boardsesh then
        # returns both A and B, A cannot be minted again (R17).
        snap = snapshot([snap_problem("A", "Bingo", H1, uuid="B")])
        exc = self.refuse(snap, fetch([incoming("B", "Bingo", H1), incoming("A", "Bingo copy", H1, setter="z")]))
        self.assertEqual(self.kinds(exc), ["uuid collision"])


# ── plan scenarios: curation, guards, bootstrapping ───────────────────────────────────

class CurationTest(MergeCase):
    def test_nine_repeats_dropped_ten_minted_benchmark_minted(self):
        snap = snapshot([])
        _, report = run(snap, fetch([incoming("u9", "Nine", H1, repeats=9), incoming("u10", "Ten", H2, repeats=10),
                                     incoming("ub", "Bench", H3, repeats=0, is_benchmark=True)]))
        self.assertEqual(report.dropped, 1)
        self.assertEqual(sorted(m.id for m in report.minted), ["u10", "ub"])


class GuardTest(MergeCase):
    def test_empty_fetch_is_refused_even_with_accept_short(self):
        snap = snapshot([snap_problem("p1", "P1", H1)])
        exc = self.refuse(snap, fetch([], total_count=0), accept_short=True)
        self.assertEqual(exc.cases, [])
        self.assertTrue(any("empty fetch" in r for r in exc.refusals), exc.refusals)

    def test_fetch_at_half_the_header_total_is_refused_naming_both_counts(self):
        snap = snapshot([snap_problem("p1", "P1", H1)])
        exc = self.refuse(snap, fetch([incoming("p1", "P1", H1)], total_count=2))
        self.assertEqual(len(exc.refusals), 1)
        self.assertIn("short fetch", exc.refusals[0])
        self.assertIn("1 ", exc.refusals[0])
        self.assertIn("2", exc.refusals[0])

    def test_fetch_at_85_percent_of_the_header_total_proceeds(self):
        rows = [incoming(f"u{i}", f"P{i}", H1) for i in range(17)]
        snap = snapshot([snap_problem(f"u{i}", f"P{i}", H1) for i in range(17)])
        _, report = run(snap, fetch(rows, total_count=20))
        self.assertEqual(report.refusals, [])

    def test_fetch_short_of_the_previous_total_is_refused_but_accept_short_passes(self):
        snap = snapshot([snap_problem("p1", "P1", H1)], upstream_total=10)
        exc = self.refuse(snap, fetch([incoming("p1", "P1", H1)], total_count=1))
        self.assertIn("short fetch", exc.refusals[0])
        out, report = run(snap, fetch([incoming("p1", "P1", H1)], total_count=1), accept_short=True)
        self.assertEqual(report.refusals, [])
        self.assertTrue(any("short fetch" in w for w in report.warnings))
        self.assertEqual(out["upstream_total"], 1)

    def test_no_previous_total_warns_and_proceeds(self):
        snap = snapshot([snap_problem("p1", "P1", H1)], upstream_total=None)
        out, report = run(snap, fetch([incoming("p1", "P1", H1)], total_count=1))
        self.assertTrue(any("previous" in w for w in report.warnings), report.warnings)
        self.assertEqual(out["upstream_total"], 1)

    def test_refused_merge_still_lists_the_renames_and_mints_it_found(self):
        snap = snapshot([snap_problem("old", "BINGO", H1), snap_problem("x", "X", H3, setter="x-setter")])
        exc = self.refuse(snap, fetch([incoming("new", "Bingo", H1), incoming("fresh", "Fresh", H2),
                                       incoming("y", "Y", H3, setter="y-setter")]))
        self.assertEqual(self.kinds(exc), ["no evidence"])
        self.assertEqual([(r.id, r.new_uuid) for r in exc.report.renamed], [("old", "new")])
        self.assertEqual([m.id for m in exc.report.minted], ["fresh"])


class BootstrapTest(MergeCase):
    def test_missing_snapshot_is_refused(self):
        exc = self.refuse(None, fetch([incoming("u1", "P1", H1)]))
        self.assertTrue(any("no snapshot" in r for r in exc.refusals), exc.refusals)

    def test_new_slab_mints_every_admitted_row(self):
        out, report = run(None, fetch([incoming("u1", "P1", H1), incoming("u2", "P2", H2, repeats=2)]), new_slab=True)
        self.assertEqual([m.id for m in report.minted], ["u1"])
        self.assertEqual(report.dropped, 1)
        self.assertEqual(out["layoutId"], 3)
        self.assertEqual(out["angle"], 40)
        self.assertEqual(out["setup"], "MoonBoard 2024")
        self.assertEqual(out["curation"], lib.CURATION)
        self.assertEqual(out["upstream_total"], 2)
        self.assertEqual(list(out), list(lib.SNAPSHOT_KEYS))
        row = by_id(out)["u1"]
        self.assertEqual(list(row), list(lib.PROBLEM_KEYS))
        self.assertEqual(row["boardsesh_uuid"], "u1")
        self.assertEqual(row["hold_key"], lib.hold_key(H1))
        self.assertEqual(row["upstream_last_seen"], DATE)


# ── plan scenarios: overrides, pins, transitions ──────────────────────────────────────

class OverrideTest(MergeCase):
    def test_match_override_repoints_a_row_the_feed_would_have_minted_and_consumes_both(self):
        # Different holds and name: nothing in the rules links them; the human says they are one.
        snap = snapshot([snap_problem("ours", "Old", H1, setter="a")])
        ov = overrides([match("theirs", "ours")])
        out, report = run(snap, fetch([incoming("theirs", "Totally Different", H1, setter="b")]), ov)
        self.assertEqual(sorted(by_id(out)), ["ours"])
        self.assertEqual(by_id(out)["ours"]["boardsesh_uuid"], "theirs")
        self.assertEqual(by_id(out)["ours"]["name"], "Totally Different")
        self.assertEqual(by_id(out)["ours"]["upstream_last_seen"], DATE)
        self.assertEqual([(r.id, r.evidence, r.old_uuid, r.new_uuid) for r in report.renamed],
                         [("ours", "override", "ours", "theirs")])
        self.assertEqual(report.minted, [])
        self.assertEqual(report.cases, [])
        self.assertEqual(report.warnings, [])

    def test_match_override_keeps_the_row_out_of_the_rename_pool(self):
        # Without the override 'Copy' would claim 'ours' by setter; with it, 'ours' is consumed
        # and 'Copy' shares holds only with a returned row, so it is minted (R6).
        snap = snapshot([snap_problem("ours", "Old", H1, setter="a")])
        ov = overrides([match("theirs", "ours")])
        out, report = run(snap, fetch([incoming("theirs", "New", H1, setter="b"), incoming("copy", "Copy", H1, setter="a")]), ov)
        self.assertEqual(sorted(by_id(out)), ["copy", "ours"])
        self.assertEqual([(r.id, r.evidence) for r in report.renamed], [("ours", "override")])
        self.assertEqual([m.id for m in report.minted], ["copy"])

    def test_match_override_on_a_row_still_returned_under_its_own_uuid_is_a_conflict(self):
        snap = snapshot([snap_problem("ours", "Old", H1)])
        ov = overrides([match("theirs", "ours")])
        exc = self.refuse(snap, fetch([incoming("ours", "Old", H1), incoming("theirs", "Other", H2)]), ov)
        self.assertEqual(self.kinds(exc), ["override conflict"])
        self.assertEqual(exc.cases[0].ids, ["ours"])
        self.assertEqual(exc.cases[0].uuid, "theirs")

    def test_match_override_whose_uuid_already_belongs_to_another_row_is_a_conflict(self):
        snap = snapshot([snap_problem("ours", "Old", H1), snap_problem("other", "Other", H2, uuid="theirs")])
        ov = overrides([match("theirs", "ours")])
        exc = self.refuse(snap, fetch([incoming("theirs", "Other", H2)]), ov)
        self.assertEqual(self.kinds(exc), ["override conflict"])

    def test_two_overrides_naming_the_same_incoming_row_conflict(self):
        snap = snapshot([snap_problem("a", "A", H1), snap_problem("b", "B", H2)])
        ov = overrides([match("theirs", "a"), match("theirs", "b")])
        exc = self.refuse(snap, fetch([incoming("theirs", "A", H1)]), ov)
        self.assertEqual(self.kinds(exc), ["override conflict"])

    def test_match_override_with_different_holds_still_needs_accept_holds(self):
        snap = snapshot([snap_problem("ours", "Old", H1)])
        exc = self.refuse(snap, fetch([incoming("theirs", "Old", H2)]), overrides([match("theirs", "ours")]))
        self.assertEqual(self.kinds(exc), ["holds differ"])
        ov = overrides([match("theirs", "ours"), accept_holds("ours", lib.hold_key(H2))])
        out, _ = run(snap, fetch([incoming("theirs", "Old", H2)]), ov)
        self.assertEqual(by_id(out)["ours"]["holds"], H2)

    def test_new_override_mints_the_given_id_even_below_curation(self):
        snap = snapshot([])
        out, report = run(snap, fetch([incoming("theirs", "Thin", H1, repeats=1)]), overrides([new("theirs", "given")]))
        self.assertEqual([(m.id, m.uuid, m.derived) for m in report.minted], [("given", "theirs", False)])
        self.assertEqual(by_id(out)["given"]["boardsesh_uuid"], "theirs")

    def test_override_that_matched_nothing_warns(self):
        snap = snapshot([snap_problem("p1", "P1", H1)])
        ov = overrides([match("nope", "p1"), new("nope2", "x"), accept_holds("ghost", "a" * 64),
                        pin("ghost", "isBenchmark", True), match("p1", "ghost")])
        _, report = run(snap, fetch([incoming("p1", "P1", H1)]), ov)
        self.assertEqual(len(report.warnings), 5, report.warnings)
        self.assertTrue(all("matched nothing" in w for w in report.warnings), report.warnings)

    def test_override_for_another_slab_is_ignored_silently(self):
        snap = snapshot([snap_problem("p1", "P1", H1)])
        _, report = run(snap, fetch([incoming("p1", "P1", H1)]), overrides([match("nope", "p1", angle=25)]))
        self.assertEqual(report.warnings, [])


class PinTest(MergeCase):
    def test_pin_on_is_benchmark_holds_against_the_feed(self):
        snap = snapshot([snap_problem("p1", "P1", H1, is_benchmark=True)])
        out, report = run(snap, fetch([incoming("p1", "P1", H1, is_benchmark=False)]), overrides([pin("p1", "isBenchmark", True)]))
        self.assertTrue(by_id(out)["p1"]["isBenchmark"])
        self.assertEqual(report.transitions, [])
        self.assertEqual(report.warnings, [])

    def test_pin_on_name_does_not_silence_a_holds_quarantine(self):
        snap = snapshot([snap_problem("p1", "P1", H1)])
        exc = self.refuse(snap, fetch([incoming("p1", "Renamed", H2)]), overrides([pin("p1", "name", "P1")]))
        self.assertEqual(self.kinds(exc), ["holds differ"])


class TransitionTest(MergeCase):
    def test_benchmark_flag_transitions_in_both_directions_are_listed(self):
        snap = snapshot([snap_problem("up", "Up", H1, is_benchmark=False), snap_problem("down", "Down", H2, is_benchmark=True),
                         snap_problem("same", "Same", H3, is_benchmark=True)])
        _, report = run(snap, fetch([incoming("up", "Up", H1, is_benchmark=True), incoming("down", "Down", H2, is_benchmark=False),
                                     incoming("same", "Same", H3, is_benchmark=True)]))
        self.assertEqual(sorted(report.transitions), [("down", "Down", True, False), ("up", "Up", False, True)])


# ── determinism and invariants ────────────────────────────────────────────────────────

class DeterminismTest(MergeCase):
    def test_running_twice_on_the_same_fetch_is_byte_identical(self):
        forty = snapshot([snap_problem("shared", "Shared", H3, setter="s")], angle=40)
        snap = snapshot([snap_problem("old", "BINGO", H1, setter="orig", last_seen="2026-09-01"),
                         snap_problem("gone", "Gone", H2, repeats=3)], angle=25)
        f = fetch([incoming("new", "Bingo", H1, setter="orig", repeats=80), incoming("fresh", "Fresh", H4, setter="f"),
                   incoming("shared", "Shared", H3, setter="s")], angle=25)
        with tempfile.TemporaryDirectory() as d:
            first_path, second_path = os.path.join(d, "a.json"), os.path.join(d, "b.json")
            out1, report1 = run(snap, f, others=[forty])
            lib.write_snapshot(first_path, out1)
            out2, report2 = run(lib.read_snapshot(first_path), f, others=[forty])
            lib.write_snapshot(second_path, out2)
            self.assertEqual(pathlib.Path(first_path).read_bytes(), pathlib.Path(second_path).read_bytes())
        self.assertEqual(len(report1.renamed), 1)
        self.assertEqual(len(report1.minted), 2)
        self.assertEqual((report2.renamed, report2.minted, report2.changed), ([], [], 0))

    def test_inputs_are_not_mutated(self):
        snap = snapshot([snap_problem("old", "BINGO", H1)])
        f = fetch([incoming("new", "Bingo", H1, repeats=99)])
        before = json.dumps(snap, sort_keys=True), json.dumps(f, sort_keys=True)
        run(snap, f)
        self.assertEqual((json.dumps(snap, sort_keys=True), json.dumps(f, sort_keys=True)), before)


class InvariantTest(MergeCase):
    def test_duplicate_boardsesh_uuid_in_the_output_is_refused(self):
        # A `new` override naming a uuid that is already another row's upstream key would leave
        # two rows under one boardsesh_uuid; the invariant refuses before anything is written.
        snap = snapshot([snap_problem("p1", "P1", H1, uuid="theirs")])
        exc = self.refuse(snap, fetch([incoming("theirs", "P1", H1)]), overrides([new("theirs", "p2")]))
        self.assertEqual(exc.cases, [])
        self.assertTrue(any("boardsesh_uuid" in r and "theirs" in r for r in exc.refusals), exc.refusals)

    def test_new_override_id_colliding_with_an_existing_id_is_refused(self):
        snap = snapshot([snap_problem("p1", "P1", H1)])
        exc = self.refuse(snap, fetch([incoming("p1", "P1", H1), incoming("x", "X", H2)]), overrides([new("x", "p1")]))
        self.assertTrue(any("id" in r and "p1" in r for r in exc.refusals), exc.refusals)
        other = snapshot([snap_problem("elsewhere", "E", H3)], angle=25)
        exc = self.refuse(snap, fetch([incoming("p1", "P1", H1), incoming("x", "X", H2)]), overrides([new("x", "elsewhere")]),
                          others=[other])
        self.assertTrue(any("elsewhere" in r for r in exc.refusals), exc.refusals)

    def test_new_override_id_that_is_retired_is_refused(self):
        snap = snapshot([])
        exc = self.refuse(snap, fetch([incoming("x", "X", H2)]), overrides([new("x", "dead")], retired=["dead"]))
        self.assertTrue(any("retired" in r for r in exc.refusals), exc.refusals)

    def test_stale_hold_key_in_the_snapshot_is_refused(self):
        bad = snap_problem("p1", "P1", H1, hold_key=lib.hold_key(H2))
        exc = self.refuse(snapshot([bad]), fetch([incoming("p1", "P1", H1)]))
        self.assertTrue(any("hold_key" in r for r in exc.refusals), exc.refusals)

    def test_unsafe_id_is_refused(self):
        snap = snapshot([])
        exc = self.refuse(snap, fetch([incoming("bad id)", "X", H2)]))
        self.assertTrue(any("bad id)" in r for r in exc.refusals), exc.refusals)

    def test_fetch_for_another_slab_is_an_error(self):
        with self.assertRaises(ValueError):
            run(snapshot([], angle=40), fetch([incoming("u", "U", H1)], angle=25))

    def test_incoming_row_without_holds_is_an_error(self):
        with self.assertRaises(ValueError):
            run(snapshot([]), fetch([incoming("u", "U", [])]))

    def test_duplicate_uuid_in_the_fetch_keeps_the_first_and_warns(self):
        _, report = run(snapshot([]), fetch([incoming("u", "First", H1), incoming("u", "Second", H1)]))
        self.assertEqual([(m.id, m.name) for m in report.minted], [("u", "First")])
        self.assertTrue(any("twice" in w for w in report.warnings), report.warnings)


# ── report rendering ──────────────────────────────────────────────────────────────────

class FormatReportTest(MergeCase):
    def test_success_report_lists_renames_mints_and_transitions(self):
        snap = snapshot([snap_problem("old", "BINGO", H1, setter="orig"), snap_problem("b", "B", H2, is_benchmark=True)])
        _, report = run(snap, fetch([incoming("new", "Bingo", H1, setter="orig"), incoming("b", "B", H2, is_benchmark=False),
                                     incoming("fresh", "Fresh", H3)]))
        text = merge_mod.format_report(report, "moonboard2024_40.json")
        self.assertIn("[name] 'BINGO' -> 'Bingo'  (kept old", text)
        self.assertIn("fresh", text)
        self.assertIn("true -> false", text)
        self.assertIn("1 renamed", text)
        self.assertIn("1 minted", text)

    def test_quarantine_stanza_ends_with_a_json_override_entry(self):
        snap = snapshot([snap_problem("old-uuid", "OAKTAPUS", H1, setter="flexbus")])
        exc = self.refuse(snap, fetch([incoming("new-uuid", "plaktipus", H1, setter="Modus Murus")]))
        text = merge_mod.format_report(exc.report, "moonboard2024_40.json")
        lines = text.splitlines()
        self.assertIn("no evidence", text)
        json_lines = [line for line in lines if line.strip().startswith("{")]
        self.assertTrue(json_lines, text)
        entry = json.loads(json_lines[0])
        self.assertEqual((entry["action"], entry["uuid"], entry["id"]), ("match", "new-uuid", "old-uuid"))
        self.assertIn("REFUSED", text)


# ── shell ─────────────────────────────────────────────────────────────────────────────

class ShellTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.data = self.dir.name
        os.makedirs(os.path.join(self.data, ".upstream"))
        lib.write_snapshot(lib.snapshot_path(self.data, 3, 40), snapshot([snap_problem("old", "BINGO", H1, setter="orig")]))
        lib.write_snapshot(lib.snapshot_path(self.data, 3, 25), snapshot([snap_problem("twenty5", "T", H2)], angle=25))
        self.write_fetch(fetch([incoming("new", "Bingo", H1, setter="orig"), incoming("fresh", "Fresh", H3)]), 3, 40)
        self.write_fetch(fetch([incoming("twenty5", "T", H2)], angle=25), 3, 25)

    def tearDown(self):
        self.dir.cleanup()

    def write_fetch(self, f, layout, angle):
        with open(lib.fetch_path(self.data, layout, angle), "w") as fh:
            json.dump(f, fh)

    def main(self, *argv):
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["merge_catalog.py", "--dir", self.data, *argv]), redirect_stdout(out):
            try:
                merge_mod.main()
                code = 0
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()

    def test_writes_the_snapshot_and_reports(self):
        code, text = self.main("--layout", "3", "--angle", "40")
        self.assertEqual(code, 0, text)
        self.assertIn("[name] 'BINGO' -> 'Bingo'", text)
        back = lib.read_snapshot(lib.snapshot_path(self.data, 3, 40))
        self.assertEqual(sorted(p["id"] for p in back["problems"]), ["fresh", "old"])
        self.assertEqual(by_id(back)["old"]["boardsesh_uuid"], "new")
        self.assertEqual(back["upstream_total"], 2)

    def test_dry_run_writes_nothing(self):
        before = pathlib.Path(lib.snapshot_path(self.data, 3, 40)).read_bytes()
        code, text = self.main("--layout", "3", "--angle", "40", "--dry-run")
        self.assertEqual(code, 0, text)
        self.assertEqual(pathlib.Path(lib.snapshot_path(self.data, 3, 40)).read_bytes(), before)

    def test_default_angles_are_every_snapshot_of_the_layout(self):
        code, text = self.main("--layout", "3")
        self.assertEqual(code, 0, text)
        self.assertIn("moonboard2024_25.json", text)
        self.assertIn("moonboard2024_40.json", text)

    def test_quarantine_exits_two_and_writes_nothing(self):
        self.write_fetch(fetch([incoming("new", "plaktipus", H1, setter="Modus Murus")]), 3, 40)
        before = pathlib.Path(lib.snapshot_path(self.data, 3, 40)).read_bytes()
        code, text = self.main("--layout", "3", "--angle", "40")
        self.assertEqual(code, 2)
        self.assertIn('"action": "match"', text)
        self.assertEqual(pathlib.Path(lib.snapshot_path(self.data, 3, 40)).read_bytes(), before)

    def test_new_slab_bootstraps_a_missing_snapshot(self):
        self.write_fetch(fetch([incoming("m1", "M1", H1)], layout=7, angle=40), 7, 40)
        code, text = self.main("--layout", "7", "--angle", "40")
        self.assertEqual(code, 2, text)  # refused without the flag
        self.assertFalse(os.path.exists(lib.snapshot_path(self.data, 7, 40)))
        code, text = self.main("--layout", "7", "--angle", "40", "--new-slab")
        self.assertEqual(code, 0, text)
        self.assertEqual([p["id"] for p in lib.read_snapshot(lib.snapshot_path(self.data, 7, 40))["problems"]], ["m1"])

    def test_explicit_fetch_path(self):
        alt = os.path.join(self.data, "alt.json")
        with open(alt, "w") as fh:
            json.dump(fetch([incoming("old", "BINGO", H1, setter="orig")]), fh)
        code, text = self.main("--layout", "3", "--angle", "40", "--fetch", alt, "--dry-run")
        self.assertEqual(code, 0, text)
        self.assertIn("0 renamed", text)


if __name__ == "__main__":
    unittest.main()
