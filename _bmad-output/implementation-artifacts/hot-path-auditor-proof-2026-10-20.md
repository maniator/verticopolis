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
describe. This is that run, on a real engine commit, with the overrides exactly
as #1163 merged them (main 6761fcf).

## What ran

- **Skill:** `/gds-code-review` (engine work), launched through the Skill tool
  with the commit range `a2d2cf8^..a2d2cf8`.
- **Target:** a2d2cf8, "Seed the engine's commute averages from the instance
  at attach" (#1083, merged through #1101). 7 files, +123/-12:
  `engine-rs/src/crowd/mod.rs`, `engine-rs/src/wasm.rs`,
  `src/dualrun/commands.ts`, `src/dualrun/engine.d.ts`, `src/dualrun/mirror.ts`,
  `src/dualrun/mirror.test.ts` and an integration test. #1083 predates the page,
  so section 1 leaves its own review as it was; this run is a demonstration,
  and its findings are tracked anyway.
- **Mode:** no-spec (no story file for the commit), so the skill skips the
  Acceptance Auditor.

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

> Hot-path gate: YES. Changed paths in section 1's table:
> `engine-rs/src/crowd/mod.rs` (Rust engine), `engine-rs/src/wasm.rs` and
> `src/dualrun/*` (WASM binding). The integration test is a test, not a hot
> path. This run includes the Hot-Path Auditor layer.

## Step 2: the layers launched

Three subagents ran in parallel: Blind Hunter (diff only), Edge Case Hunter
(diff and repository) and the Hot-Path Auditor (diff and repository, with the
section 9 prompt). All three returned; `{failed_layers}` stayed empty. The
auditor returned the full section 6 table:

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | clear | `seed_commute_stress` ← `apply_markers` ← `Engine::from_save(text, Some(markers))` ← `ShadowEngine.apply({op: "load"})`, reached from `attachWasmHost` (start, load, new game, every undo and redo, a fault restore), the worker host's `load` message and the dual run's `follow`. TS `loadCommand` has the same callers. Every chain ends at attach (per command); perf:compare and the conformance runners pass no markers and skip the new code. | none in the diff; the traces surfaced P-1 and P-2 |
| HP-2 | clear for the diff; 1 pre-existing | One pass over at most 110 floor rows on each side, once per command. The unchanged attach work (`serialize`, `parse_save_json`, `deserialize`) is O(U) once per command. `attachWasmHost` repeats an O(U) walk. | P-2, deferred by reference (#1158 A25) |
| HP-3 | clear for the diff; 1 pre-existing | Once per command: at most 110 two-element arrays, a serde value tree of about 330 nodes, one new map. The unchanged per-sync commute round trip allocates a little per sync. | P-1, deferred by reference (#1158 A26) |
| HP-4 | clear for the diff | The diff sorts nothing. `commute_stress_json` sorts at most 110 rows per read, and the map changes on each despawn, so this is not a once-per-revision collection. | covered by P-1 |
| HP-5 | clear | The new map takes at most 110 inserts per command. Its only iteration is followed by a sort on unique keys, so order cannot leak. | none |
| HP-6 | clear | No id lookups. Duplicate floors are caught by the map insert's return value. | none |
| HP-7 | clear | Nothing is ported; `seed_commute_stress` is new code, one O(rows) pass. | none |
| HP-8 | clear | TS `commuteWaitByFloor` and `adoptCommuteStress` use no cache, index or counter. The Rust-only counter `commute_revision` predates the diff and had no row. | N-2: row added to the HP-8 table in the follow-up |
| HP-9 | n/a for the diff | No HP-2 to HP-6 finding in the diff to remedy. | remedies named under P-1 and P-2 |
| HP-10 | clear | No RNG draw. The averages are a readout: not in `serialize`, `state_view` or `crowd.view()`, so saves, hashes, events and the conformance lock cannot change. Leaving `commute_revision` alone on a seed is safe because every host copy keyed on it resets at load (`NaN` sentinels in both hosts). A refusal fails engine construction before anything is written. The TS filter accepts exactly what Rust accepts. The worker path has no test. | worker test gap in #1166 |
| HP-11 | clear for the diff; 1 pre-existing | The load command grows by at most 110 rows (about 2 KB) once per load, against a 4.49 MiB save on large. Nothing new crosses per frame; the engine build is untouched. | P-1 (#1158 A26) |
| HP-12 | n/a | No renderer, HUD or panel changed, and none reads the commute map. | none |

## Step 3: triage

Hot-path findings, under section 7:

- **D-0, the diff itself: no finding.** All new and changed code runs once per
  attach at O(F), with F ≤ 110 a hard cap: about 110 row visits each side,
  under 0.1% of the O(U) save work the same entry point already does.
- **P-1, the per-sync commute round trip (pre-existing): deferred by
  reference.** Whenever `commute_revision` moved (about every step), Rust
  collects, sorts and serializes up to 110 rows to JSON and the host parses,
  validates and re-adopts them: about 660 row visits, 750 sort comparisons and
  450 small allocations per sync, plus a JSON round trip across the boundary
  (HP-11). The auditor proposed dismissing it by estimate, but with the sort
  counted the work sits above section 7's allowance of about 1,000 visits per
  step or frame, so it is not a clear false positive. Added to #1158 as A26
  (P3, watch) with the fix: keep the averages in a `BTreeMap` or a dense floor
  `Vec`, or carry them as numbers in the frame view.
- **P-2, `attachWasmHost` reads the whole frame view twice (pre-existing):
  deferred by reference.** Three avoidable O(U) passes per attach (two frame
  view builds and a full decode) to read two header fields; per command, so
  HP-2's repeated-walk rule flags it. No open issue listed it, so it was added
  to #1158 as A25 with its estimate and fix.
- **N-2, `commute_revision` had no HP-8 row: patch.** Row added in the
  follow-up PR.

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

1 hot-path patch (applied in the follow-up), 2 hot-path defers by reference
(#1158 A25 and A26), 1 grouped correctness defer (#1166), 4 dismissed. One
triage call overrode the auditor: P-1 is deferred, since its estimate does not
clear the allowance once the sort is counted. No `decision_needed`. The record above is the step 4
record; it is posted on the follow-up PR as a comment.
