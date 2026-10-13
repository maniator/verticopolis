# Using the engine from another frontend

`verticopolis-engine` is the whole simulation: rules, commands, state,
saves and gameplay events. A frontend owns everything a player sees and
hears (rendering, audio, UI, input, presentation) and drives the engine
through the calls below. Frontends may differ. Simulations may not: a host
proves it runs the real simulation by replaying the conformance suite
(`../conformance/`).

`consumer/` is a working example and the CI gate for this page: a crate
outside the engine that depends on it by path and does everything listed
here. The `consumer` job in `.github/workflows/engine-rs.yml` builds and
runs it from a checkout holding only `engine-rs/` and `conformance/`, with
Node.js unavailable. The plan this page belongs to is issue #980.

## Depending on the engine

```toml
[dependencies]
# From a checkout of this repository:
verticopolis-engine = { path = "../verticopolis/engine-rs" }
# Or pinned to a commit:
verticopolis-engine = { git = "https://github.com/maniator/verticopolis", rev = "<sha>" }
```

Default features only. The `wasm` feature is the JavaScript binding
(`src/wasm.rs`) and a native host leaves it off. The build needs the Rust
toolchain in `Cargo.toml` (`rust-version`) and the `engine-rs/` and
`conformance/` directories (the event catalog is compiled in from there).
It needs no Node.js, no npm and nothing else from the web game.

The engine does no IO. It reads no file, clock, environment or network,
and spawns nothing; the host passes in bytes, time and its build name.
`tests/independence.rs` fails if library code starts to.

## The host API

These are the calls a frontend makes (tier 1 in #980). `consumer/` calls
each of them, so a rename or a removal fails CI until this page and the
consumer follow.

| Need | Call |
| --- | --- |
| Start a game | `sim::Simulation::new_game(seed, GameMode::Classic)`, or `new_game_with(seed, mode, calendar, start_unbridged)` |
| Advance time | `sim.tick(dt_minutes)`: any `dt`, split into steps that never skip an hour. Same seed, same commands and the same sequence of `dt` give the same game |
| Quote a placement | `sim.can_build(kind, floor, x)`: `{ ok, reason, cost }`, the dry run `build` makes, with the full price |
| Player commands | `build`, `build_transport`, `sell_at`, `toggle_auto_bridge` (`build.rs`); `add_car`, `remove_car`, `extend_transport`, `remove_facility` (`charges.rs`), which charge or refund and report the money moved; `adjust_rent`, `set_no_rate`, `price_unit`, `apply_rent_batch` (`rent.rs`); `resolve_choice`, `set_film_policy` (`events.rs`) |
| Read state | the public fields (`money`, `star`, `clock`, `tower`, `crowd`, `log`, ...) and `population()`; read them, never write them |
| Gameplay events | `sim.gameplay.drain()` after each frame; `to_json()` on each event; names and payloads are listed in `conformance/events/catalog.json` (`gameplay::CATALOG_JSON`, checked with `check_event`) |
| Reference data | `catalog::catalog(mode)` (or `catalog_json`): prices, sizes, caps and rules per facility kind, versioned by `CATALOG_VERSION` |
| Snapshot hash | `canonical::digest(&scenario::state_view(&sim))`: the hashed view the conformance lock pins |
| Save | `load::encode_simulation_vctower(&sim, app_version, saved_at_ms)`: the `.vctower` bytes the web game writes; `sim.serialize()` for the JSON |
| Load | `load::decode_vctower(text)` then `load::deserialize(&save)` |
| 1994 saves | `import_tdt(bytes, filename)` and `export_tdt(save_json)` |
| Conformance | `scenario::Scenario::parse` and `scenario::run_scenario`, compared with `expected.json`, or `cargo run --bin conformance` from this directory |

Two behaviors a host should know:

- **A save carries the tower, not the moment.** The live crowd and the
  elevator dispatch are not saved, so a loaded game restarts them and does
  not track the game that wrote the save. Two loads of the same save do
  track each other exactly.
- **The loader repairs.** `deserialize` coerces damaged or forged fields
  the way the web game's loader does; it refuses only what it cannot read
  (`decode_vctower` refuses a file that is not a `.vctower`).

## Stability

- **No semver promise yet.** The crate is `0.1.0` and unpublished; a
  consumer pins a commit. Registry releases are #893.
- **The lock is the contract.** Any change to simulation behavior lands
  with a regenerated `conformance/expected.json` in the same pull request,
  and that diff is what a consumer must take on a pin bump. A host that
  replays the lock at its pinned commit runs the same simulation as the web
  game at that commit.
- **Tier 1 above** changes only on purpose, in a pull request that updates
  this page and `consumer/` with it.
- **The conformance harness** (`scenario`, `tdt::referee`, `src/bin/`) is
  tier 2: usable to replay the lock, and expected to move behind a feature.
- **Everything else is internal** (tier 3), even where it is `pub`. Modules
  and fields are public so the port reads side by side with the TypeScript
  engine and so the tests can reach them. Calling a per-phase step
  (`collect_rent`, `pay_maintenance`, `start_fire`, `maybe_random_event`, and
  the like), a raw edit (`set_cars` and `resize_transport` change a shaft
  without charging; they exist to replay another engine's edits) or writing
  a field skips the rules a command applies, and any of them can change in
  any commit.
- **Not covered yet** (stages in #980): the per-frame read model
  (`frame_view`) is only in the WASM binding, the fixtures 15 of the 22
  scenarios start from live in `src/tests/fixtures/`, and the fixed-step
  driver the web host uses is TypeScript (#867).
