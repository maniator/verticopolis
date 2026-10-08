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
