---
title: Seeded differential upgrade (B2)
type: feature
created: 2026-10-20
status: in-progress
context:
  - _bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md
---

# Seeded differential upgrade (B2)

Source of truth: section 4.2 of the Phase 2 plan (PR #1080). This spec splits
B2 into four reviewable slices and fixes what each slice touches. The 14
counted nights start only at the freeze (OD-3). A rehearsal window starts the
night slice 1 lands; it never counts.

## What exists

`engine-rs/src/bin/fuzz.rs` grows 40 commands per seed on the native engine,
`scripts/fuzz-compare.ts` replays the scenario on the TypeScript engine and
compares the `state` and `crowd` hashes at each checkpoint, and
`.github/workflows/engine-fuzz.yml` runs 20 seeds a night. The Rust runner
already hashes the gameplay events drained since the previous checkpoint
(`Checkpoint.events`), but the fuzzer drops that field and the compare never
reads it.

## Slices

### Slice 1: a wider compare, and run hygiene

- Compare the `events` hash at every checkpoint, beside `state` and `crowd`.
- A checkpoint at least every in-game hour inside each of the fuzzer's own
  `tick` commands (`checkpointEvery` of `60 / dt` ticks, or a quarter of a
  short run). The scenario schema gains no field. The cadence counts from the
  start of each tick command, so it is not aligned to the clock hour.
- At each hourly checkpoint, both engines also report the full save, money and
  log. The Rust side writes them to `<id>.rs.detail.json`; the TypeScript side
  produces the same record from its runner. `fuzz-compare.ts` names the first
  differing field: which hash, and then the first of money, a log part
  (`seq`, `count`, `digest`) or a top-level save field. A record that is
  short, relabeled or malformed is a harness failure (exit 3), never an
  agreement.
  These records stay out of `conformance/expected.json`.
- Run hygiene in `engine-fuzz.yml`: a manual run gets its own concurrency
  group so it never replaces a scheduled night; a `seed_block` input replays one
  night's seeds; the run summary records the commit, the seed range, the `seed_block` and
  `seed_offset` that replay it and, for
  a red night, which kind of failure each seed was (a divergence, the Rust
  engine refusing its own scenario, or the harness). The summary gains the
  key in slice 4.
- Tests: a deliberate one-field divergence in a unit test of the compare
  (each of hash, save, money, log, event) fails with the right field named.

### Slice 2: broader scenarios

Slice 2a (done): a cash profile per seed (rich, modest or tight, set after the
tower is built) and mid-run cash of zero, small or negative; one seed in four
grows a 16 to 40 floor tower with sky-lobby rows on floors 15 and 30; those
tall seeds open with a burst of 27 standard shafts and 65 stairs, so the
24-shaft and 64-link pools fill and both engines also agree on the refusal at
each cap (the burst is outside the 40-command budget). A checkpoint follows
every random command, so the runner's 1024-event window holds. The extra
random draws change the scenario any given seed produces, so a seed from
before this slice does not replay. The engine has no bankruptcy rule, so
"cash that runs out" is the whole money goal.

Slice 2b (done): the six dropped commands (`sell`, `adjustRent`, `setCars`,
`setNoRate`, `setSchedule`, `startFire`) have an `expectFail` form in both
runners, so a command one engine refuses and the other accepts is a
divergence. The ops moved to `tuneOps.ts` to keep `scenario.ts` under the
500-line ceiling. A bad address (nothing at the tile) stays an error, since
`expectFail` covers the engine's refusal, not a bad scenario. The fuzzer keeps
a refused tuning command with `expectFail` when the scenario replays clean with
it, and drops it otherwise. The tuning ops take no `reason` yet; #865 pins
reasons on the build ops and the tuning ops can follow if a refusal reason
turns out to matter there.

Slice 2c (done): a path to higher stars, so escalators, service and express
shafts (3, 2 and 3 stars) are accepted and the express stops and lobby skips
run. A new game starts at one star and the star is earned from population and
facility gates, so the scenario start takes an optional `star` (1 to 5) that
sets the game's star before the first command. Above one star, the
TypeScript runner, the Rust runner and the WASM adapter all save the founded
game, raise the star and load it back (the binding has no star setter), so the
start is a loaded game in all three and they agree by construction; a test
compares TypeScript with WASM at the start and an hour later. The fuzzer draws it per seed (one and three stars
for two seeds in seven each, two, four and five for one in seven each), and the draw
changes the scenario any given seed produces. The wedding hall's floor-100 rule
still needs a 100-story tower, which the fuzzer's 40 stories do not reach.

- Guard test: nightly scenarios start from a new game, never a fixture
  outside `conformance/fixtures/`.

### Slice 3: shrinking and the corpus

- A shrinker reduces a failing scenario to the shortest command list that
  still diverges and keeps it under `conformance/fuzz-corpus/`.
- A PR job replays the corpus on every PR that touches either engine, inside a
  ten-minute budget. The nightly keeps growing new seeds.
- Built (done): `fuzz --replay <scenario> <out-dir>` in the Rust fuzzer runs a
  given scenario and writes the records the compare reads;
  `src/tests/conformance/fuzzReplay.ts` is the one compare the nightly, the
  shrinker and the corpus job share (`replayCompare` returns ok, diverged with
  a signature such as `state:units` or `threw`, or a harness failure);
  `scripts/fuzz-shrink.ts` runs delta debugging (`fuzzShrink.ts`, `ddmin`) over
  the command list and accepts a candidate only when Rust runs it cleanly and
  the TypeScript replay shows the same signature as the original, so a smaller
  scenario that breaks a different way is not taken; `scripts/fuzz-corpus.ts`
  replays the corpus (exit 1 on a divergence, an engine refusal or the 240 s
  budget, exit 3 on a harness failure or an empty corpus); the `fuzz-corpus`
  job joins the required `engine-rs` check. The shrinker and the corpus script
  join `FUZZ_ENTRIES`, so they move the window key. The corpus starts with two
  past findings (a reload at five stars, a refused sell of the ground lobby)
  and two generator scenarios as smoke entries. Checked by mutation: with the
  clinic's price changed in the TypeScript engine, a 132-command scenario
  shrank to a two-command one in 87 tests (4 s), and the corpus job failed on it.

### Slice 4: the shipped artifact, and the key

- A share of each night's seeds runs through the WASM build in Node.
- The key script (done): `scripts/fuzz-key.ts` prints a SHA-256 over six
  parts (the crate, `src/engine` without its tests, the nightly scripts' import
  closure with `tsconfig.json`, the WASM build's inputs, the pins and the
  fixtures). TypeScript's own scanner reads the imports, text files hash the
  same under CRLF, and dotfiles and symlinks are skipped, so a key computed on
  the owner's PC matches CI's. A version bump leaves it alone. The nightly
  records it in its run summary, with the event and ref, and in
  `fuzz-out/window-key.txt` in the scenarios artifact. A key that cannot be
  computed is recorded as `unavailable`; the job stays green, and the freeze
  guard and the window ledger treat such a night as not counting. A guard test
  ties `FUZZ_ENTRIES` to the scripts the workflow runs, and another checks that
  the WASM build part matches the engine-wasm action's hand-kept key list. The
  WASM runner and the shrinker join `FUZZ_ENTRIES` when they land. The freeze
  guard, a PR check that recomputes the key and fails on a change while a window
  is open, comes next and picks the marker file that opens and closes it.
- The nightly's time budget is set from the measured cost after slices 1 to 3.

## Boundaries

- No change to gameplay, the locks or the scenario schema in slice 1. The
  runners gain an optional detail channel (`run_scenario_detailed`, the
  `details` argument of `runScenario`, a `conformance`-gated Rust module) that
  the locked conformance path does not use: `conformance/expected.json` and its
  tests are unchanged. The Rust edits sit inside `engine-rs`, so they change
  the engine source hash (and so the engine-wasm cache key) once. Slices 2 to 4
  may add runner features only where a slice says so.
- The window rules (counting, resets) are the plan's, under OD-7. This spec
  builds the instrument; it does not declare a window.

## Verification

Per slice: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`,
typecheck, lint, `npm test`, build, and a local fuzz run of at least 20 seeds
green on `main`. Review: `/gds-code-review` (engine-data fidelity of what is
compared) and `/bmad-code-review` (workflow and script plumbing).
