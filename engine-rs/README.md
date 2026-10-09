# Verticopolis engine in Rust

`engine-rs/` is a port of the simulation in `src/engine/` to Rust. It exists
so the same game can run under hosts the TypeScript engine cannot reach (a
native desktop client, a WASM module) while staying one simulation.

Frontends may differ. Simulations may not. The referee for that rule is the
conformance suite in `../conformance/`: the port replays every scenario and
must reproduce every pinned checkpoint hash (`expected.json`) byte for byte.

## Layout

| Rust | TypeScript original |
| --- | --- |
| `rng.rs`, `jsmath.rs`, `canonical.rs` | `rng.ts`, JavaScript number semantics, the conformance hash |
| `clock.rs`, `rules.rs`, `facilities.rs`, `econ.rs` | `Clock.ts`, `calendar.ts`, `ruleSets.ts`, `gameRules.ts`, `facilitiesData.ts`, `facilities.ts`, `facilityCaps.ts`, `facilityPredicates.ts`, `residentialRentals.ts`, `retailSubtypes.ts`, `tower/towerTopology.ts`, `econConfig.ts`, `pricing.ts`, `sim/constants.ts` |
| `tower.rs`, `tower_query.rs`, `schedule.rs` | `Tower.ts`, `tower/*.ts`, `census.ts`, `elevatorSchedule.ts` |
| `build.rs`, `rent.rs` | `sim/build.ts`, `sim/rent.ts` |
| `dispatch.rs` | `ElevatorDispatch.ts` |
| `crowd/` | `Crowd.ts`, `crowd/*.ts` |
| `sim_loop.rs`, `presence.rs`, `satisfaction.rs`, `demand.rs`, `churn.rs`, `star.rs`, `services.rs` | `sim/loop.ts`, `sim/presence.ts`, `sim/congestion.ts`, `sim/satisfaction*.ts`, `sim/gripe.ts`, `sim/demand.ts`, `sim/churn.ts`, `households.ts`, `sim/star.ts`, `milestones.ts`, `sim/services.ts`, `sim/events.ts` |
| `economy.rs`, `housekeeping.rs`, `ledger.rs`, `events.rs` | `EconomySystem.ts`, `economy/*.ts`, `Ledger.ts`, `EventSystem.ts` |
| `sim.rs`, `load.rs` | `Simulation.ts`, `sim/stats.ts` (`recordMoney`, `emit`), `sim/serialization.ts`, `sim/coerce.ts`, `sim/deserializeGuards.ts`, `sim/founderStatus.ts`, `saveMigration.ts`, `migrations/*.ts`, `storage/vctowerContainer.ts` |
| `scenario.rs`, `bin/conformance.rs`, `bin/dump.rs` | `src/tests/conformance/scenario.ts` |
| `wasm.rs` (feature `wasm`) | the JavaScript binding; `src/tests/conformance/wasmEngine.ts` and `src/dualrun/` drive it |

Functions keep the names and shape of their TypeScript originals so the two
can be read side by side. Where JavaScript semantics matter for the hash
(`Math.round`, `Number#toString`, Mulberry32 on wrapping 32-bit integers,
insertion-ordered maps and sets) the Rust spells them out rather than
reaching for the nearest standard-library call.

Player-facing prose (log text, event messages) is not part of the conformance
contract and is not word for word identical yet. Host plumbing and UI-only
readouts the hashed state never reads (`scheduleOrigins.ts`,
`scheduleAuthoring.ts`, `traffic.ts`, `sim/fixedStep.ts`, `timePacing.ts`,
`UndoHistory.ts`, `SimContext.ts`, the rest of `sim/stats.ts`) are not ported.

## Running

```sh
cd engine-rs
cargo test                                  # unit tests (rng, number formatting, hash)
cargo run --release --bin conformance       # replay every scenario against expected.json
cargo llvm-cov --no-report test && cargo llvm-cov --no-report run --bin conformance \
  && cargo llvm-cov report               # what the tests and the referee reach; CI floors lines at 87%
cargo run --release --bin dump -- starter-classic t+60   # canonical JSON of one checkpoint
```

## The WASM binding

The crate also builds as a WebAssembly module for JavaScript hosts. The
binding (`src/wasm.rs`, behind the `wasm` cargo feature) exports one class,
`Engine`, with constructors for a new game, a serialized save and a
`.vctower` text, and methods for ticking, the build and edit commands, the
events, the tile queries, the readouts a runner checks (`mode`, `money`,
`setMoney`, `fires`), `serialize` and the two hashed views with their
digests. Structured values cross as JSON text; integers cross as 32-bit
values (`i32`, and `u32` for the seed and the fire count), which the
generated TypeScript sees as `number`.
Nothing in the binding simulates anything.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --locked --version 0.2.129   # the version Cargo.toml pins
npm run wasm:build          # cargo rustc (cdylib) for wasm32 + wasm-bindgen into engine-rs/pkg/
npm run test:wasm           # every scenario through the binding, and the dual run's day gate (fails without the package)
```

`engine-rs/pkg/` is build output and is not checked in, except for the
declaration wasm-bindgen writes, copied to `src/dualrun/engine.d.ts`:
`src/dualrun/binding.ts` types the adapters against it, so a method added
or renamed in `wasm.rs` reaches TypeScript as a type change, and the
`engine-rs.yml` job fails when the checked-in copy is stale (rebuild and
commit it with the Rust change). The WASM suite
(`src/tests/integration/conformanceWasm.integration.test.ts`) skips itself
when the package is missing, so `npm test` stays green without a Rust
toolchain; CI builds the package and runs the suite in `engine-rs.yml` with
`VC_REQUIRE_WASM=1`, under which a missing package fails the run. Rebuild
the package after any change to the Rust source; the suite replays whatever
was built last.

## The switch

Behind `?engine=wasm` (or `localStorage.setItem("vc.engine", "wasm")`,
`?engine=ts` to override) the web game runs on the WASM engine
(story-engine-wasm-switch): the engine alone ticks, and the `Simulation`
instance the app holds becomes a read model of it, refreshed every frame
from `Engine.frameView()` (one flat number array) and, on every hour pass or
tower revision, from the engine's save, merged in place so the renderer's
object references hold. Host commands still run on the instance (the caller
gets the TypeScript answer) and relay to the engine. `window.__vcEngine`
says which engine runs. The browser package is served from `src/public/engine/`
and committed with a `BUILD.json` naming the Rust sources' hash; a unit test
fails when the sources moved on without `npm run wasm:build`. The Vercel
build (`scripts/vercel-build.sh`) installs the pinned toolchain and builds
the package itself on every deploy, so a Rust change reaches the preview and
production without a committed binary. The gate is
`src/tests/integration/wasmHost.integration.test.ts`: the instance's own
state view equals the engine's at every hour of a day on every fixture.

## The dual run

The binding's second consumer is the dual run (story-engine-dual-run): the
web game, behind a developer switch, runs the WASM engine in a worker beside
the live TypeScript engine, mirrors every command to it and compares the two
hashed views at every hour. Switch it on under `npm run dev` with
`?dualrun=1` (or `localStorage.setItem("vc.dualrun", "1")`) after
`npm run wasm:build`, which also writes the browser package to
`src/public/engine/`; the first divergence prints in the console with the
JSON path where the views depart. The same mirror and shadow run in Node as
the gate, a full day on every fixture at each game speed through the frame
loop's own step math: `npm run test:wasm` (the `dualRun*` suites).

The referee prints one line per scenario: `ok`, the first divergent
checkpoint with both hashes, or the first command the port cannot run. It
exits non-zero unless every scenario matches. When a checkpoint diverges,
compare the two engines' canonical JSON for that label (the `dump` binary on
this side, `stateView` on the TypeScript side) to find the field.

## Keeping the two engines together

A simulation change lands in both engines in the same pull request, with the
regenerated `conformance/expected.json` (see `conformance/README.md`). CI runs
the referee on every change to `engine-rs/`, `conformance/` or the save
fixtures (`.github/workflows/engine-rs.yml`).
