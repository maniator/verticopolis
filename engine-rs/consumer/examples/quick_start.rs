//! The quick start in `engine-rs/CRATE_README.md`, kept compiling: the
//! consumer job's `cargo clippy --all-targets` builds it, and
//! `src/tests/engineCrateReadme.guard.test.ts` keeps the README's block equal
//! to this file below these lines.

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
