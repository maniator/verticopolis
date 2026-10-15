//! `cargo run` prints one smoke run and replays every scenario of the
//! conformance suite, those that start from a save fixture included. The
//! suite's directory is the first argument; without one it is
//! `../../conformance` from this crate's source directory, a path fixed at
//! build time, so pass it when the binary runs anywhere else. Exits 1 on any
//! failure.

use std::path::PathBuf;
use std::process::exit;

use verticopolis_engine_consumer::{replay, scenarios, smoke, SEED};

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
            eprintln!("smoke FAILED: {e}");
            ok = false;
        }
    }
    let ids = match scenarios(&conformance) {
        Ok(ids) if !ids.is_empty() => ids,
        Ok(_) => {
            eprintln!("no scenario in {}", conformance.display());
            exit(1);
        }
        Err(e) => {
            eprintln!("{e}");
            exit(1);
        }
    };
    for id in ids {
        match replay(&conformance, &id) {
            Ok(n) => println!("{id}: ok ({n} checkpoints)"),
            Err(e) => {
                eprintln!("{id}: FAILED: {e}");
                ok = false;
            }
        }
    }
    if !ok {
        exit(1);
    }
}
