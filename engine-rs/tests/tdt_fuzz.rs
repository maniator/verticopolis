//! A seeded fuzz of the `.TDT` codec (#885). The lock in `conformance/` proves the
//! codec on inputs somebody wrote down; this reaches the rest. Each seed takes one
//! of the nine real 1997 saves and damages it (flipped bytes, a hostile cut, a
//! zeroed or `0xFF` run, a duplicated slice), then holds the codec to properties
//! that need no second implementation:
//!
//! 1. import never panics: it returns a tower or a refusal;
//! 2. a tower the importer returns is one the engine loads;
//! 3. a loaded tower exports, and the export imports again;
//! 4. one more round trip changes nothing (the export is a fixed point).
//!
//! The pull-request run uses a small budget. The nightly run (`tdt-fuzz.yml`)
//! raises it. To replay a failure, from `engine-rs/`: `VC_TDT_FUZZ_FIRST=<seed>
//! VC_TDT_FUZZ_SEEDS=1 cargo test --release --test tdt_fuzz`. A failing seed
//! also writes the damaged file to `target/tdt-fuzz/` for local debugging.
//!
//! The damaged bytes derive from a real save, so nothing the original game wrote
//! is committed: the files stay in `target/`. A fix pins a small hand-made case
//! in the conformance lock instead.

use std::path::PathBuf;

use serde_json::Value;
use verticopolis_engine::load::deserialize;
use verticopolis_engine::tdt::{export_tdt, import_tdt};

const SAVES: [&str; 9] = [
    "TOWER1.TDT",
    "TOWER2.TDT",
    "TOWER3.TDT",
    "TOWER4.TDT",
    "TOWER5.TDT",
    "TOWER6.TDT",
    "TOWER7.TDT",
    "TOWER8.TDT",
    "MYTOWER.TDT",
];

/// xorshift64*: small, seeded, and the same everywhere.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

fn env_number(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn fixtures() -> Vec<(&'static str, Vec<u8>)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit");
    SAVES
        .iter()
        .map(|name| (*name, std::fs::read(dir.join(name)).expect("fixture")))
        .collect()
}

/// One damaged copy of `bytes`, and a word for what was done to it.
fn damage(bytes: &[u8], rng: &mut Rng) -> (Vec<u8>, &'static str) {
    let mut out = bytes.to_vec();
    match rng.below(5) {
        0 => {
            for _ in 0..1 + rng.below(8) {
                let at = rng.below(out.len());
                out[at] = rng.next() as u8;
            }
            (out, "flipped bytes")
        }
        1 => {
            out.truncate(rng.below(out.len()));
            (out, "cut short")
        }
        2 => {
            let at = rng.below(out.len());
            let run = (1 + rng.below(4096)).min(out.len() - at);
            out[at..at + run].fill(0);
            (out, "zeroed run")
        }
        3 => {
            let at = rng.below(out.len());
            let run = (1 + rng.below(4096)).min(out.len() - at);
            out[at..at + run].fill(0xff);
            (out, "0xFF run")
        }
        _ => {
            let at = rng.below(out.len());
            let run = (1 + rng.below(2048)).min(out.len() - at);
            let copy = out[at..at + run].to_vec();
            let into = rng.below(out.len());
            out.splice(into..into, copy);
            (out, "duplicated slice")
        }
    }
}

/// The first property the bytes break, or `None`.
fn broken_property(bytes: &[u8], name: &str) -> Option<String> {
    let Ok((json, _)) = import_tdt(bytes, name) else {
        return None; // a refusal is an answer
    };
    let save: Value = match serde_json::from_str(&json) {
        Ok(v) => v,
        Err(e) => return Some(format!("import wrote JSON that does not parse: {e}")),
    };
    if let Err(e) = deserialize(&save) {
        return Some(format!(
            "the engine refuses a tower the importer returned: {e}"
        ));
    }
    let first = match export_tdt(&json) {
        Ok(b) => b,
        Err(e) => {
            return Some(format!(
                "a tower the importer returned does not export: {e}"
            ))
        }
    };
    let Ok((again, _)) = import_tdt(&first, name) else {
        return Some("our own export does not import".to_string());
    };
    let second = match export_tdt(&again) {
        Ok(b) => b,
        Err(e) => return Some(format!("the re-imported tower does not export: {e}")),
    };
    let Ok((third_save, _)) = import_tdt(&second, name) else {
        return Some("our second export does not import".to_string());
    };
    let third = match export_tdt(&third_save) {
        Ok(b) => b,
        Err(e) => return Some(format!("the second re-import does not export: {e}")),
    };
    (second != third).then(|| "export, import and export again is not a fixed point".to_string())
}

#[test]
fn damaged_real_saves_hold_the_codec_properties() {
    let first = env_number("VC_TDT_FUZZ_FIRST", 1);
    let seeds = env_number("VC_TDT_FUZZ_SEEDS", 8);
    let saves = fixtures();
    let mut failures: Vec<String> = vec![];
    for seed in first..first + seeds {
        let mut rng = Rng::new(seed);
        let (name, original) = &saves[rng.below(saves.len())];
        let (bytes, how) = damage(original, &mut rng);
        let ran = std::panic::catch_unwind(|| broken_property(&bytes, name));
        let verdict = match ran {
            Ok(v) => v,
            Err(_) => Some("the codec panicked".to_string()),
        };
        if let Some(why) = verdict {
            let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("tdt-fuzz");
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(dir.join(format!("seed-{seed}.TDT")), &bytes);
            failures.push(format!("seed {seed} ({name}, {how}): {why}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {seeds} seeds broke a property; damaged files are in target/tdt-fuzz/\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// A tower the engine saved, damaged at the JSON: units moved, resized,
/// re-stated or dropped, as a hand-edited or old save would be. The export must
/// answer (a file or a refusal) and what it writes must import.
#[test]
fn forged_towers_export_or_refuse_and_what_they_write_imports() {
    let first = env_number("VC_TDT_FUZZ_FIRST", 1);
    let seeds = env_number("VC_TDT_FUZZ_SEEDS", 8);
    let saves = fixtures();
    let states = [
        "empty",
        "occupied",
        "asleep",
        "dirty",
        "infested",
        "fire",
        "gutted",
        "construction",
        "moving_in",
        "vacating",
    ];
    let mut failures: Vec<String> = vec![];
    for seed in first..first + seeds {
        let mut rng = Rng::new(seed ^ 0xa5a5_a5a5);
        let (name, original) = &saves[rng.below(saves.len())];
        let Ok((json, _)) = import_tdt(original, name) else {
            continue;
        };
        let Ok(mut save) = serde_json::from_str::<Value>(&json) else {
            failures.push(format!(
                "seed {seed} ({name}): the import wrote invalid JSON"
            ));
            continue;
        };
        let Some(units) = save["units"].as_array_mut() else {
            failures.push(format!(
                "seed {seed} ({name}): the import wrote no units list"
            ));
            continue;
        };
        for _ in 0..1 + rng.below(40) {
            if units.is_empty() {
                break;
            }
            let at = rng.below(units.len());
            match rng.below(5) {
                0 => {
                    units.remove(at);
                }
                1 => units[at]["x"] = Value::from(rng.below(420) as i64 - 20),
                2 => units[at]["floor"] = Value::from(rng.below(130) as i64 - 15),
                3 => units[at]["width"] = Value::from(rng.below(40) as i64),
                _ => units[at]["state"] = Value::from(states[rng.below(states.len())]),
            }
        }
        let text = save.to_string();
        let ran = std::panic::catch_unwind(|| match export_tdt(&text) {
            Err(_) => None,
            Ok(bytes) => match import_tdt(&bytes, name) {
                Ok(_) => None,
                Err(e) => Some(format!("what the export wrote does not import: {e}")),
            },
        });
        let verdict = match ran {
            Ok(v) => v,
            Err(_) => Some("the codec panicked".to_string()),
        };
        if let Some(why) = verdict {
            failures.push(format!("seed {seed} ({name}): {why}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {seeds} seeds broke a property\n{}",
        failures.len(),
        failures.join("\n")
    );
}
