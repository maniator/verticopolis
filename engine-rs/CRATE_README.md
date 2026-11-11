# verticopolis-engine

The simulation engine of [Verticopolis](https://verticopolis.com), a tower
building game inspired by SimTower (1994). This crate is the whole
simulation: every rule, price, build cap, command, save format and gameplay
event. It is the same engine the web game runs, compiled to WebAssembly
there and linked as a plain Rust library here.

Your code owns everything a player sees and hears (rendering, audio, UI,
input). The engine owns what happens in the tower. Frontends may differ;
simulations may not, and the conformance suite is how a host proves it runs
the real one.

- [Status](#status)
- [Add it](#add-it)
- [Quick start](#quick-start)
- [How the engine works](#how-the-engine-works)
- [The host API](#the-host-api)
- [Features](#features)
- [Saves](#saves)
- [Proving conformance](#proving-conformance)
- [Versioning and stability](#versioning-and-stability)
- [The JavaScript package](#the-javascript-package)
- [License](#license)

## Status

The crate is not on crates.io yet. It compiles the gameplay event catalog
in from `conformance/` beside `engine-rs/` in the repository, so it builds
from a checkout of the whole repository and cannot be packaged on its own
until that moves
([#893](https://github.com/maniator/verticopolis/issues/893)). Until then,
depend on it by git tag or commit, as below. This README is the one a
registry release will show.

## Add it

Each engine release is tagged `engine-v<version>`:

```toml
[dependencies]
verticopolis-engine = { git = "https://github.com/maniator/verticopolis", tag = "engine-v1.24.0" }
```

Or pin a commit with `rev = "<sha>"`. The crate needs the Rust release named
by `rust-version` in its `Cargo.toml` (1.97 today) and nothing else: no
Node.js, no build script, no system library.

## Quick start

```rust
use verticopolis_engine::clock::GameMode;
use verticopolis_engine::facilities::Kind;
use verticopolis_engine::load::{
    decode_vctower, deserialize, encode_simulation_vctower, mark_founder_from_loaded_file,
};
use verticopolis_engine::sim::Simulation;

fn main() -> Result<(), String> {
    // A new Classic game from seed 42.
    let mut sim = Simulation::new_game(42, GameMode::Classic);

    // A lobby on the ground floor (floor 1), one tile per call.
    for x in 100..124 {
        sim.build(Kind::Lobby, 1, x);
    }

    // Quote an office before placing it: the same dry run `build` makes,
    // with the full price.
    let quote = sim.can_build(Kind::Office, 2, 106);
    println!("ok {} cost {}", quote.ok, quote.cost);
    let placed = sim.build(Kind::Office, 2, 106);
    if !placed.ok {
        return Err(placed.reason.unwrap_or_default());
    }

    // One game day, a minute at a time, draining the gameplay events.
    for _ in 0..24 * 60 {
        sim.tick(1.0);
        for event in sim.gameplay.drain() {
            println!("{}", event.to_json());
        }
    }
    println!("population {} money {}", sim.population(), sim.money);

    // Save as a .vctower file the web game can open, then load it back.
    let bytes = encode_simulation_vctower(&sim, "my-host 1.0.0", 1_791_849_600_000.0)?;
    let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
    let save = decode_vctower(&text)?;
    let mut loaded = deserialize(&save)?;
    mark_founder_from_loaded_file(&mut loaded, &save);
    Ok(())
}
```

A fuller host, which every CI run builds and runs from outside the engine,
is [`engine-rs/consumer/`](https://github.com/maniator/verticopolis/tree/main/engine-rs/consumer).

## How the engine works

- **One `Simulation` is one game.** Start one with `Simulation::new_game`
  (or `new_game_with` for the calendar and bridging options), or load one
  from a save.
- **Commands answer instead of panicking.** A command a player could make
  returns a result with `ok` and, when it is refused, a `reason` sentence you
  can show the player. Commands that move money report the amount.
- **The engine does no I/O.** It reads no file, clock, environment, console
  or network, and spawns no thread or process. You pass in time (`tick`),
  file contents and timestamps, and you get bytes back to store wherever you
  like. A test in the repository holds the library to this.
- **It is deterministic.** The same seed, the same commands and the same
  sequence of `tick` calls give the same game on any machine, in this crate
  and in the WebAssembly build.
- **Coordinates.** `floor` counts up from the ground floor, which is `1`;
  `0` and below are basements. `x` is a tile column from `0` across the
  lot. The catalog's world record carries the exact bounds.
- **Modes.** `GameMode::Classic` follows the 1994 original;
  `GameMode::Modern` adds facilities and rules the original did not have.

## The host API

These are the calls a frontend makes, in short. The repository's
[`engine-rs/API.md`](https://github.com/maniator/verticopolis/blob/main/engine-rs/API.md)
gives each one in full; a test there names each of its calls, so a rename
fails CI until that page and the example host follow.

| Need | Call |
| --- | --- |
| Start a game | `sim::Simulation::new_game(seed, mode)`, `new_game_with(seed, mode, calendar, start_unbridged)` |
| Advance time | `sim.tick(dt_minutes)`, or `fixed_step::FrameStepper::advance` to pace time from frames the way the web game does |
| Quote a placement | `sim.can_build(kind, floor, x)`, `sim.can_build_transport(kind, x, bottom, top)` |
| Player commands | `build`, `build_transport`, `sell_at`, `paint_brush`, `add_car`, `remove_car`, `extend_transport`, `remove_facility`, `adjust_rent`, `set_no_rate`, `price_unit`, `resolve_choice` |
| Read state | the public fields (`money`, `star`, `clock`, `tower`, `log`) and `population()`; read them, never write them |
| Draw a frame | `view::structure_view(&sim)` and `view::ViewReader::frame`, or `frame::frame_view(&sim)`, flat number arrays read through the named slots in `view::layout` and `frame` |
| Gameplay events | `sim.gameplay.drain()` after each frame; the names and payloads are in `gameplay::CATALOG_JSON` |
| Reference data | `catalog::catalog(mode)`: every price, size, cap and rule a frontend shows |
| Identity | `identity::identity()`: the crate version and the save, layout, catalog and conformance versions it speaks |
| State hash | `canonical::digest(&snapshot::state_view(&sim))` |
| Saves | `load::encode_simulation_vctower`, `load::decode_vctower`, `load::deserialize`, `import_tdt`, `export_tdt` |

Read rules, prices and caps from the catalog rather than copying them into
your code. Many other items are `pub` so the tests can reach them; they are
internal and can change in any release. Calling a per-phase step or writing
a field directly skips the rules a command applies.

## Features

The crate has no default features.

| Feature | What it adds |
| --- | --- |
| `conformance` | The harness that replays the conformance suite (`scenario`, `suite`, the `.TDT` referee) and the command-line tools. It reads the suite's files, so a host turns it on only to prove conformance. |
| `wasm` | The JavaScript binding, for a `wasm32-unknown-unknown` build through wasm-bindgen. A native host leaves it off. |

## Saves

- **`.vctower`** is the native save format, the file the web game imports
  and exports. `encode_simulation_vctower(&sim, app_version, saved_at_ms)`
  writes the same bytes the web game writes for the same game. The engine
  has no clock and no build name, so you pass both.
- **Loading** is `decode_vctower`, then `deserialize`, then
  `mark_founder_from_loaded_file`, which keeps the status the web game gives
  a tower saved before build stamps existed.
- **`.TDT`** is the 1994 SimTower format: `import_tdt(bytes, filename)` reads
  one and `export_tdt(save_json)` writes one.
- **A save holds the tower, not the moment.** The people in the building and
  the elevator cars restart on load, so a loaded game does not carry on
  exactly where the saving game was. Two loads of the same save stay
  identical to each other.
- **The loader repairs.** A damaged or hand-edited save is coerced the way
  the web game's loader does; only a file it cannot read is refused, and so
  is a save from a newer engine.

## Proving conformance

The repository's
[`conformance/`](https://github.com/maniator/verticopolis/tree/main/conformance)
directory is a suite of scripted games with the state hash pinned at each
checkpoint (`expected.json`). An engine at a given version replays every
scenario exactly. With the `conformance` feature a host replays it itself:

```toml
verticopolis-engine = { git = "https://github.com/maniator/verticopolis", tag = "engine-v1.24.0", features = ["conformance"] }
```

`scenario::Scenario::parse` and `scenario::run_scenario(&scenario, suite)`
replay one scenario against a copy of the suite, which is what
`engine-rs/consumer/` does for every scenario on every CI run.

## Versioning and stability

- **The crate version moves with the engine's contract:** the conformance
  lock (simulation behavior), the save version, the frame and view layouts,
  the catalog, the identity record and the JavaScript binding's declarations.
  A change that keeps all of these, such as a speed-up, does not raise it on
  its own.
- **No semver promise yet.** Until the compatibility policy is written
  ([#893](https://github.com/maniator/verticopolis/issues/893)), a minor
  version can change a call's shape or the game's behavior. Pin an exact
  tag and read the
  [changelog](https://github.com/maniator/verticopolis/blob/main/engine-rs/CHANGELOG.md)
  before you move.
- **The lock is the contract.** Every change to simulation behavior lands
  with an updated `conformance/expected.json`, and that diff is what you take
  on when you move your pin.
- **The host API above changes only on purpose,** with a changelog line.

## The JavaScript package

Each engine release also publishes this crate's WebAssembly build as the
npm package `@maniator/verticopolis-engine` on GitHub Packages, with builds
for Node and the browser. Its
[README](https://github.com/maniator/verticopolis/blob/main/packages/verticopolis-engine/README.md)
covers installing and calling it from JavaScript.

## License

MIT. The crates the engine depends on are listed in its `Cargo.toml`.
