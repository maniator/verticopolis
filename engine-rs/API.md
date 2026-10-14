# Using the engine from another frontend

`verticopolis-engine` is the whole simulation: rules, commands, state,
saves and gameplay events. A frontend owns everything a player sees and
hears (rendering, audio, UI, input, presentation) and drives the engine
through the calls below. Frontends may differ. Simulations may not: a host
proves it runs the real simulation by replaying the conformance suite
(`../conformance/`).

`consumer/` is a working example and the CI gate for this page: a crate
outside the engine that depends on it by path and makes every tier 1 call
below. The `consumer` job in `.github/workflows/engine-rs.yml` runs in the
official Rust container image, which has no Node.js, from a checkout
holding only `engine-rs/` and `conformance/`. It copies `consumer/` out of
the checkout and builds, tests and runs the copy there, depending on the
engine by an absolute path. The plan this page belongs to is issue #980.

What that proves today: the engine builds and runs with no web game and no
Node.js, and a crate in another directory, reaching this repository only
through its dependency line and the conformance directory it is given, can
drive it and replay the conformance
scenarios that start from a new game. What it does not prove yet: a
registry or packaged release (the crate reads `../conformance/` at compile
time, so it needs the repository beside it; #893), or the scenarios that
start from a save fixture, which still live in `src/tests/fixtures/`
(stage 3 of #980).

## Depending on the engine

One of these two:

```toml
[dependencies]
# From a checkout of this repository:
verticopolis-engine = { path = "../verticopolis/engine-rs" }
```

```toml
[dependencies]
# Pinned to a commit:
verticopolis-engine = { git = "https://github.com/maniator/verticopolis", rev = "<sha>" }
```

Default features only. The `wasm` feature is the JavaScript binding
(`src/wasm.rs`) and a native host leaves it off. The build needs the Rust
toolchain in `Cargo.toml` (`rust-version`) and the `engine-rs/` and
`conformance/` directories (the event catalog is compiled in from there).
It needs no Node.js, no npm and nothing else from the web game. Because the
crate reads `../conformance/` at compile time, it builds from a checkout of
the whole repository (which a path or git dependency gives you) and cannot
be packaged on its own yet (#893).

A game does no IO. The simulation reads no file, clock, environment,
console or network, and spawns no thread or process; the host passes in
bytes, time and its build name. The one exception is a short list of
conformance harness functions in `scenario.rs` and `tdt/referee.rs`, which
read the scenario and fixture files they are pointed at and are never
reached from a running game. The rest of both files, `state_view` included,
is checked like any other library code.
`tests/independence.rs` scans the library source for those services (by
path, grouped import, macro and foreign-function block), refuses a build
script for the engine itself, data (`include_str!`, `include_bytes!`) from
outside `engine-rs/` and `conformance/`, and code (`include!`, `#[path]`)
from anything but a `.rs` file under `src/` outside `src/bin/`, and fails
when the engine's or the consumer's `Cargo.lock` names
a crate nobody reviewed for host access. It reads source text, so it
catches the ordinary spellings; review still owns the rest.

## The host API

These are the calls a frontend makes (tier 1 in #980). `consumer/` calls
each of them, so a rename or a removal fails CI until this page and the
consumer follow. The last row is tier 2, the harness a host uses to prove
conformance.

| Need | Call |
| --- | --- |
| Start a game | `sim::Simulation::new_game(seed, GameMode::Classic)`, or `new_game_with(seed, mode, calendar, start_unbridged)` |
| Advance time | `sim.tick(dt_minutes)`: any `dt`, split into steps that never skip an hour. Same seed, same commands and the same sequence of `dt` give the same game |
| Quote a placement | `sim.can_build(kind, floor, x)`: `{ ok, reason, cost }`, the dry run `build` makes, with the full price. There is no quote call for a transport yet: an elevator costs the catalog `cost` plus `transportFloorCost` for each floor past its first, and stairs and escalators cost the catalog `cost` |
| Player commands | `build`, `build_transport`, `sell_at`, `toggle_auto_bridge` (`build.rs`); `add_car`, `remove_car`, `extend_transport`, `remove_facility` (`charges.rs`), which charge or refund and report the money moved; `adjust_rent`, `set_no_rate`, `price_unit`, `apply_rent_batch` (`rent.rs`); `resolve_choice`, `set_film_policy` (`events.rs`) |
| Read state | the public fields (`money`, `star`, `clock`, `tower`, `crowd`, `log`, ...) and `population()`; read them, never write them |
| Gameplay events | `sim.gameplay.drain()` after each frame; `to_json()` on each event; names and payloads are listed in `conformance/events/catalog.json` (`gameplay::CATALOG_JSON`, checked with `check_event`). The buffer holds `GAMEPLAY_RING_CAP` events and counts any it had to drop in `sim.gameplay.dropped` |
| Reference data | `catalog::catalog(mode)`: prices, sizes, caps and rules per facility kind, versioned by `CATALOG_VERSION` |
| Snapshot hash | `canonical::digest(&scenario::state_view(&sim))`: the hashed view the conformance lock pins. `state_view` is tier 1 although it lives in the harness module until stage 2 of #980 moves it |
| Save | `load::encode_simulation_vctower(&sim, app_version, saved_at_ms)`: the `.vctower` bytes the web game writes. A host that holds the save JSON (`sim.serialize()`) gets the same file from `load::stamp_save(&mut save, app_version, saved_at_ms)` then `load::encode_vctower(&save)` |
| Load | `load::decode_vctower(text)`, then `load::deserialize(&save)`, then `load::mark_founder_from_loaded_file(&mut sim, &save)`, which marks a file with no build stamp as a founder's tower the way the web game does (skip it and a host drops that status on its next save) |
| 1994 saves | `import_tdt(bytes, filename)` and `export_tdt(save_json)` |
| Conformance (tier 2) | `scenario::Scenario::parse` and `scenario::run_scenario`, compared with `expected.json` (as `consumer/` does for every scenario that starts from a new game), or `cargo run --bin conformance` from this directory for the whole suite |

Two behaviors a host should know:

- **A save holds the tower and leaves out the live crowd and the elevator
  dispatch.** A loaded game restarts both, so it does not track the game
  that wrote the save. Two loads of the same save do track each other
  exactly.
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
- **The conformance harness** (`scenario`, apart from `state_view`,
  `tdt::referee` and `src/bin/`) is tier 2: usable to replay the lock, and
  expected to move behind a feature.
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
  driver the web host uses is TypeScript (#867). There is no quote call for
  a transport's price.
