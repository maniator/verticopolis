---
name: engine-parity-review
description: 'Review guidance for a pull request that touches the simulation (src/engine), its Rust port (engine-rs), the conformance suite (conformance/), the save loaders (src/storage) or the TDT import and export: the two-engine rule, the lock, the loader table, the canon caps, and what the hashes do and do not prove. Use when any of those paths changes.'
---

# Engine parity review

Verticopolis runs one simulation in two engines: `src/engine/` (TypeScript,
the reference) and `engine-rs/` (Rust, the port). Frontends may differ;
simulations may not. The referee is `conformance/expected.json`: every
scenario under `conformance/scenarios/` is replayed by both engines and each
checkpoint hash must match byte for byte. This skill is the checklist for
reviewing a change on that seam. It sits beside the repo's review method
(`gds-code-review` for engine work, `bmad-code-review` for plumbing); it does
not replace it.

## What to check, in order

1. **Both engines in one pull request.** A change under `src/engine/` that
   alters simulation behavior must change `engine-rs/` too and regenerate the
   lock in the same PR. A PR that touches `src/engine/` and not `engine-rs/`
   must say why in its description (a UI readout, prose, a transient the hash
   never sees). Flag it when it does not.
2. **The lock moved for a stated reason.** `conformance/expected.json` changes
   only when the simulation changed on purpose. A refactor that claims to
   change nothing must not touch it. A moved hash with no explanation is a
   finding.
3. **A new branch has a scenario that reaches it.** Any engine branch added
   in the PR needs a scenario under `conformance/scenarios/` (or an added
   command to an existing one) so the referee exercises it. The Rust CI job
   measures this with `cargo llvm-cov`; the line floor in
   `.github/workflows/engine-rs.yml` only moves up.
4. **Loader coercion has a table case.** A change to how a save field is
   read (`src/engine/sim/serialization.ts`, `engine-rs/src/load.rs`, the
   migrations) needs a row in `conformance/loader-cases.json`, written by
   `src/tests/integration/loaderCases.integration.test.ts` and replayed by
   the Rust `loader_cases` test. A `knownDivergence` marker is a recorded gap
   (#858), never a way to skip a case.
5. **JavaScript number semantics survive the port.** `Math.round`,
   `Number()` of strings, `Math.min`/`Math.max` with NaN, `-0`, and
   `toString` formatting are mirrored in `engine-rs/src/jsmath.rs`,
   `load.rs` and `canonical.rs`. New arithmetic on the Rust side that reaches
   the hash must use those helpers, in the same order the TypeScript
   evaluates.
6. **Random streams draw in the same order.** The engine has three seeded
   Mulberry32 streams. A reordered or added draw on one side moves every
   later hash. Look for a `rng` call added, removed or moved in only one
   engine, and for a Classic branch that must short-circuit before any draw.
7. **Collection order is insertion order.** `Map`, `Set` and array order in
   the TypeScript are `IndexMap`, `IndexSet` and `Vec` in Rust. A `HashMap`
   or a sort that the TypeScript does not do is a divergence waiting for a
   scenario.
8. **Canon caps come from one place.** Per-tower build caps, the single
   24-shaft elevator pool (express included), the 64-link stair and
   escalator pool, 8 cars per shaft and the span rules live in
   `src/engine/facilities.ts` and `engine-rs/src/facilities.rs`, pinned by
   the `canon_caps_and_pools` test. Do not accept a "fix" that moves express
   out of the elevator pool.
9. **Scenario descriptions claim only what the commands do.** Read a new or
   edited scenario against its commands: the fixture it starts from (and
   which fields a derived fixture edited), the branch it says it reaches, the
   labels. The runner refuses unknown ops and fields; the description is the
   part only a reviewer checks.
10. **TDT import and export are engine-data fidelity.** `src/storage/tdt*`
    turns 1994 tower bytes into the serialized game and back with hashed
    seeds and table layouts. Treat a change there as engine work (the
    `gds-code-review` lens), and expect the same referee method once the
    Rust port of it lands.

## How to verify locally

```sh
npm test                                            # runs the conformance suite
VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration conformance   # regenerate the lock on purpose
cargo run --release --manifest-path engine-rs/Cargo.toml --bin conformance # the Rust referee
cargo test --manifest-path engine-rs/Cargo.toml     # loader table, canon caps, number helpers
```

A referee miss names the first divergent checkpoint; `engine-rs/src/bin/dump.rs`
prints the Rust state at a label and `scripts/loader-case-dump.ts` prints the
TypeScript view of a loader case, for a field-by-field diff.

## Where the rules live

- `CONTRIBUTING.md`, "Two engines, one simulation": the binding rules.
- `conformance/README.md`: the scenario format, the hash definition, the
  fixtures and the loader table.
- `engine-rs/README.md`: the crate layout, the referee and the coverage floor.
- `_bmad-output/planning-artifacts/architecture/architecture-engine-rust-port-2026-10-08.md`:
  the roadmap (WASM binding, dual run, switch, TDT port, retirement) and
  which gate each story is behind.

## Prose in the diff

American English. No em-dashes in anything new (commas, colons, parentheses
or separate sentences instead). No "X, not Y" restatement and no marketing
vocabulary. A player-visible change bumps `package.json` `version`; engine
parity work that changes no behavior does not.
