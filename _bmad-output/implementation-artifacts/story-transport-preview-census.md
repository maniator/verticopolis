---
story: transport-preview-census
status: review
issue: 1239
---

# Story: the shaft preview counts from a census, not a walk per move (#1239)

Follow-up to facade slice 6d (#1216, PR #1244). The review of that PR gated
slice 7 (#1217): no per-move caller of `placeTransportDryRun` or
`validateTransport` until this is fixed on `main` or the owner accepts the
deferral.

## Why

`Tower::validate_transport` runs `cap_reason` first. `cap_reason` calls
`count_kind` for the kind, and for every kind of its pool, and `count_kind`
walks every unit. An elevator move walks the unit list three times, a stairs
or escalator move twice, and a Classic escalator adds two more walks for the
office rule. On the owner's save (U 19,806, R 1,699, T 64) that is about
58 us per move natively (cloud estimate), and the same shape in
`canBuild` for capped room kinds. It runs on every pointer move of a drag.

## Acceptance criteria

1. **AC1** `count_kind` answers from a per-kind count built once per tower
   revision over the room index, for every non-structural kind. Structural
   kinds (lobby, floor) still walk the tiles; no production caller asks.
   Transports are counted live.
2. **AC2** The Classic escalator office rule reads a set of office floors
   from the same build, not two walks.
3. **AC3** `housekeeping_units` reads the same census; the `crews` memo goes.
4. **AC4** Every answer equals the old walk after place, remove, shaft
   add and remove, a same-count swap, a save round trip, a wholesale
   reassignment followed by `reindex`, and any unit state. A transport kind
   held by a unit (a forged save) keeps its count.
5. **AC5** No hash moves. The conformance lock, the digests and the binding
   declaration are unchanged; no crate bump (nothing in the interface moves).

## Out of scope

- The TypeScript twins (`countKind`, the escalator office walk in
  `transport.ts`): #1239 stays open for them, with #1158 A24.
- The shaft overlap loop (floors x transports): #1261.

## Tasks

- [x] `Census` and `Tower::census`, `has_office_on` in `tower_index.rs`;
      `Memo.census` replaces `Memo.crews`.
- [x] `count_kind` and the escalator rule read it (`tower.rs`).
- [x] Tests in `tower_census_tests.rs`; the staff-ceiling tests untouched.
- [x] Hot-path inventory row (`docs/performance/hot-path-review.md`).
- [x] `/gds-code-review` and the HP-1..HP-12 record.
- [ ] The independent review.

## Dev Agent Record

Cloud estimates, native release, owner's save split-tower-4 (U 19,806,
R 1,699, T 64): the three walks of an elevator move 47.7 us before, the cap
check on a memo hit 0.09 us after; the first check after an edit rebuilds the
room index and the census in about 39 us, once per command. Paired desktop
numbers are the owner's to run.

### Hot-path record (HP-1..HP-12)

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | clear | `count_kind` from `cap_reason` from `validate_transport` (facade validate and dry run, `place_transport`, `build_transport`) and `can_build` for capped rooms; `has_office_on` only from the Classic escalator rule; `housekeeping_units` from `max_staff_for` in the hourly housekeeper dispatch. No per-step or per-chunk caller of the new reads | none |
| HP-2 | finding | memo hit is O(1) plus a live transport walk of at most 264 visits; a rebuild costs U + R once per revision (about 46,300 visits, 39 us); before: 130,074 visits per elevator move, 173,432 for a Classic escalator. The overlap loop stays (floors x transports, up to 9,680) | #1261 |
| HP-3 | clear | the hit path allocates nothing; a rebuild allocates a 37-slot vector, a set and an `Arc` per command | none |
| HP-4 | clear | no sort | none |
| HP-5 | clear | the office-floor set is only inserted into and looked up | none |
| HP-6 | clear | no id scans added | none |
| HP-7 | finding | inherited overlap loop reviewed as new | #1261 |
| HP-8 | clear | `Memo.crews` replaced by `Memo.census`, same query and cost class; inventory row added; TypeScript has no cache (A24, #1239) | none |
| HP-9 | clear | remedy: an index per revision | none |
| HP-10 | clear | key (revision, unit count) covers kind and floor since no production path retypes a unit; load ends in `reindex`; unit state is not an input; the referee passes | none |
| HP-11 | n/a | no change to the binding | none |
| HP-12 | finding | Rust preview cost drops; the TypeScript twin (the default engine) still walks | #1239 (TypeScript), #1261 |
