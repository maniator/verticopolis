//! Replays every case in `conformance/tdt-cases.json` through the Rust
//! `.TDT` codec and prints one line per case: `ok`, or the first mismatch.
//! Exits 1 unless every case matches, like `bin/conformance.rs`.

use std::path::PathBuf;
use std::process::exit;

use verticopolis_engine::tdt::referee::{read_lock, replay_all};

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("conformance")
        });
    let lock = match read_lock(&root.join("tdt-cases.json")) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("{e}");
            exit(2);
        }
    };
    let repo_root = root.join("..");
    let verdicts = replay_all(&lock, &repo_root);
    let mut failed = 0;
    for (id, verdict) in &verdicts {
        match verdict {
            Ok(()) => println!("{id}: ok"),
            Err(e) => {
                failed += 1;
                println!("{id}: MISMATCH: {e}");
            }
        }
    }
    println!(
        "{} of {} cases ok ({} import, {} export)",
        verdicts.len() - failed,
        verdicts.len(),
        lock.import.len(),
        lock.export.len()
    );
    if failed > 0 {
        exit(1);
    }
}
