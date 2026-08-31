"""Unit tests for the pure top-up logic in seed_beta_videos.py (no network, no DB).

Run:  python3 scripts/tests/test_seed_beta_videos.py
"""
import importlib.util
import pathlib
import unittest

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


if __name__ == "__main__":
    unittest.main()
