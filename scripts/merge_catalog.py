#!/usr/bin/env python3
"""
Merge a boardsesh fetch into the canonical catalog snapshot — or refuse.

    fetch_boardsesh.py ──► catalog-data/.upstream/<slug>_<angle>.json
                                        │
                       merge_catalog.py ◄── catalog-data/overrides.json (committed verdicts)
                                        ▼
                       catalog-data/<slug>_<angle>.json  (canonical, committed; rewritten in place)

The snapshot is ours. `id` is our identity for a problem and never changes once minted;
`boardsesh_uuid` beside it is the upstream key, which boardsesh re-derives from name+setter
and so may change. The merge's job is to decide, for every incoming row, which of our rows
it is — and to refuse rather than guess, because a wrong identity decision moves users'
ascents and lists onto the wrong problem (KTD4). NOTHING IN THE MERGE EVER REMOVES OR
TOMBSTONES A ROW (R11): a problem boardsesh no longer returns keeps every field and its old
`upstream_last_seen`.

Rules, in the order they run (see docs/plans/2026-10-09-002 … U3 for the full spec):

  overrides   entries for this slab resolve first and consume the rows they name (R14):
              `match` uuid→id re-points our row's boardsesh_uuid, `new` mints the uuid as
              a given id, `accept_holds` allows one exact geometry change, `pin` holds an
              upstream field against the feed (applied last).
  guards      an empty fetch is always refused; a fetch below 80% of its own header total
              or of the previous fetch's total is refused unless --accept-short (R16).
  uuid match  incoming uuid == our boardsesh_uuid: update the upstream-owned fields (R4,
              R9); holds must still equal ours, else quarantine "holds differ".
  geometry    an unknown uuid whose hold_key equals a snapshot row this fetch did NOT
              return is a rename when exactly one such row matches by name or setter —
              keep the id, re-point boardsesh_uuid (R5). No evidence, or several incoming
              rows contending for one row, is quarantined. Holds shared only with rows the
              fetch did return make a distinct problem (R6).
  curation    remaining unknown rows must be benchmarks or have >= 10 repeats (R8).
  mint        a uuid equal to a retired id is quarantined (KTD6); a uuid that is already
              our id in another slab is the same problem at this angle when its holds
              equal that row's — minted with a derived id (R26, KTD8) — and quarantined
              "uuid collision" when they differ; everything else is minted with id = uuid.
  invariants  ids unique across every snapshot, boardsesh_uuid unique in the slab, every
              id plain, every stored hold_key equal to the recomputed one (R17).

Every stage runs to completion collecting quarantine cases; the merge refuses only at the
end, so a refusal still prints the renames, updates and mints it would have made (R13).
Each case prints a ready-to-paste entry for catalog-data/overrides.json. The loop is:
run, read the stanza, record the verdict in overrides.json, commit it, run again.

Usage
-----
  python3 scripts/merge_catalog.py --layout 3 --angle 40            # merge one slab
  python3 scripts/merge_catalog.py --layout 3                       # every angle with a snapshot
  python3 scripts/merge_catalog.py --layout 3 --angle 25 --dry-run  # report only
  python3 scripts/merge_catalog.py --layout 7 --angle 40 --new-slab # bootstrap a board
  python3 scripts/merge_catalog.py --layout 3 --angle 40 --fetch /tmp/alt.json --accept-short

Exit status: 0 merged (or dry run clean), 2 refused (quarantine, guard or invariant).
The pure core is `merge(...)`; tests load this module by path (scripts/tests/test_merge_catalog.py).
"""

import argparse
import copy
import json
import os
import sys
from collections import namedtuple
from dataclasses import dataclass, field

try:
    import catalog_lib as lib
except ImportError:  # loaded by path (tests) without scripts/ on sys.path
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import catalog_lib as lib

SHORT_FETCH_RATIO = 0.8          # R16
EVIDENCE = ("name", "setter")    # strongest first; repeats are NOT evidence (R5)
KINDS = ("holds differ", "no evidence", "contention", "retired id", "uuid collision", "override conflict")

IdRef = namedtuple("IdRef", "layout angle hold_key")


# ── report ────────────────────────────────────────────────────────────────────────────

@dataclass
class Rename:
    id: str
    old_name: str
    new_name: str
    evidence: str          # "name", "setter" or "override"
    old_uuid: str
    new_uuid: str


@dataclass
class Mint:
    id: str
    uuid: str
    name: str
    derived: bool


@dataclass
class Case:
    kind: str
    uuid: str              # the incoming row
    name: str
    ids: list              # our rows involved
    detail: str
    override: dict         # ready-to-paste overrides.json entry (None for an override conflict)
    alternative: dict = None


@dataclass
class Report:
    layout: int
    angle: int
    fetched_at: str
    snapshot_count: int = 0
    returned: int = 0
    header_total: int = None
    previous_total: int = None
    updated: int = 0           # existing rows the fetch returned (upstream fields refreshed)
    changed: int = 0           # of those, rows where an upstream field actually changed
    renamed: list = field(default_factory=list)      # [Rename]
    minted: list = field(default_factory=list)       # [Mint]
    dropped: int = 0           # new rows that failed curation
    transitions: list = field(default_factory=list)  # [(id, name, old_flag, new_flag)]
    warnings: list = field(default_factory=list)
    refusals: list = field(default_factory=list)     # guard and invariant failures
    cases: list = field(default_factory=list)        # [Case]


class Quarantine(Exception):
    """The merge refused. `.report` is the complete report, `.cases` the classified
    quarantine cases (each with an override entry), `.refusals` the guard/invariant failures."""

    def __init__(self, report):
        self.report = report
        self.cases = report.cases
        self.refusals = report.refusals
        kinds = ", ".join(sorted({c.kind for c in report.cases}))
        super().__init__(f"{len(report.cases)} quarantined case(s){f' ({kinds})' if kinds else ''}, "
                         f"{len(report.refusals)} refusal(s){': ' + report.refusals[0] if report.refusals else ''}")


# ── helpers ───────────────────────────────────────────────────────────────────────────

def index_ids(snapshots):
    """The global id index the cross-slab checks need: id -> IdRef(layout, angle, hold_key),
    built from every snapshot (the current slab included)."""
    index = {}
    for s in snapshots:
        slab = (s["layoutId"], s["angle"])
        for p in s["problems"]:
            ref = IdRef(slab[0], slab[1], lib.hold_key(p["holds"]))
            prior = index.get(p["id"])
            if prior is not None and (prior.layout, prior.angle) != slab:
                raise ValueError(f"id {p['id']} is in two slabs: {prior.layout}@{prior.angle} and {slab[0]}@{slab[1]}")
            index[p["id"]] = ref
    return index


def evidence(incoming, row):
    """Strongest reason to believe a geometry match is the same boardsesh record, or None.
    Same name (case/whitespace-insensitive) beats same setter; a blank field is no evidence."""
    for kind in EVIDENCE:
        ours, theirs = lib.norm_text(row.get(kind)), lib.norm_text(incoming.get(kind))
        if theirs and theirs == ours:
            return kind
    return None


def upstream_fields(incoming):
    """The upstream-owned fields of a fetch row, normalized like `lib.problem_from_live` so
    a re-run and the seed agree byte for byte (R9)."""
    return {
        "name": incoming.get("name") or "",
        "grade": incoming.get("grade") or "",
        "userGrade": lib.nullable_text(incoming.get("userGrade")),
        "setter": (incoming.get("setter") or "").strip(),
        "stars": int(incoming.get("stars") or 0),
        "repeats": int(incoming.get("repeats") or 0),
        "isBenchmark": bool(incoming.get("isBenchmark")),
        "method": lib.nullable_text(incoming.get("method")),
    }


def _validate_fetch(fetch):
    for key in ("fetched_at", "layoutId", "angle", "problems"):
        if key not in fetch:
            raise ValueError(f"fetch file is missing {key!r}")
    stamp = str(fetch["fetched_at"])
    if len(stamp) < 10 or stamp[4] != "-" or stamp[7] != "-":
        raise ValueError(f"fetched_at {stamp!r} is not an ISO timestamp")
    if fetch["layoutId"] not in lib.BOARDS:
        raise ValueError(f"unknown layoutId {fetch['layoutId']!r}")
    for i, p in enumerate(fetch["problems"]):
        if not p.get("uuid"):
            raise ValueError(f"fetch problems[{i}] has no uuid")
        if not isinstance(p.get("holds"), list) or not p["holds"]:
            raise ValueError(f"fetch problems[{i}] ({p['uuid']}) has no holds")
    return fetch["layoutId"], fetch["angle"], stamp[:10]


def _validate_snapshot(snapshot, layout, angle):
    if (snapshot.get("layoutId"), snapshot.get("angle")) != (layout, angle):
        raise ValueError(f"fetch is for layout {layout} @ {angle}° but the snapshot is "
                         f"layout {snapshot.get('layoutId')} @ {snapshot.get('angle')}°")
    for p in snapshot["problems"]:
        if set(p) != set(lib.PROBLEM_KEYS):
            raise ValueError(f"snapshot problem {p.get('id')!r} does not have exactly the keys {lib.PROBLEM_KEYS}")


def _empty_snapshot(layout, angle):
    return {"setup": lib.BOARDS[layout].name, "layoutId": layout, "angle": angle, "source": lib.SOURCE,
            "curation": lib.CURATION, "upstream_total": None, "count": 0, "problems": []}


# ── the merge ─────────────────────────────────────────────────────────────────────────

class _Merge:
    """One merge run. Each method is a stage; `run()` strings them together."""

    def __init__(self, snapshot, overrides, fetch, all_ids, accept_short, date, report):
        self.layout, self.angle, self.date = snapshot["layoutId"], snapshot["angle"], date
        self.slab = (self.layout, self.angle)
        self.overrides, self.all_ids, self.accept_short = overrides, all_ids, accept_short
        self.fetch, self.report = fetch, report
        self.setup = snapshot.get("setup") or lib.BOARDS[self.layout].name

        self.rows = copy.deepcopy(snapshot["problems"])
        self.by_id = {r["id"]: r for r in self.rows}
        self.by_uuid = {}
        for r in self.rows:
            self.by_uuid.setdefault(r["boardsesh_uuid"], r)   # a duplicate is caught by the invariants
        # Decisions compare the RECOMPUTED key, never the stored string alone (R3).
        self.key_of = {r["id"]: lib.hold_key(r["holds"]) for r in self.rows}
        self.old_flags = {r["id"]: bool(r["isBenchmark"]) for r in self.rows}

        self.incoming = self._dedupe(fetch["problems"])
        self.inc_by_uuid = {p["uuid"]: p for p in self.incoming}

        self.returned_ids = set()     # our rows the fetch returned (matched, renamed or overridden)
        self.consumed_uuids = set()   # incoming rows an override settled
        self.consumed_ids = set()     # our rows an override settled
        self.accepted = {}            # id -> hold_key an accept_holds override allows
        self.accepted_used = set()
        self.pins = []
        self.forced_mints = []        # [(incoming, id)] from `new` overrides
        self.unknown = []             # incoming rows no uuid matched
        self.minted_ids = set()

        report.snapshot_count = len(self.rows)
        report.returned = len(fetch["problems"])
        report.header_total = fetch.get("total_count")
        report.previous_total = snapshot.get("upstream_total")

    # ── small helpers ──

    def warn(self, text):
        self.report.warnings.append(text)

    def refuse(self, text):
        self.report.refusals.append(text)

    def case(self, kind, incoming, ids, detail, override, alternative=None):
        assert kind in KINDS
        self.report.cases.append(Case(kind, incoming["uuid"], incoming.get("name") or "", list(ids), detail,
                                      override, alternative))

    def entry(self, action, note, **keys):
        e = {"action": action, "layout_id": self.layout, "angle": self.angle}
        e.update(keys)
        e["note"] = note
        return e

    def _dedupe(self, problems):
        seen, kept = {}, []
        for p in problems:
            if p["uuid"] in seen:
                self.warn(f"fetch lists uuid {p['uuid']} twice ({seen[p['uuid']].get('name')!r}); kept the first")
                continue
            seen[p["uuid"]] = p
            kept.append(p)
        return kept

    def _absent_twins(self, incoming):
        """Our rows with the same geometry as an incoming row (any, returned or not)."""
        key = lib.hold_key(incoming["holds"])
        return [r for r in self.rows if self.key_of[r["id"]] == key]

    # ── stage 1: overrides (R14, R15) ──

    def apply_overrides(self):
        handlers = {"match": self._override_match, "new": self._override_new,
                    "accept_holds": self._override_accept_holds, "pin": self._override_pin}
        entries = self.overrides.for_slab(self.layout, self.angle)
        # Acceptances and pins are recorded first so a `match` whose holds also changed sees
        # its `accept_holds` whatever order the file lists them in.
        for e in sorted(entries, key=lambda e: e["action"] in ("match", "new")):
            label = f"override {e['action']} {json.dumps({k: v for k, v in e.items() if k not in ('action', 'layout_id', 'angle', 'note')})}"
            handlers[e["action"]](e, label)

    def _override_match(self, e, label):
        uuid, pid = e["uuid"], e["id"]
        inc, row = self.inc_by_uuid.get(uuid), self.by_id.get(pid)
        if inc is None or row is None:
            self.warn(f"{label} matched nothing this run")
            return
        if uuid in self.consumed_uuids or pid in self.consumed_ids:
            self.case("override conflict", inc, [pid], f"{label}: another override already claimed this uuid or id", None)
            self.consumed_uuids.add(uuid)
            return
        # A match that contradicts the uuid index is a conflict, not a verdict: the uuid is
        # already another row's upstream key, or the named row is still returned under its own.
        holder = self.by_uuid.get(uuid)
        if holder is not None and holder is not row:
            self.case("override conflict", inc, [pid, holder["id"]],
                      f"{label}: uuid {uuid} is already the boardsesh_uuid of {holder['id']} ({holder['name']!r})", None)
            self.consumed_uuids.add(uuid)
            return
        old_uuid = row["boardsesh_uuid"]
        if old_uuid != uuid and old_uuid in self.inc_by_uuid:
            self.case("override conflict", inc, [pid],
                      f"{label}: {pid} ({row['name']!r}) is still returned by this fetch under its own uuid {old_uuid}", None)
            self.consumed_uuids.add(uuid)
            return
        self.consumed_uuids.add(uuid)
        self.consumed_ids.add(pid)
        if old_uuid != uuid:
            self._repoint(row, inc, "override")
        self._update_returned(row, inc)

    def _override_new(self, e, label):
        inc = self.inc_by_uuid.get(e["uuid"])
        if inc is None:
            self.warn(f"{label} matched nothing this run")
            return
        if e["uuid"] in self.consumed_uuids:
            self.case("override conflict", inc, [e["id"]], f"{label}: another override already claimed this uuid", None)
            return
        self.consumed_uuids.add(e["uuid"])
        # The human said it is new: minted as given, curation and all (the invariants still
        # refuse an id that exists, is retired or is unsafe).
        self.forced_mints.append((inc, e["id"]))

    def _override_accept_holds(self, e, label):
        if e["id"] not in self.by_id:
            self.warn(f"{label} matched nothing this run")
            return
        self.accepted[e["id"]] = e["hold_key"]

    def _override_pin(self, e, label):
        if e["id"] not in self.by_id:
            self.warn(f"{label} matched nothing this run")
            return
        self.pins.append(e)

    # ── stage 2: guards (R16) ──

    def guard_fetch_size(self):
        n = len(self.fetch["problems"])   # rows boardsesh returned, duplicates included
        if n == 0:
            self.refuse(f"empty fetch: boardsesh returned no rows for layout {self.layout} @ {self.angle}°")
            return
        checks = (("fetch header total", self.report.header_total),
                  ("previous fetch total in the snapshot header", self.report.previous_total))
        for label, total in checks:
            if total is None:
                if label.startswith("previous"):
                    self.warn("no previous fetch total in the snapshot header (first merge after the seed); "
                              "the short-fetch guard only compared against the fetch header")
                continue
            if n < SHORT_FETCH_RATIO * int(total):
                text = (f"short fetch: {n} row(s) returned, below {int(SHORT_FETCH_RATIO * 100)}% of the {label} "
                        f"{total} (a set-id re-partition upstream looks like this)")
                if self.accept_short:
                    self.warn(f"accepted {text}")
                else:
                    self.refuse(text + "; pass --accept-short if the drop is real")

    # ── stage 3: match by boardsesh_uuid (R4) ──

    def match_by_uuid(self):
        for inc in self.incoming:
            if inc["uuid"] in self.consumed_uuids:
                continue
            row = self.by_uuid.get(inc["uuid"])
            if row is None or row["id"] in self.consumed_ids:
                self.unknown.append(inc)
                continue
            self._update_returned(row, inc)
        for pid, key in self.accepted.items():
            if pid not in self.accepted_used and self.key_of[pid] != key:
                self.warn(f"override accept_holds {json.dumps({'id': pid, 'hold_key': key})} matched nothing this run")

    def _update_returned(self, row, inc):
        """The fetch returned our row: refresh the upstream-owned fields and upstream_last_seen.
        Holds are ours (R9); a changed geometry needs an explicit acceptance."""
        self.returned_ids.add(row["id"])
        new_key = lib.hold_key(inc["holds"])
        if new_key != self.key_of[row["id"]]:
            if self.accepted.get(row["id"]) == new_key:
                row["holds"], row["hold_key"] = copy.deepcopy(inc["holds"]), new_key
                self.key_of[row["id"]] = new_key
                self.accepted_used.add(row["id"])
            else:
                self.case("holds differ", inc, [row["id"]],
                          f"uuid matches our {row['id']} ({row['name']!r}) but the holds differ "
                          f"({len(row['holds'])} ours vs {len(inc['holds'])} upstream); we own holds",
                          self.entry("accept_holds", f"accept the {self.date} geometry change on {row['name']!r}",
                                     id=row["id"], hold_key=new_key))
                return
        fields = upstream_fields(inc)
        if any(row[f] != fields[f] for f in lib.UPSTREAM_FIELDS):
            self.report.changed += 1
        row.update(fields)
        row["upstream_last_seen"] = self.date
        self.report.updated += 1

    def _repoint(self, row, inc, kind):
        """A rename: keep our id, follow the upstream key (R5)."""
        old_uuid = row["boardsesh_uuid"]
        self.report.renamed.append(Rename(row["id"], row["name"], inc.get("name") or "", kind, old_uuid, inc["uuid"]))
        if self.by_uuid.get(old_uuid) is row:
            del self.by_uuid[old_uuid]
        row["boardsesh_uuid"] = inc["uuid"]
        self.by_uuid[inc["uuid"]] = row

    # ── stage 4: geometry claims, strongest evidence first (R5, R6, R12) ──

    def settle_geometry(self):
        # Only rows the fetch did NOT return can be the old copy of a rename; a row still
        # returned under its own uuid that shares holds is a distinct problem (R6).
        absent_by_key = {}
        for r in self.rows:
            if r["id"] not in self.returned_ids and r["id"] not in self.consumed_ids:
                absent_by_key.setdefault(self.key_of[r["id"]], []).append(r)
        claims_by_key, leftover = {}, []
        for inc in self.unknown:
            key = lib.hold_key(inc["holds"])
            if key in absent_by_key:
                claims_by_key.setdefault(key, []).append(inc)
            else:
                leftover.append(inc)

        for key, claimants in claims_by_key.items():
            candidates = list(absent_by_key[key])
            original = list(candidates)
            settled = []
            # Settle strongest evidence first so a rename beats a new copy of the same holds.
            # A claim settles only when it is the ONE claimant with that evidence for the ONE
            # candidate, so the outcome never depends on fetch order.
            for kind in EVIDENCE:
                for p in list(claimants):
                    matches = [r for r in candidates if evidence(p, r) == kind]
                    if len(matches) != 1:
                        continue
                    r = matches[0]
                    if any(q is not p and evidence(q, r) == kind for q in claimants):
                        continue
                    candidates.remove(r)
                    claimants.remove(p)
                    settled.append((r, p, kind))
            # Classify the losers against the rows as they were, before the renames update them.
            for p in claimants:
                evidenced = [r for r in original if evidence(p, r)]
                if evidenced:
                    self._contention(p, evidenced)
                elif candidates:
                    self._no_evidence(p, candidates)
                else:
                    leftover.append(p)   # every absent twin was claimed with evidence: a distinct copy (R6)
            for r, p, kind in settled:
                self._repoint(r, p, kind)
                self._update_returned(r, p)
        self.unknown = leftover

    def _no_evidence(self, inc, candidates):
        first = candidates[0]
        twins = "; ".join(f"{r['name']!r} by {r['setter']!r} ({r['id']})" for r in candidates)
        self.case("no evidence", inc, [r["id"] for r in candidates],
                  f"by {inc.get('setter')!r}, same holds as {twins} which this fetch did not return, "
                  f"but neither name nor setter match",
                  self.entry("match", f"{inc.get('name')!r} is {first['name']!r} renamed and re-attributed",
                             uuid=inc["uuid"], id=first["id"]),
                  self.entry("new", f"{inc.get('name')!r} is a new problem on the holds of {first['name']!r}",
                             uuid=inc["uuid"], id=inc["uuid"]))

    def _contention(self, inc, evidenced):
        first = evidenced[0]
        twins = "; ".join(f"{r['name']!r} ({r['id']}, {evidence(inc, r)} matches)" for r in evidenced)
        self.case("contention", inc, [r["id"] for r in evidenced],
                  f"by {inc.get('setter')!r}, same holds and evidence for {twins}, but another incoming row "
                  f"or a second candidate has the same claim; order must not decide",
                  self.entry("match", f"{inc.get('name')!r} is {first['name']!r}", uuid=inc["uuid"], id=first["id"]),
                  self.entry("new", f"{inc.get('name')!r} is a new problem on the holds of {first['name']!r}",
                             uuid=inc["uuid"], id=inc["uuid"]))

    # ── stage 5: curation (R8) ──

    def curate(self):
        kept = []
        for inc in self.unknown:
            if lib.admitted(inc):
                kept.append(inc)
            else:
                self.report.dropped += 1
        self.unknown = kept

    # ── stage 6: mint (R2, R7, R26, KTD6, KTD8) ──

    def mint_new_rows(self):
        for inc in self.unknown:
            uuid = inc["uuid"]
            fresh = lib.derived_id(uuid, self.angle)
            if uuid in self.overrides.retired_ids:
                # The tombstone's twin is live in prod and in the snapshot; minting the retired
                # id would make the import un-delete the tombstone (KTD6).
                twins = self._absent_twins(inc)
                self.case("retired id", inc, [uuid],
                          "its uuid is a retired id (tombstoned in prod); minting it would un-delete the tombstone",
                          self.entry("new", f"{inc.get('name')!r} re-keyed to the retired id; minted fresh",
                                     uuid=uuid, id=fresh),
                          self.entry("match", f"{inc.get('name')!r} is {twins[0]['name']!r} re-keyed",
                                     uuid=uuid, id=twins[0]["id"]) if twins else None)
                continue
            ref = self.all_ids.get(uuid)
            if ref is None:
                self._mint(inc, uuid, derived=False)
            elif (ref.layout, ref.angle) != self.slab and ref.hold_key == lib.hold_key(inc["holds"]):
                self._mint(inc, fresh, derived=True)
            else:
                where = "this slab" if (ref.layout, ref.angle) == self.slab else f"layout {ref.layout} @ {ref.angle}°"
                self.case("uuid collision", inc, [uuid],
                          f"its uuid is already our id in {where} with different holds, and nothing in this "
                          f"slab matches its geometry",
                          self.entry("new", f"{inc.get('name')!r} is a new problem at {self.angle}°, not the {where} row",
                                     uuid=uuid, id=fresh))
        for inc, pid in self.forced_mints:
            self._mint(inc, pid, derived=False)

    def _mint(self, inc, pid, derived):
        row = {"id": pid, "boardsesh_uuid": inc["uuid"]}
        row.update(upstream_fields(inc))
        row["holds"] = copy.deepcopy(inc["holds"])
        row["hold_key"] = lib.hold_key(inc["holds"])
        row["upstream_last_seen"] = self.date
        row = {k: row[k] for k in lib.PROBLEM_KEYS}
        self.rows.append(row)
        self.by_id.setdefault(pid, row)
        self.by_uuid.setdefault(inc["uuid"], row)
        self.key_of[pid] = row["hold_key"]
        self.minted_ids.add(pid)
        self.report.minted.append(Mint(pid, inc["uuid"], row["name"], derived))

    # ── stage 7: pins (R14) ──

    def apply_pins(self):
        for e in self.pins:
            self.by_id[e["id"]][e["field"]] = e["value"]

    # ── stage 8: invariants (R17) ──

    def check_invariants(self):
        seen_ids, seen_uuids = set(), {}
        for r in self.rows:
            pid, uuid = r["id"], r["boardsesh_uuid"]
            if not isinstance(pid, str) or not lib.ID_RE.match(pid):
                self.refuse(f"invariant: id {pid!r} ({r['name']!r}) is not a plain id")
            if pid in seen_ids:
                self.refuse(f"invariant: id {pid} appears twice in this slab")
            seen_ids.add(pid)
            ref = self.all_ids.get(pid)
            if ref is not None and (ref.layout, ref.angle) != self.slab:
                self.refuse(f"invariant: id {pid} ({r['name']!r}) already exists in layout {ref.layout} @ {ref.angle}°")
            if pid in self.overrides.retired_ids:
                self.refuse(f"invariant: id {pid} ({r['name']!r}) is a retired id")
            if uuid in seen_uuids:
                self.refuse(f"invariant: boardsesh_uuid {uuid} is held by ids {seen_uuids[uuid]} and {pid}")
            seen_uuids.setdefault(uuid, pid)
            if r["hold_key"] != lib.hold_key(r["holds"]):
                self.refuse(f"invariant: stored hold_key of {pid} ({r['name']!r}) does not equal the recomputed one")

    # ── finish ──

    def record_transitions(self):
        # boardsesh's flag flaps; a true->false drop silently removes benchmark status in the
        # app, so the reviewer sees both directions and can pin the flag (R14).
        for r in self.rows:
            old = self.old_flags.get(r["id"])
            if old is not None and old != bool(r["isBenchmark"]):
                self.report.transitions.append((r["id"], r["name"], old, bool(r["isBenchmark"])))

    def result(self):
        self.report.renamed.sort(key=lambda x: x.id)
        self.report.minted.sort(key=lambda x: x.id)
        self.report.transitions.sort()
        self.report.cases.sort(key=lambda c: (KINDS.index(c.kind), c.uuid))
        if self.report.refusals or self.report.cases:
            raise Quarantine(self.report)
        problems = sorted(self.rows, key=lambda r: r["id"])
        return {"setup": self.setup, "layoutId": self.layout, "angle": self.angle, "source": lib.SOURCE,
                "curation": lib.CURATION, "upstream_total": self.fetch.get("total_count"),
                "count": len(problems), "problems": problems}

    def run(self):
        self.apply_overrides()
        self.guard_fetch_size()
        self.match_by_uuid()
        self.settle_geometry()
        self.curate()
        self.mint_new_rows()
        self.apply_pins()
        self.check_invariants()
        self.record_transitions()
        return self.result()


def merge(snapshot, overrides, fetch, all_ids, accept_short=False, new_slab=False):
    """Pure core: (new_snapshot, report), or raise Quarantine(report). No I/O, deterministic,
    inputs untouched.

    snapshot   the slab's canonical snapshot dict, or None when the file does not exist
    overrides  a `lib.Overrides` (every slab's entries plus retired_ids)
    fetch      the scratch fetch file dict (header + problems keyed by `uuid`)
    all_ids    `index_ids(...)` over every snapshot, this slab included
    accept_short  let a fetch below 80% of the known totals through (never an empty one)
    new_slab   bootstrap: a missing snapshot becomes an empty one and every admitted row is minted
    """
    layout, angle, date = _validate_fetch(fetch)
    report = Report(layout=layout, angle=angle, fetched_at=fetch["fetched_at"], returned=len(fetch["problems"]),
                    header_total=fetch.get("total_count"))
    if snapshot is None:
        if not new_slab:
            report.refusals.append(f"no snapshot for layout {layout} @ {angle}°; pass --new-slab to bootstrap it "
                                   f"from this fetch")
            raise Quarantine(report)
        snapshot = _empty_snapshot(layout, angle)
    _validate_snapshot(snapshot, layout, angle)
    run = _Merge(snapshot, overrides, fetch, all_ids, accept_short, date, report)
    return run.run(), report


# ── report text ───────────────────────────────────────────────────────────────────────

def format_report(report, slab_label):
    r = report
    derived = sum(1 for m in r.minted if m.derived)
    total = "unknown" if r.header_total is None else r.header_total
    lines = [f"{slab_label}: layout {r.layout} @ {r.angle}° — fetch {r.fetched_at}: {r.snapshot_count} in snapshot, "
             f"{r.returned} returned (header total {total}), {r.updated} updated ({r.changed} changed), "
             f"{len(r.renamed)} renamed, {len(r.minted)} minted ({derived} derived), {r.dropped} dropped by curation, "
             f"{len(r.transitions)} benchmark flag changes, {len(r.cases)} quarantined"]
    for x in r.renamed:
        lines.append(f"    [{x.evidence}] {x.old_name!r} -> {x.new_name!r}  (kept {x.id}; boardsesh_uuid {x.old_uuid} -> {x.new_uuid})")
    for m in r.minted:
        how = f"derived from {m.uuid} @ {r.angle}°" if m.derived else f"uuid {m.uuid}"
        lines.append(f"    MINTED {m.name!r} as {m.id}  ({how})")
    for pid, name, old, new in r.transitions:
        lines.append(f"    BENCHMARK {json.dumps(old)} -> {json.dumps(new)}  {name!r} ({pid}); pin isBenchmark to hold it")
    for w in r.warnings:
        lines.append(f"    WARNING {w}")
    for c in r.cases:
        lines.append(f"    QUARANTINE [{c.kind}] {c.name!r} ({c.uuid}): {c.detail}")
        if c.override is None:
            lines.append("        fix: edit or remove the offending entry in catalog-data/overrides.json")
        else:
            lines.append(f"        {json.dumps(c.override, ensure_ascii=False)}")
        if c.alternative is not None:
            lines.append("        alternative:")
            lines.append(f"        {json.dumps(c.alternative, ensure_ascii=False)}")
    for text in r.refusals:
        lines.append(f"    REFUSED {text}")
    if r.cases:
        lines.append(f"    REFUSED {len(r.cases)} quarantined case(s): record each verdict in catalog-data/overrides.json, "
                     f"commit it, and run again")
    return "\n".join(lines)


# ── shell ─────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Merge a boardsesh fetch into the canonical catalog snapshot.")
    ap.add_argument("--layout", type=int, required=True, choices=sorted(lib.BOARDS), help="layout id 1-7")
    ap.add_argument("--angle", type=int, choices=(25, 40), help="one angle; default every angle with a snapshot")
    ap.add_argument("--dir", default=lib.DATA_DIR, help="catalog-data directory")
    ap.add_argument("--fetch", help="fetch file to merge (default catalog-data/.upstream/<slug>_<angle>.json; needs --angle)")
    ap.add_argument("--dry-run", action="store_true", help="print the report, write nothing")
    ap.add_argument("--accept-short", action="store_true", help="accept a fetch below 80%% of the known totals")
    ap.add_argument("--new-slab", action="store_true", help="bootstrap a slab that has no snapshot yet")
    args = ap.parse_args()

    data_dir = os.path.abspath(args.dir)
    snapshots = {(s["layoutId"], s["angle"]): s for _, s in lib.snapshot_files(data_dir)}
    all_ids = index_ids(snapshots.values())
    if args.angle is not None:
        angles = [args.angle]
    else:
        angles = sorted(angle for (layout, angle) in snapshots if layout == args.layout)
        if not angles:
            ap.error(f"no snapshot for layout {args.layout} in {data_dir}; pass --angle (and --new-slab to bootstrap)")
    if args.fetch and len(angles) != 1:
        ap.error("--fetch needs --angle")
    overrides = lib.load_overrides(lib.overrides_path(data_dir))

    refused = False
    for angle in angles:
        path = lib.snapshot_path(data_dir, args.layout, angle)
        fetch_file = args.fetch or lib.fetch_path(data_dir, args.layout, angle)
        if not os.path.exists(fetch_file):
            sys.exit(f"no fetch file {fetch_file}; run fetch_boardsesh.py --layout {args.layout} --angle {angle} first")
        with open(fetch_file, encoding="utf-8") as f:
            fetch = json.load(f)
        if (fetch.get("layoutId"), fetch.get("angle")) != (args.layout, angle):
            sys.exit(f"{fetch_file} is a fetch of layout {fetch.get('layoutId')} @ {fetch.get('angle')}°, "
                     f"not {args.layout} @ {angle}°")
        label = os.path.basename(path)
        try:
            new_snapshot, report = merge(snapshots.get((args.layout, angle)), overrides, fetch, all_ids,
                                         accept_short=args.accept_short, new_slab=args.new_slab)
        except Quarantine as q:
            print(format_report(q.report, label))
            print(f"    not written: {path}")
            refused = True
            continue
        print(format_report(report, label))
        for p in new_snapshot["problems"]:   # the next angle must see this run's mints
            all_ids.setdefault(p["id"], IdRef(args.layout, angle, p["hold_key"]))
        if args.dry_run:
            print(f"    dry run: {path} not written")
        else:
            lib.write_snapshot(path, new_snapshot)
            print(f"    wrote {path}")
    if refused:
        sys.exit(2)


if __name__ == "__main__":
    main()
