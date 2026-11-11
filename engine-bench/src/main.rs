//! `cargo run --release` builds the bench tower, walks one in-game day and
//! prints the report lines. Exits 1 when the tower does not build or the walk
//! does not cross every hour boundary; a slow run never fails.

use std::process::exit;

use verticopolis_engine_bench::{big_tower, walk};

fn main() {
    let report = big_tower().and_then(|mut sim| walk(&mut sim));
    match report {
        Ok(r) => {
            for line in r.lines() {
                println!("{line}");
            }
        }
        Err(e) => {
            eprintln!("bench FAILED: {e}");
            exit(1);
        }
    }
}
