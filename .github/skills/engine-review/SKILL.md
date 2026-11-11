---
name: engine-review
description: 'Review guidance for a pull request that touches the simulation (engine-rs), the conformance suite (conformance/), the save loaders (src/storage) or the TDT import and export: the lock, the loader table, determinism, the canon caps, hot-path cost, and what the hashes do and do not prove. Use when any of those paths changes.'
---

# Engine review

Verticopolis runs one simulation: the Rust engine in `engine-rs/`, which the
web game loads through its WASM binding. Frontends may differ; simulations
may not. The referee is `conformance/expected.json`: every scenario under
`conformance/scenarios/` is replayed on the engine and each checkpoint hash
must match byte for byte. This skill is the checklist for reviewing a change
to the simulation or its saves. It sits beside the repo's review method
(`gds-code-review` for engine work, `bmad-code-review` for plumbing); it does
not replace it.

## What to check, in order

1. **The lock moved for a stated reason.** `conformance/expected.json`
   changes only when the simulation changed on purpose, and the PR says what
   changed. A refactor that claims to change nothing must not touch it. A
   moved hash with no explanation is a finding. A moved lock also moves the
   engine crate version (CONTRIBUTING.md, Versioning).
2. **A new branch has a scenario that reaches it.** Any engine branch added
   in the PR needs a scenario under `conformance/scenarios/` (or an added
   command to an existing one) so the referee exercises it. The Rust CI job
   measures this with `cargo llvm-cov`; the line floor in
   `.github/workflows/engine-rs.yml` only moves up.
3. **Loader coercion has a table case.** A change to how a save field is
   read (`engine-rs/src/load.rs` and `load/`, the migrations) needs a row in
   `conformance/loader-cases.json`, which the Rust `loader_cases` test
   replays. A `knownDivergence` marker is a recorded gap, never a way to skip
   a case. Old saves must keep loading: a change that drops a field or a
   migration needs a case that loads a save written before it.
4. **Number semantics stay stable.** `engine-rs/src/jsmath.rs`, `load.rs`
   and `canonical.rs` hold the rounding, string-to-number and formatting
   rules that existing saves and the lock were written with. New arithmetic
   that reaches the hash or a save uses those helpers, so a save written
   today and one written before 3.0 read the same.
5. **Random streams draw in the same order.** The engine has three seeded
   Mulberry32 streams. A reordered or added draw moves every later hash and
   changes how a saved tower plays on. Look for a `rng` call added, removed
   or moved, and for a Classic branch that must short-circuit before any
   draw.
6. **Collection order is insertion order.** The engine uses `IndexMap`,
   `IndexSet` and `Vec` where order reaches the hash or a save. A `HashMap`
   or an unstable sort there is nondeterminism waiting for a scenario.
7. **Canon caps come from one place.** Per-tower build caps, the single
   24-shaft elevator pool (express included), the 64-link stair and
   escalator pool, 8 cars per shaft and the span rules live in
   `engine-rs/src/facilities.rs`, the source of truth, pinned by the
   `canon_caps_and_pools` test and published through the catalog
   (`conformance/catalog-digests.json`). Do not accept a "fix" that moves
   express out of the elevator pool.
8. **Scenario descriptions claim only what the commands do.** Read a new or
   edited scenario against its commands: the fixture it starts from (and
   which fields a derived fixture edited), the branch it says it reaches, the
   labels. The runner refuses unknown ops and fields; the description is the
   part only a reviewer checks.
9. **TDT import and export are engine-data fidelity.** `src/storage/tdt*`
   and the engine's TDT codec turn 1994 tower bytes into the serialized game
   and back with hashed seeds and table layouts. Treat a change there as
   engine work (the `gds-code-review` lens), checked against
   `conformance/tdt-cases.json` and the real 1994 saves.
10. **Hot paths keep their cost down.** Apply
    [`docs/performance/hot-path-review.md`](../../../docs/performance/hot-path-review.md)
    (HP-1 to HP-12). Print its record table when the diff touches a hot-path
    surface (its section 1), or one line saying it does not. Two items matter
    most here. HP-8: a port or rewrite lists the caches, indexes and counters
    the old code kept for the function and its callees, and carries each one over
    or names the Rust structure that answers the same query at the same cost
    or less. Anything else is a dropped cache, which is always `patch`, and a
    reason in the PR or a comment in the port does not close it. Outside a
    port the same holds: a change that removes or bypasses a cache, index or
    counter is always `patch`, apart from the two removals HP-8 allows (an
    equivalent named in the record, or the query itself gone). HP-7: ported,
    rewritten and moved code is reviewed as new, so "the old code did the
    same" does not close a finding. An optimization must leave the lock, the
    RNG draw order and collection order untouched (items 1, 5 and 6).

## How to verify locally

```sh
npm run wasm:build                                  # the engine package the suites load
npm run test:wasm                                   # the conformance suite on the engine
VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration conformanceWasm   # regenerate the lock on purpose
cargo run --release --manifest-path engine-rs/Cargo.toml --features conformance --bin conformance # the native referee
cargo test --manifest-path engine-rs/Cargo.toml     # loader table, canon caps, number helpers
```

A referee miss names the first divergent checkpoint; `engine-rs/src/bin/dump.rs`
prints the engine state at a label, for a field-by-field diff.

## Where the rules live

- `CONTRIBUTING.md`: the engine rules and versioning.
- `docs/performance/hot-path-review.md`: the hot-path complexity checklist.
- `conformance/README.md`: the scenario format, the hash definition, the
  fixtures and the loader table.
- `engine-rs/README.md`: the crate layout, the referee and the coverage floor.

## Prose in the diff

American English. No em-dashes in anything new (commas, colons, parentheses
or separate sentences instead). No "X, not Y" restatement and no marketing
vocabulary. A change to a deployed path adds a change note
(`.changes/<branch-slug>.md`) and never edits a version line.
