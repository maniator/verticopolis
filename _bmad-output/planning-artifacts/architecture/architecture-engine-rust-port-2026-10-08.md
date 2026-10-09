# Architecture: the Rust engine, from port to host

Date: 2026-10-08. Status: planning, owner-directed. Companion to the native
client brief and its engine architecture draft in the private distribution
repository (`brief-native-client-2026-10-07/`), whose work list this document
updates now that the port exists.

## Where things stand

| Item from the engine architecture draft | State |
| --- | --- |
| 1. Conformance suite | Done (#854, widened by #861 and the scenario library's second slice). Nineteen scenarios, 518 checkpoints, pinned in `conformance/expected.json`, run in `npm test`; a loader table and a nightly differential fuzzer beside it. |
| 5. Rust core | Ported in full, Classic and Modern together (#857). `engine-rs/` replays every scenario and matches every checkpoint. CI runs the referee on every change to the crate, the scenarios or the fixtures. |
| 2. Saves keep what they do not understand | Not started. Applies to both engines now (see "Two engines, one simulation"). |
| 3. Core, Classic, Modern split | Deferred. The owner moved the port ahead of the split; the Rust crate keeps the TypeScript shape (one engine, a rule set chosen by mode). A split can still happen later, in both engines at once, behind the referee. |
| 4. Per-step cost (#846) | Open. Any fix lands in both engines in one PR. |

## Two engines, one simulation

Until the web game runs on the Rust engine, there are two implementations of
one simulation, and the only thing that keeps them one is the referee. The
binding rules live in CONTRIBUTING.md ("Two engines, one simulation"); the
summary here is for the reader of this plan:

- A simulation change lands in both engines in the same pull request, with
  the regenerated lock. CI fails either engine that disagrees with the lock.
- A pull request that changes `src/engine/` and not `engine-rs/` must state
  why (a UI readout, prose, a transient the hash never sees).
- The TypeScript engine stays the reference until the web game ships on
  WASM; after that it is frozen and retired on its own story.
- An engine pull request that adds a branch adds a scenario that reaches
  it. The referee's coverage map (the Rust job's `cargo llvm-cov` step, with a
  line floor that only ratchets up) is how review checks it.

## What the TypeScript tests pin, and where it goes

The TypeScript engine carries 360 tests in 32 files. Each one pins a claim
about the simulation, and every claim has to survive the retirement of
`src/engine/`. The mechanism is the lock, never a mirrored suite: two
hand-maintained suites drift apart silently, a hash cannot. Each test maps to
exactly one home, recorded in a checked-in table that a CI test keeps
complete:

- A conformance scenario, when the claim shows up in hashed state. This is
  most of them (housekeeping, churn, milestones, dispatch, economy), and it is
  the stronger form because it pins the numbers rather than a relation.
- A Rust unit test, when the claim is about a constant, a cap or a pure
  function (build caps, the 24-shaft pool, the rent ladder, the JavaScript
  number helpers).
- Dropped, with the reason recorded, when the test exercises TypeScript
  plumbing with no Rust counterpart.

The table is a gate for phase 3 and a precondition for phase 7.

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
   own private repository. The Godot client links the crate natively through
   GDExtension (the `gdext` Rust bindings for Godot 4); no WASM and no browser
   on Steam, Steam Deck or the desktop builds. Once that client exists, the
   Electron wrapper planned in the distribution repository has no job left.
7. **TDT in the crate.** The `.TDT` import and export (24 files under
   `src/storage/tdt*`, 20 tests) are engine-data work: bytes to the serialized
   game and back, with hashed seeds and table layouts that must be bit-exact.
   They move into `engine-rs` so the Godot client reads and writes 1994 towers
   natively and the web gets them through the same WASM binding. Same referee
   method: every TDT fixture round-trips to the TypeScript's serialized JSON,
   hashed into a lock the Rust must match.
8. **Retire the TypeScript engine**, one or two releases after the switch, once
   the test-mapping table above is complete and the fallback flag has gone
   unused. After that the lock is the Rust engine's own regression baseline.

Two consumers, one crate: the web PWA through WASM (phases 1 to 3) and the
Godot client through GDExtension (phase 6). Neither gates the other.

## Order and gates

The stories, in the order they run, each gated on the one before:

| # | Story | Gate to start | Gate to finish |
| --- | --- | --- | --- |
| 1 | `story-engine-scenario-library` | #857 merged | Done: floor at 87%, no engine module under 75%, fuzzer nightly, canon tests, #860 closed, CONTRIBUTING rule |
| 2 | `story-engine-wasm-binding` (phase 1) | 1 | Referee matches through the binding from Node |
| 3 | `story-engine-dual-run` (phase 2) | 2 | A full day on each fixture with no divergence at game cadence |
| 4 | `story-engine-wasm-switch` (phase 3) | 3, plus the test-mapping table started | Golden masters, e2e, conformance green; Modern profile no slower |
| 5 | `story-engine-tdt-port` (phase 7) | 1 (can overlap 2 to 4) | TDT lock matched both ways |
| 6 | `story-engine-copy-catalog` | any time after 1 | Engines emit ids, one catalog, save version bump |
| 7 | `story-engine-retire-typescript` (phase 8) | 4, 5, 6, two releases on WASM, table complete | `src/engine/` gone, lock Rust-owned, major bump |
| 8 | Godot spike (phase 6, private) | 1 | Brief's go/no-go gate |

Saves-keep-unknown-fields (phase 4) and the threading evaluation (phase 5)
are independent of this order and land where they are needed.

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
