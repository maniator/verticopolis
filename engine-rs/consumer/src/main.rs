//! `cargo run` prints one smoke run and replays the new-game scenarios of
//! the conformance suite. The suite's directory is the first argument, or
//! `../../conformance` from this crate. Exits 1 on any failure.

use std::path::PathBuf;
use std::process::exit;

use verticopolis_engine_consumer::{replay, smoke, SEED};

fn main() {
    let conformance = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance"));
    let mut ok = true;
    match smoke(SEED) {
        Ok(r) => println!(
            "smoke ok: spent {} (quoted {}), day {}, population {}, money {}, {} events, save {} bytes, state {}",
            r.spent, r.quoted, r.day, r.population, r.money, r.events, r.save_bytes, r.state
        ),
        Err(e) => {
            println!("smoke FAILED: {e}");
            ok = false;
        }
    }
    for id in ["starter-classic", "starter-modern"] {
        match replay(&conformance, id) {
            Ok(n) => println!("{id}: ok ({n} checkpoints)"),
            Err(e) => {
                println!("{id}: FAILED: {e}");
                ok = false;
            }
        }
    }
    if !ok {
        exit(1);
    }
}
