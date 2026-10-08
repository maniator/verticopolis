---
story: engine-rust-port
status: review
baseline_commit: a1fe632
---

# Story: engine port to Rust

## Why

The platform plan calls for one simulation under several hosts: the web game,
and later a native client that cannot run the TypeScript engine. A second
engine is only acceptable if it provably simulates the same game, which is
what the conformance suite (`story-engine-conformance-suite`) was built to
referee. This story ports the engine to Rust and holds it to that referee.

## Acceptance criteria

1. **AC1 One crate, one layout.** `engine-rs/` is a Cargo crate whose modules
   mirror `src/engine/` module by module (a Rust module may fold several
   small TypeScript files), with every ported file named in the mapping in
   `engine-rs/README.md`.
2. **AC2 Same numbers.** The port reproduces JavaScript's arithmetic where
   the hash depends on it: Mulberry32 on wrapping 32-bit integers,
   `Math.round` half up, `Number#toString` shortest round-trip formatting,
   insertion-ordered maps and sets, and JSON floats parsed exactly. Unit tests
   pin the random stream and the number formatting against Node.
3. **AC3 Every scenario.** `cargo run --release --bin conformance` replays all
   six scenarios in `conformance/` (two new games, the events scenario, and
   the three save fixtures through v1, v4 and v7 migration) and reports every
   checkpoint as a match against `conformance/expected.json`.
4. **AC4 Diagnosable.** The referee names the first divergent checkpoint with
   both hashes, or the first command the port cannot run. A `dump` binary
   prints the canonical JSON of any checkpoint so a divergence can be read down
   to the field.
5. **AC5 In CI.** `.github/workflows/engine-rs.yml` runs format, lint, the
   unit tests and the referee on every change to the crate, the scenarios, the
   lock or the fixtures.
6. **AC6 No TypeScript change.** The TypeScript engine, the scenarios and the
   lock are untouched; the port adapts to them, never the other way round.

## Out of scope

The phases after this story (WASM build and binding, the browser dual
run, the switch, threading) are planned in
`_bmad-output/planning-artifacts/architecture/architecture-engine-rust-port-2026-10-08.md`.

- The WASM build and a JavaScript binding for the web game.
- Prose parity: log text and event messages are outside the conformance
  contract and are not word for word identical.
- The UI-only readouts and host plumbing the simulation never hashes: heat
  maps, elevator utilization sampling and the per-shaft origin rings
  (`scheduleOrigins.ts`), schedule authoring, the queue view and boarding
  tally, the stats panel and income breakdown (`sim/stats.ts` beyond
  `recordMoney`), traffic tiers (`traffic.ts`), host step pacing
  (`sim/fixedStep.ts`, `timePacing.ts`), undo history and `SimContext`. The
  referee proves none of these feed the hashed state.
- Replacing the TypeScript engine anywhere.

## Dev notes

- Port order followed where the hashes bite: static data and `serialize`
  first (the `start` and `built` checkpoints), then the step loop, dispatch,
  presence and the crowd (the `t+60` checkpoints), then the hourly and daily
  systems, then save loading.
- Two last-digit float mismatches turned out to be tooling rather than arithmetic:
  serde_json parses floats best-effort unless its `float_roundtrip` feature is
  on, and a stale debug binary. Every genuine mismatch found during the port
  was a mistyped constant (the per-person household churn weight).
- A person's live x is a float; `segAt` compares it against integer run bounds
  and a float over a gap becomes a fractional segment id that matches no graph
  node. The port keeps that semantics with a sentinel id.
- Only what the hashed state reads is ported; the list of what is left out
  is under Out of scope.

## Referee coverage

`cargo llvm-cov run --release --bin conformance` at 372325a: the six scenarios
execute 78% of the crate's lines (9,283 of which 2,007 are never reached).
Where the referee cannot see, by module:

| Module | Lines covered | What is dark |
| --- | --- | --- |
| services.rs | 50% | VIP visit, exterminator booking and resolution, metro cutoff |
| events.rs | 51% | every event other than fire and bomb threat |
| rules.rs, churn.rs | 55%, 58% | Modern rule branches, relocation and eviction paths |
| star.rs | 65% | evaluation failure branches, later milestones |
| satisfaction.rs, schedule.rs, tower.rs | 68% to 70% | gripe branches, off-shift schedules, removal paths |
| housekeeping.rs | 78% | Modern triage order with several dirty wings |
| load.rs | 82% | migration paths the three fixtures do not take |
| crowd, dispatch, sim, sim_loop, demand, clock | 84% to 100% | |

After the scenario library (`story-engine-scenario-library`, two slices,
seventeen scenarios and the loader table) the same measurement is 88% of
lines, with no engine module under 75%: services.rs 85%, events.rs 93%,
rules.rs 96%, churn.rs 96%, star.rs 74% (plus a unit test on the four-star
gate chain), satisfaction.rs 80%, schedule.rs 94%, tower.rs 83%,
housekeeping.rs 98%, load.rs 90%. The dark remainder is the five-star and
TOWER rungs, which need a late-game fixture.

This is the scenario list for the follow-up: a hotel weekend with
housekeeping and an exterminator call, a VIP visit without parking, a star
evaluation that fails and then passes, a metro platform cut off and
reconnected, express cars off shift, and the remaining events. Each one
needs its runner command on both sides and grows the lock.

## Review findings

`/gds-code-review`, round one (2026-10-08): 0 `decision_needed`, 24 `patch`,
3 `defer`, 7 dismissed as faithful ports of TypeScript behavior or noise. The
24 patches are grouped below by file into 16 rows; the fixes landed across
commits 64f888c, cfe6f5e and 0f8b209. The referee's "EXTRA checkpoint" report
belongs to the panicking-scenario row, and the dropped `Serialize` derive on
`Command` to the dead-code row.

- [x] [Review][Patch] Referee aborts on a panicking scenario [engine-rs/src/bin/conformance.rs]
- [x] [Review][Patch] Crowd seed is exact u64 math where JavaScript rounds past 2^53 [engine-rs/src/crowd/spawn.rs]
- [x] [Review][Patch] Save without `seed` founds a different stream; string seed [engine-rs/src/load.rs]
- [x] [Review][Patch] Absent `towerName`/`builtWeddingHall`/`evaluatedTower` re-serialize as present [engine-rs/src/load.rs, sim.rs, tower.rs]
- [x] [Review][Patch] Housekeeping dispatch x integer-divided [engine-rs/src/housekeeping.rs]
- [x] [Review][Patch] NaN condo rent swallowed by `f64::min`/`max` [engine-rs/src/load.rs]
- [x] [Review][Patch] v1 reflow reads a null structural width as 0 [engine-rs/src/load.rs]
- [x] [Review][Patch] `deserialize` panics on the unit cap; inflate has no byte cap [engine-rs/src/load.rs]
- [x] [Review][Patch] Unknown scenario op or field panics; `checkpointEvery: 0` divides by zero [engine-rs/src/scenario.rs]
- [x] [Review][Patch] `dump` and `conformance` panic on bad arguments [engine-rs/src/bin/]
- [x] [Review][Patch] Catalog lookup is a linear scan [engine-rs/src/facilities.rs]
- [x] [Review][Patch] Landing sort unwraps a partial comparison [engine-rs/src/crowd/landing.rs]
- [x] [Review][Patch] Duplicated constants, lazy-init housekeeping default, dead code [several]
- [x] [Review][Patch] CI without `--locked`, a WASM clause the step never runs, no timeout [.github/workflows/engine-rs.yml]
- [x] [Review][Patch] README mapping incomplete; story under-states what is left out; an "X, not Y" sentence [docs]
- [x] [Review][Patch] Undocumented draws and nulls that mirror TypeScript (thief floor, `shaftId` null, floor-level probe) [comments]
- [x] [Review][Defer] JavaScript number semantics on hand-edited saves [engine-rs/src/load.rs] (#858)
- [x] [Review][Defer] Borrowed views for the memoized tower sets [engine-rs/src/tower_query.rs] (#859)
- [x] [Review][Defer] Unit tests for migrations, coercion and schedules [engine-rs/] (#860)

Round two (confirming pass, 2026-10-08) on the round-one fix commits: 0
`decision_needed`, 10 `patch`, 0 new `defer` (the hand-edited-save notes
folded into #858),
and the rest dismissed (compile-checked claims, guards the TypeScript shares,
a crowd that is never loaded from a save, and the 32 MiB cap that mirrors
the `decodeVctower` path the referee uses).

- [x] [Review][Patch] `Number(string)` grammar: Rust `parse` takes `inf`/`nan` and refuses `0x`/`0o`/`0b` [engine-rs/src/load.rs]
- [x] [Review][Patch] Two new "X, not Y" sentences (inflate error copy, floor-probe comment) [engine-rs/src/load.rs, satisfaction.rs]
- [x] [Review][Patch] Referee error lines carry no status token [engine-rs/src/bin/conformance.rs]
- [x] [Review][Patch] Roadmap counts 374 checkpoints; the lock holds 342 [architecture-engine-rust-port-2026-10-08.md]
- [x] [Review][Patch] Story rows do not say how 24 findings became 16 rows across three commits [this file]
- [x] [Review][Patch] Scenario loader skips the runner's checks: `buildRow` from past to, place vs shaft kinds, whole floats like `1.0`, duplicate labels [engine-rs/src/scenario.rs, src/bin/conformance.rs, src/bin/dump.rs]
- [x] [Review][Patch] `.vctower` decoder refuses unpadded or URL-safe base64 and a UTF-8 byte order mark that `Buffer.from` and `TextDecoder` take [engine-rs/src/load.rs]
- [x] [Review][Patch] `Number([7])` reads as NaN [engine-rs/src/load.rs]
- [x] [Review][Patch] `day - lastVipNagDay` can overflow on a saturated nag day [engine-rs/src/services.rs]
- [x] [Review][Patch] `js_number` test coverage [engine-rs/src/load.rs]
- [x] [Review][Defer] Present non-boolean `evaluatedTower`/`builtWeddingHall`/`vipFavorable`, non-string `towerName`, `vipVisitDay` saturation past i64, `1e400`, string-typed legacy widths [engine-rs/src/load.rs] (folded into #858)

Round three (confirming pass, 2026-10-08) on the round-two fix commits: 0
`decision_needed`, 8 `patch`, 0 `defer`, and the rest dismissed (already
fixed in the tree the reviewers did not see, `-0` on a money field that
prints and adds the same, line numbers the field table now replaces, and
error text the TypeScript runner shares).

- [x] [Review][Patch] Scenario loader ports only three of the runner's checks; the whole `OPS` field table now runs before serde (empty strings, null optionals, counts, dir, mode, seed range) [engine-rs/src/scenario.rs]
- [x] [Review][Patch] Duplicate label still pushed and the command keeps running; the closing `final` emit never checked [engine-rs/src/scenario.rs]
- [x] [Review][Patch] Whole-float cutoff at 9e15 refuses what `Number.isInteger` takes; `elapsed` can overflow [engine-rs/src/scenario.rs]
- [x] [Review][Patch] `Buffer.from` leniency: trailing bits, a dangling symbol, `=` mid-string, non-alphabet bytes, U+FEFF before the magic, NEL kept [engine-rs/src/load.rs]
- [x] [Review][Patch] Hex, octal and binary literals now round once rather than per digit; `Number([-0])` is +0 [engine-rs/src/load.rs]
- [x] [Review][Patch] U+0085 counted as JavaScript whitespace [engine-rs/src/load.rs]
- [x] [Review][Patch] `dump` panics on a missing file while a bad one exits cleanly [engine-rs/src/bin/dump.rs]
- [x] [Review][Patch] Tests for `Number()` of arrays, booleans and null, the container's byte order marks and base64 forms; bookkeeping counts and the `1e400` note on #858 [engine-rs/src/load.rs, this file, backlog.md]

Round four (confirming pass, 2026-10-08) on the round-three fix commits: 0
`decision_needed`, 6 `patch`, 0 `defer`; the Acceptance Auditor found no
violation, and the rest was dismissed (whole numbers past 2^63, elapsed
minutes past 2^53, code units above U+00FF in base64, error-text wording,
and two claims the tree already answered).

- [x] [Review][Patch] `Number(["-0"])` keeps its sign; only a numeric `-0` renders as "0" [engine-rs/src/load.rs]
- [x] [Review][Patch] A repeated `stop_at` label stopped instead of failing [engine-rs/src/scenario.rs]
- [x] [Review][Patch] `dump` panics on a missing argument and drops the run error behind "label not reached" [engine-rs/src/bin/dump.rs, scenario.rs]
- [x] [Review][Patch] Hex rounding test could not tell exact from per-digit; base64 test lacked URL-safe, leading `=` and trailing-bit forms; scenario tests asserted only `is_err` [engine-rs/src/load.rs, scenario.rs]
- [x] [Review][Patch] `lenient_base64` carried a `Result` with no failing path; `js_trim` comment garbled; whole-float bound undocumented; one unprefixed error [engine-rs/src/load.rs, scenario.rs]
- [x] [Review][Patch] Story row named "docs" where a path belongs [this file]

Round five (confirming pass, 2026-10-08) on the Codex fix and the round-four
patches: 0 `decision_needed`, 7 `patch`, 0 `defer`; the Acceptance Auditor
found no violation. Dismissed: inputs no save or scenario can carry (labels
starting with `--`, path separators in a dev tool's id, a `.json` directory),
duplicate shaft ids (the loader repairs them and `Map.set` is last-wins too),
and wording the TypeScript shares.

- [x] [Review][Patch] Transport index: no test after a removal, no assertion that the map matches the vector, O(n) rebuild on remove unexplained [engine-rs/src/tower.rs]
- [x] [Review][Patch] Referee folds an unreadable directory entry into "no file" [engine-rs/src/bin/conformance.rs]
- [x] [Review][Patch] `dump` panics on a non-UTF-8 argument [engine-rs/src/bin/dump.rs]
- [x] [Review][Patch] Repeated-label test did not prove the command stops at the emit [engine-rs/src/scenario.rs]
- [x] [Review][Patch] `Number([n])` arm re-implemented the scalar path; `Unsupported` message dropped the label [engine-rs/src/load.rs, scenario.rs]
- [x] [Review][Patch] Comment named "the TypeScript suite" without the test [engine-rs/src/bin/conformance.rs]
- [x] [Review][Patch] Round-three row said `[-0]` keeps its sign and read as if per-digit rounding were the fix [this file]

Round six (confirming pass, 2026-10-08) on the exterminator port and the
round-five patches: 0 `decision_needed`, 6 `patch`, 0 `defer`; the
Acceptance Auditor found no violation. Dismissed: a host-locale
`toLocaleString` (log text is outside the hash and the referee runs under
en-US), the rule-set gate (Modern is the only rule set with a recovery fee),
and `dump` arguments that are not UTF-8.

- [x] [Review][Patch] `call_exterminator` had no test; the `funds` refusal dropped the cost and room count the TypeScript returns [engine-rs/src/services.rs]
- [x] [Review][Patch] `with_thousands` claimed `toLocaleString` parity it did not have; dead negative branch; no 5, 6 or 7-digit case [engine-rs/src/services.rs]
- [x] [Review][Patch] A stale transport index returned the wrong shaft in a release build; the test tolerated refused placements and never removed the last shaft or reindexed after a direct assignment [engine-rs/src/tower.rs]
- [x] [Review][Patch] Repeated-label test did not cover a repeat on a later tick iteration [engine-rs/src/scenario.rs]
- [x] [Review][Patch] Referee id-check message omitted the path and named "the suite" without the test [engine-rs/src/bin/conformance.rs]
- [x] [Review][Patch] Comments: the billed-ids note contradicted itself, the fee constants shared one doc line, the removal note claimed "never", the `Unsupported` message shape differed from `Failed` [engine-rs/src/services.rs, tower.rs, scenario.rs]

Round seven (confirming pass, 2026-10-08) on the round-six patches: 0
`decision_needed`, 1 `patch`, 0 `defer`; the Blind Hunter reported no
behavioral findings and the Acceptance Auditor no violation. The loop stops
here: rounds five through seven surfaced no parity defect, only hardening of
earlier hardening, which is the convergence point CLAUDE.md names.

- [x] [Review][Patch] The release-build fallback on a stale transport index would turn it into a silent no-op in the referee; the check is unconditional now [engine-rs/src/tower.rs]

Codex review of 86f3476 (2026-10-08), both applied:

- [x] [Review][Patch] `callExterminator` (the Modern booking action: fee, billed room ids, next-day deadline) was not ported; only the resolution was [engine-rs/src/services.rs]
- [x] [Review][Patch] Referee does not check a scenario's internal `id` against its file stem as the suite does [engine-rs/src/bin/conformance.rs]

Codex review of beaee7c (2026-10-08), both applied:

- [x] [Review][Patch] `getTransport` is a linear scan on the crowd's hot path where the TypeScript keeps `transportsById` [engine-rs/src/tower.rs, tower_query.rs]
- [x] [Review][Patch] Referee replays only the lock's ids; the scenario directory and the lock must name the same set [engine-rs/src/bin/conformance.rs]

Dismissed: build leaves substrate floors on a failed placement (the
TypeScript does the same), transient crowd readouts kept for hosts, the
`floorReachable` probe (matches the TypeScript), `segId` collisions off the lot
(same in TypeScript), `vacateAt`/retail nulls (match), the sold-condo rent path
on engine-written saves, and the `lingerFor`/`dwelling` interplay.
