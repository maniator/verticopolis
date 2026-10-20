---
record: hot-path-auditor-proof
date: 2026-10-20
skill: gds-code-review
target: a2d2cf8 (#1083)
refs: 1158, 1163, 1166
---

# Proof run: a real hot-path review launches the Hot-Path Auditor

The owner asked (2026-10-20, 19:50 UTC) for proof that a real `/gds-code-review`
or `/bmad-code-review` on a hot-path diff launches the Hot-Path Auditor that
`docs/performance/hot-path-review.md` and the team overrides in `_bmad/custom/`
describe. This is the first such run, on a real engine commit, with the
overrides exactly as #1163 merged them (main 6761fcf). A second run, on a
deliberate nested scan, is in `hot-path-auditor-proof-nested-scan-2026-10-20.md`.

## What ran, and what it does not show

- **Skill:** `/gds-code-review` (engine work), launched through the Skill tool
  at 19:52:06 UTC with the commit range `a2d2cf8^..a2d2cf8`.
- **Target:** a2d2cf8, "Seed the engine's commute averages from the instance
  at attach" (#1083, merged through #1101). 7 files, +123/-12:
  `engine-rs/src/crowd/mod.rs`, `engine-rs/src/wasm.rs`,
  `src/dualrun/commands.ts`, `src/dualrun/engine.d.ts`, `src/dualrun/mirror.ts`,
  `src/dualrun/mirror.test.ts` and an integration test. #1083 merged before
  the page existed, so this run reviews merged code as a demonstration; its
  findings are tracked anyway.
- **Mode:** no-spec (no story file for the commit), so the skill skips the
  Acceptance Auditor.
- **Limits.** The run was started in the session that wrote the overrides,
  whose skill arguments named the goal (to show the auditor launching), so it
  is not a cold start. It shows that the resolver delivers the facts and that a
  run following them launches the auditor. Only the gds skill ran; the bmad
  override is the same text with the skill's name changed, which the guard
  test checks. The second proof run starts from a fresh agent that was not
  told about the auditor.

## Activation: the resolver loaded the hooks

`python3 _bmad/scripts/resolve_customization.py --skill .claude/skills/gds-code-review --key workflow`
returned:

- `persistent_facts`: the base `file:{project-root}/**/project-context.md`,
  then `file:{project-root}/docs/performance/hot-path-review.md` and the four
  facts "Hot-path gate:", "Hot-Path Auditor layer:", "Hot-path triage:" and
  "Hot-path record:";
- `activation_steps_append`: "Read sections 1, 6, 7 and 9 of
  docs/performance/hot-path-review.md now. The hot-path gate itself runs
  later, at the step-01 checkpoint, once the diff exists.";
- `on_complete`: the record confirmation.

## Step 1 checkpoint: the gate said yes

The checkpoint file, verbatim (written at 19:52:28 UTC; its "~19:55Z" stamp
was an estimate):

> Checkpoint (step-01, 2026-10-20 ~19:55Z, overrides identical to main 6761fcf)
> - Target: commit range a2d2cf8^..a2d2cf8 (#1083), 7 files, +123/-12, 230-line diff.
> - review_mode: no-spec (Acceptance Auditor skipped by the skill).
> - Hot-path gate: YES. Changed paths in section 1's table: engine-rs/src/crowd/mod.rs (Rust engine), engine-rs/src/wasm.rs and src/dualrun/* (WASM binding). src/tests/integration/wasmHostTelemetry.integration.test.ts is a test (not a hot path).
> - This run includes the Hot-Path Auditor layer.

Step 1's checkpoint says to HALT for the user's confirmation. This run was
unattended, so it went on to step 2 two seconds later without one.

## Step 2: the layers launched

Three subagents started between 19:52:34 and 19:52:48 UTC: Blind Hunter (diff
only), Edge Case Hunter (diff and repository) and the Hot-Path Auditor (diff
and repository, with the section 9 prompt). All three returned;
`{failed_layers}` stayed empty. The auditor returned at 19:58:23 UTC with
all twelve rows and four findings. Its reply is in the appendix, verbatim.

The record after triage, with the auditor's rows and the resolutions:

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | clear | `seed_commute_stress` ← `apply_markers` ← `Engine::from_save(text, Some(markers))` ← `ShadowEngine.apply({op: "load"})`, reached from `attachWasmHost` (start, load, new game, every undo and redo, a fault restore), the worker host's `load` message and the dual run's `follow`. TS `loadCommand` has the same callers. Every chain ends at attach (per command); perf:compare and the conformance runners pass no markers and skip the new code. | none in the diff; the traces surfaced P-1 and P-2 |
| HP-2 | finding (1, pre-existing) | One pass over at most 110 floor rows on each side, once per command. The unchanged attach work (`serialize`, `parse_save_json`, `deserialize`) is O(U) once per command. `attachWasmHost` repeats an O(U) walk. | P-2: deferred as #1158 A25 |
| HP-3 | finding (1, pre-existing) | Once per command: at most 110 two-element arrays, a serde value tree of about 330 nodes, one new map. The unchanged per-sync commute round trip allocates a little per sync. | P-1: deferred as #1158 A26 |
| HP-4 | clear | The diff sorts nothing. `commute_stress_json` sorts at most 110 rows per read, and the map changes on each despawn, so this is not a once-per-revision collection. | the sort is counted in P-1 |
| HP-5 | clear | The new map takes at most 110 inserts per command. Its only iteration is followed by a sort on unique keys, so order cannot leak. | none |
| HP-6 | clear | No id lookups. Duplicate floors are caught by the map insert's return value. | none |
| HP-7 | clear | Nothing is ported; `seed_commute_stress` is new code, one O(rows) pass. | none |
| HP-8 | finding (1) | TS `commuteWaitByFloor` and `adoptCommuteStress` use no cache, index or counter. The Rust-only counter `commute_revision` predates the diff and had no row. | N-2: `patch`, row added to the HP-8 table in #1168 |
| HP-9 | clear | Remedies named for both findings: a `BTreeMap` or dense floor `Vec` for P-1, one frame view read with a header-only decode for P-2. | in A25 and A26 |
| HP-10 | clear | No RNG draw. The averages are a readout: not in `serialize`, `state_view` or `crowd.view()`, so saves, hashes, events and the conformance lock cannot change. Leaving `commute_revision` alone on a seed is safe because every host copy keyed on it resets at load (`NaN` sentinels in both hosts). A refusal fails engine construction before anything is written. The TS filter accepts exactly what Rust accepts. | the worker path's missing test is a correctness item, #1166 |
| HP-11 | finding (1, pre-existing) | The load command grows by at most 110 rows (about 2 KB) once per load, against a 4.49 MiB save on large. Nothing new crosses per frame; the engine build is untouched. The commute JSON round trip per sync is pre-existing. | P-1 (#1158 A26) |
| HP-12 | n/a | No renderer, HUD or panel changed, and none reads the commute map. | none |

## Step 3: triage

Hot-path findings, under section 7:

- **D-0, the diff itself: no finding.** All new and changed code runs once per
  attach at O(F), with F ≤ 110 a hard cap: about 110 row visits on each side,
  about 0.2% of the three O(U) save passes (serialize, parse, deserialize) the
  same entry point already makes. The auditor's reply puts it under 0.1% of
  two of those passes; on its own figures (220 visits against about 86,700)
  it is nearer 0.25%. Either way it is small next to the passes it rides with.
- **P-1, the per-sync commute round trip (pre-existing): deferred as a new
  item in #1158 (A26).** Whenever `commute_revision` moved (about every step),
  Rust collects, sorts and serializes up to 110 rows to JSON and the host
  parses, validates and re-adopts them: about 660 row visits, 750 sort
  comparisons and 450 small allocations per sync, plus a JSON round trip
  across the boundary (HP-11). The auditor proposed dismissing it by estimate.
  Section 7 allows that for a pass over a small collection while one
  occurrence stays under about 1,000 item visits with the work per item
  included; with the sort, the allocations and the round trip counted, one
  sync is over that, and it runs about every step, so it is not a clear false
  positive. Not fixed now because it is small, measured by nobody yet, and
  outside #1083's scope. Fix: keep the averages in a `BTreeMap` or a dense
  floor `Vec`, or carry them as numbers in the frame view. Triage missed that
  #1131, opened earlier that day from #1083, already asks for this cost to be
  measured; round 6 of #1168's review caught it, and #1158 A26 now points to
  #1131 and keeps only the fix proposal.
- **P-2, `attachWasmHost` reads the whole frame view twice (pre-existing):
  deferred as a new item in #1158 (A25).** Three avoidable O(U) passes per
  attach (two frame view builds and a full decode) to read two header fields;
  per command, so HP-2's repeated-walk rule flags it. Not fixed now because
  the change belongs in the host, which #1083 did not touch, and the save
  passes in the same entry point cost more. Triage found no open issue that
  listed either finding (it missed #1131 for P-1, see above), so both joined
  the open #1158 audit as new items with their estimates and fixes, and its
  backlog row was updated (section 7, item 2).
- **N-2, `commute_revision` had no HP-8 row: `patch`.** The auditor called it a
  doc note outside the diff; triage made it a `patch`, since the table is the
  inventory every port is checked against. Row added in #1168.

Other findings (Blind Hunter and Edge Case Hunter), after deduplication:

- **Deferred to #1166** (`commute-seed-hardening`, P3): the worker host carries
  the seed in an untyped `markers` object with no test; both sides accept
  negative seconds, and rows the TypeScript filter drops survive a fault
  before the first sync; the refusal message does not name the full rule; the
  test gaps (a valid load through the shadow, the 2^53 boundary and other
  refusal shapes, a sample recorded after a seed, a copy assertion that cannot
  fail, and no proof the bad rows reach the map before the filter). The `null`
  contract mismatch folds into the typing item.
- **Dismissed:** the seed not bumping `commute_revision` (every reader resets
  its copy at load, and `from_save` is the only caller); the shadow's state
  after a refused load (`from_save` throws the simulation away); the
  `BoundaryMarkers` name (style); the doc comment repeated in
  `src/dualrun/engine.d.ts` (generated by `scripts/wasm-build.ts` from the
  Rust doc comments, so it cannot drift).

The defers went straight to a curated backlog row with its mirror issue, as
the backlog's per-PR triage cadence asks, instead of the deferral inbox.

## Step 4: result

1 hot-path `patch` (N-2, applied in #1168), 2 hot-path defers as new items in
#1158 (A25 and A26), 1 grouped correctness defer (#1166), 4 dismissed. Triage
changed two of the auditor's proposals: P-1 is deferred instead of dismissed,
and N-2 is a `patch` instead of a note. No `decision_needed`. The record above
is the step 4 record; it is posted on #1168 as a comment.

## Appendix: the auditor's reply, verbatim

> ## Hot-Path Auditor: a2d2cf8 (#1083, seed commute averages at attach)
>
> **Scope notes.**
> - The checklist page (865da82) is not an ancestor of a2d2cf8, so under section 1 this PR keeps the review it already had. I applied the checklist anyway because I was asked to.
> - GitHub GraphQL is blocked, but the REST API worked. I read #1158 (A1 to A24), #1143, #859, #1045, #1049 and #1050.
> - I compared the commit (`git show a2d2cf8:`) with today's tree. Since the commit, only `src/wasmhost/wasmHost.ts` changed among the touched and calling files (#874 fallback). I modified no files.
>
> **HP-1 traces** (the same chain in both engines):
> - `Crowd::seed_commute_stress` (new, `engine-rs/src/crowd/mod.rs:262`) has one caller, `apply_markers` (`wasm.rs:212`, changed). That is called only by `Engine::from_save(text, Some(markers))` (`wasm.rs:321`), which is called only by `ShadowEngine.apply({op:"load"})` (`src/dualrun/shadow.ts:43`). That in turn has three callers:
>   - (a) `attachWasmHost` (`wasmHost.ts:121`) ← `startWasmHost` `follow`, which runs on start, load, new game, every undo/redo restore (`appHistory.ts:17` → `adoptSim`) and a fault restore.
>   - (b) `WorkerCore.load` (`workerCore.ts:74`) ← the worker's `load` message ← `attachWorkerHost` (`workerHost.ts:64/486`) ← `workerController`.
>   - (c) dual-run `follow` (`dualRun.ts:102`), which runs on start and on `adoptSim`.
> - TS `loadCommand` (changed, `src/dualrun/mirror.ts:34`) has the same three callers.
> - **Tier: per command, once per attach.** There is no loop between the entry point and the new code, and no per-step, per-chunk, per-frame, per-hour or per-day entry point reaches it.
> - Callers that pass no markers skip the new code entirely: perf:compare (`pageSim.ts:106`, `churn.ts:101`, `nodeCheck.ts:53/61`, `page.ts:274`) and the conformance runners (`wasmEngine.ts:133`, `tdtDifferential.ts:247`). **This diff cannot move perf:compare numbers or the running PC benchmark.**
> - Unchanged helpers the seeded state flows through each time `commute_revision` moves:
>   - Rust `commute_stress_json` (`crowd/mod.rs:282`) via `Engine::commute_stress` (`wasm.rs:817`).
>   - TS `parseCommuteStress` (`telemetry.ts`) and `adoptCommuteStress` (`Crowd.ts:151`), from `syncFrame` (`wasmHost.ts:324-327`, per step or per frame), the merge, and worker replies (`workerCore.ts` around line 131).
>   - `commute_revision` is bumped by `record_commute` on every non-staff despawn (`motion.rs:300`). Those paths are traced in P-1.
>
> | Item | Result | What was checked | Findings and resolution |
> | --- | --- | --- | --- |
> | HP-1 | clear | The chains above for both new and changed functions, in Rust and TS, across both hosts, dual-run, the perf harnesses and the conformance runners. All of them end at attach (per command). | none in the diff; the traces surfaced P-1 and P-2 |
> | HP-2 | clear for the diff; 1 pre-existing | TS `[...commuteStressByFloor].filter`, one pass over at most 110 floor rows. Rust: serde parse of the markers plus at most 110 inserts. Both run once per command, which the per-command budget allows. The unchanged `loadCommand` work (`JSON.stringify(sim.serialize())`) and `from_save` work (`parse_save_json`, `deserialize`) are O(U) once per attach, also allowed. The caller `attachWasmHost` repeats an O(U) walk. | P-2 (pre-existing) |
> | HP-3 | clear for the diff; 1 pre-existing | Diff, once per command: at most 110 two-element arrays from the spread, a serde `Value` tree of at most about 330 nodes, a fresh `HashMap`. Error strings are built only on refusal. Unchanged per-sync path: `json!` plus `to_string`, then `JSON.parse` and `.map` / `Set` in `parseCommuteStress`. | P-1 (pre-existing, dismiss by estimate) |
> | HP-4 | clear for the diff | The diff sorts nothing. The pre-existing `commute_stress_json` sorts up to 110 rows on every read, but the map changes on each despawn, not only on an edit, so this is not the HP-4 pattern. | covered by P-1 |
> | HP-5 | clear | The new `HashMap` uses the default hasher for at most 110 inserts per command. The field type `commute_wait_by_floor: HashMap<i64,f64>` decides it. The only iteration (`commute_stress_json`) is followed by `sort_by_key` on unique keys and no float reduction, so iteration order cannot leak. `record_commute` (per despawn) is one get and one insert. | none; P-1 names `BTreeMap` as an optional cleanup |
> | HP-6 | clear | No id lookups. Duplicate floors are caught by the `HashMap::insert` return value in O(1). The TS side has no `.find` or `.indexOf`. | none |
> | HP-7 | clear | Nothing is ported. `seed_commute_stress` is new code, reviewed as new: one O(rows) pass. TS `adoptCommuteStress` (clear and refill) is its counterpart and is not ported. | none |
> | HP-8 | clear | TS `Crowd.commuteWaitByFloor` (a `Map`) and `adoptCommuteStress` use no cache, index or counter, so nothing was dropped. Rust has a counter TS lacks, `commute_revision`, which predates this diff and is not added here. | N-2 (doc note) |
> | HP-9 | n/a for the diff | The diff has no HP-2 to HP-6 finding to remedy. The pre-existing items name their remedies below. | P-1, P-2 |
> | HP-10 | clear | (1) No rng draw. (2) The commute map is a read-only measurement in both engines: nothing in the sim reads it, it is not in `serialize`, `state_view` or `crowd.view()`, and no UI reads it. So saves, hashes, events and `conformance/expected.json` cannot change, and the diff does not touch the expected file. (3) `seed_commute_stress` leaves `commute_revision` alone. That is safe because every host copy keyed on it resets at load: `commuteRevision = NaN` in `attachWasmHost`, `sentCommuteRevision = NaN` in `WorkerCore.load`, `heldCommute` null. `merge.ts` keeps the instance's crowd, and `carryLiveState` (`hostFault.ts:196`) carries the map. (4) A refusal fails engine construction before anything is written. The TS filter (`Number.isSafeInteger`, `isFinite`) accepts exactly what Rust accepts (`fract()==0 && abs<2^53`, `is_finite`), so a live attach cannot hit the refusal. (5) Tests: attach in step and frame mode plus the forced first merge, load without rows, malformed rows, and the Rust unit test. The worker path has no test. | N-1 (not hot-path) |
> | HP-11 | clear for the diff; 1 pre-existing | Added boundary traffic: markers JSON grows by at most 110 rows (about 2 KB), once per load, against a save of 4.49 MiB on large (#1045). The worker gets one structured clone at load. Nothing new crosses per frame. Engine build untouched (no change to `Cargo.toml` or the wasm-build scripts). The pre-existing commute JSON side channel is not listed in A22, A23, #1045, #1049 or #1050. | P-1 |
> | HP-12 | n/a | The diff touches no renderer, HUD or panel. A grep of `src/ui`, `src/render`, `src/presentation`, `src/game` and `src/main.ts` finds no reader of the commute map. | none |
>
> ### Findings
>
> - **D-0 (diff): no hot-path finding.**
>   - All new and changed code runs once per attach and costs O(F), F ≤ 110. That is a hard world cap (floors −9 to 100), so the cost does not grow with the tower.
>   - Estimate: about 110 row visits on each side per attach. That is under 0.1% of the O(U) save serialize and parse the same entry point already does (U = 43,358 on large).
>
> - **P-1 (pre-existing; recommend dismiss by estimate).** The per-sync commute round trip. It is the path the diff's seeded data now flows through.
>   - **Location:** `crowd/mod.rs:282` `commute_stress_json` (collect, then `sort_by_key`, then `json!`), `wasm.rs:817` `to_string`, then TS `JSON.parse` + `parseCommuteStress` (`.every`, `.map`, `new Set`) + `adoptCommuteStress` (clear, set).
>   - **Entry point and tier:** `syncFrame` (`wasmHost.ts:324`, per step in step mode, per frame in frame mode) and worker replies (`workerCore.ts:~131`). It runs whenever `commute_revision` moved, which is on every non-staff despawn, so about every step (estimate).
>   - **Sizes:** F ≤ 110 rows, flat as the tower grows.
>   - **Estimate:** about 6 passes × 110 ≈ 660 row visits, about 750 sort comparisons, about 450 small allocations and a 2 KB string per sync. That is under the section 7 threshold of about 1,000 item visits per step or frame.
>   - **TS equivalent:** none. The TS engine reads its `Map` in place.
>   - **Remedy if wanted (HP-9 #5):** keep `commute_wait_by_floor` as a `BTreeMap<i64,f64>` or a dense 110-slot `Vec`, which drops the sort and the SipHash cost in `record_commute`. Optionally carry the rows as numbers in the frame view instead of JSON.
>   - **HP-10 risk:** none if iteration stays sorted by floor.
>   - **Tracked:** no issue lists it (#1158 A22 and A23 cover the frame view and the hour merge).
>
> - **P-2 (pre-existing; per command; `defer` or cheap `patch`).** The attach reads the whole frame view twice.
>   - **Location:** `attachWasmHost`, `src/wasmhost/wasmHost.ts:136` (`engine.frameView()[3]`) and `:141` (`decodeFrame(engine.frameView()).header.mealOverlayRevision`). Both lines are the same at a2d2cf8.
>   - **Entry point and tier:** every attach, including every undo/redo restore and every load or new game. Per command.
>   - **Sizes:** U = 43,358 on large, 19,806 on the owner's save. The frame view is about 2.00 MiB on large (A22).
>   - **Estimate:** 2 × O(U) record builds in Rust (`frame.rs:239` `for u in units`), 2 × about 2 MiB copies across the boundary, and 43,358 JS record objects from `decodeFrame`, all to read two header fields. That is three avoidable O(U) passes in one entry point, which HP-2's repeated-walk rule flags. Likely several ms per attach on large (cloud estimate, unmeasured). The hour-merge-sized save work in the same entry point dwarfs it.
>   - **TS equivalent:** none (the TS host has no boundary).
>   - **Remedy (HP-9 #2, hoist):** call `const v = engine.frameView()` once and use `decodeHeader(v)` for both fields. Keep a single `decodeFrame(v)` only if attach relies on it to validate the records.
>   - **HP-10 risk:** none. No tick runs between the two reads, so the header fields are identical.
>   - **Tracked:** no issue lists it. Under section 7, a deferral needs a new issue and backlog row, or it can fold into a #1158 follow-up.
>
> - **N-1 (not hot-path; for the Edge Case Hunter).**
>   - `WorkerLoad.markers` (`workerProtocol.ts:33`) and the parameter of `WorkerCore.load` (`workerCore.ts:66`) are typed `{lastHour, lastDay, lastQuarter, lastMonth}`. At runtime `commuteStress` and `extendGesture` still pass through, because the same object goes to `ShadowEngine.apply`.
>   - A refactor that rebuilds that object field by field would drop them silently, and no test covers seeding through the worker host. Suggest typing both as `BoundaryMarkers` and adding a worker-host case to the #1083 integration test.
>
> - **N-2 (doc note, not a finding).** The Rust-only change counter `commute_revision`, which the hosts key their copies on, has no row in the HP-8 table. This diff neither adds nor removes it, so the update rule does not bind this PR. A row with "none" in the TypeScript column would keep the table complete.
