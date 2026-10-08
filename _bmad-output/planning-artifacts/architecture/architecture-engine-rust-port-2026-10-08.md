# Architecture: the Rust engine, from port to host

Date: 2026-10-08. Status: planning, owner-directed. Companion to the native
client brief and its engine architecture draft in the private distribution
repository (`brief-native-client-2026-10-07/`), whose work list this document
updates now that the port exists.

## Where things stand

| Item from the engine architecture draft | State |
| --- | --- |
| 1. Conformance suite | Done (#854). Six scenarios, 342 checkpoints, pinned in `conformance/expected.json`, run in `npm test`. |
| 5. Rust core | Ported in full, Classic and Modern together (#857). `engine-rs/` replays every scenario and matches every checkpoint. CI runs the referee on every change to the crate, the scenarios or the fixtures. |
| 2. Saves keep what they do not understand | Not started. Applies to both engines now (see "Two engines, one simulation"). |
| 3. Core, Classic, Modern split | Deferred. The owner moved the port ahead of the split; the Rust crate keeps the TypeScript shape (one engine, a rule set chosen by mode). A split can still happen later, in both engines at once, behind the referee. |
| 4. Per-step cost (#846) | Open. Any fix lands in both engines in one PR. |

## Two engines, one simulation

Until the web game runs on the Rust engine, there are two implementations of
one simulation, and the only thing that keeps them one is the referee. Rules
while that is true:

- A simulation change lands in both engines in the same pull request, with
  the regenerated lock. CI fails either engine that disagrees with the lock.
- A pull request that changes `src/engine/` and not `engine-rs/` must state
  why (a UI readout, prose, a transient the hash never sees).
- The TypeScript engine stays the reference until the web game ships on
  WASM; after that it is frozen and retired on its own story.

## Phases ahead, each its own story

1. **WASM build and a JavaScript binding.** Compile `engine-rs` to
   `wasm32-unknown-unknown` with a narrow surface: new game, load, serialize,
   tick, the build and edit commands, and the read views the renderer needs.
   The binding is generated, never hand-written twice. Gate: the referee runs
   through the binding from Node and matches every checkpoint.
2. **Dual run in the browser.** The web game runs the TypeScript engine and,
   behind a developer flag, the WASM engine in a worker, hashing both at every
   hour boundary and reporting the first divergence in the console. Gate: a
   full day on each fixture save with no divergence, at the game's own step
   cadence and speeds.
3. **Switch the web game to WASM.** The renderer reads the WASM engine's views;
   the TypeScript engine stays as the reference behind the referee. Gate:
   every golden master, the e2e suite and the conformance suite pass, and
   the Modern speed profile is no slower than the TypeScript engine on the
   late-game fixture.
4. **Saves keep what they do not understand** (draft item 2), implemented in
   the Rust engine with the TypeScript writer matched for the hash.
5. **Threading evaluation.** See below. Gate: the referee still matches with
   threads on, on every scenario, across repeated runs.
6. **Godot spike** on the shared engine, per the brief's go/no-go gate, in its
   own private repository.

## Threading

The simulation step is sequential by contract: three random streams are drawn
in a fixed order and every floating-point operation has a fixed order, and the
hash depends on both. Threads inside a step are only admissible where a pass
reads state and writes nothing the rest of the step reads, and where the
merged result is independent of thread timing. Candidates, in the order they
would be tried:

- Scenario replay in the referee (done: one thread per scenario).
- The engine on its own thread, with the host reading snapshots (phase 2).
- Read-only passes inside a step: the per-floor reachability probes, the
  demand map, the satisfaction context. Each one must be proven draw-free and
  order-free before it fans out.

The conformance suite is the regression net for all of it: a threading
mistake shows up as a named checkpoint rather than a slow drift.

## Repository placement

The Rust engine is public, in `maniator/verticopolis` beside the TypeScript
engine, because the private rule for a native client is that it runs the one
public engine package and passes the public conformance suite. Steam,
identity, packaging and store code stay in the private repository.
