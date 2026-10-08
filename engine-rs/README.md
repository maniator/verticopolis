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
cargo run --release --bin dump -- starter-classic t+60   # canonical JSON of one checkpoint
```

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
