//! Writes the committed synthetic fixtures: the disc image and the result
//! every host must produce from it (`fixtures/expected.json`). Run it after
//! a deliberate change to the test kit or the result shape:
//! `cargo run --features testkit --bin disc-fixtures`.
use std::path::Path;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use verticopolis_disc::source::Bytes;
use verticopolis_disc::testkit::synthetic_disc;
use verticopolis_disc::{Disc, Limits};

/// What every host must report for the synthetic disc: the listing, then
/// for each entry its read result or its refusal.
pub fn expected(image: &[u8]) -> Value {
    let mut disc = Disc::open(Bytes(image), Limits::default()).expect("the synthetic disc opens");
    let opened = disc.opened();
    let reads: Vec<Value> = opened
        .entries
        .iter()
        .map(|e| match disc.read(e.token) {
            Ok((info, _)) => serde_json::to_value(info).expect("serializes"),
            Err(r) => json!({ "refusal": r.to_value() }),
        })
        .collect();
    // The bytes as stored, by hash: `readStored` must agree on every host.
    let stored: Vec<Value> = opened
        .entries
        .iter()
        .map(|e| match disc.read_stored(e.token) {
            Ok(bytes) => json!({ "token": e.token, "sha256": hex(&Sha256::digest(&bytes)) }),
            Err(r) => json!({ "token": e.token, "refusal": r.to_value() }),
        })
        .collect();
    json!({ "opened": opened, "reads": reads, "stored": stored })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures");
    let image = synthetic_disc();
    std::fs::write(dir.join("synthetic-disc.iso.bin"), &image).expect("writes the image");
    let text = serde_json::to_string_pretty(&expected(&image)).expect("serializes") + "\n";
    std::fs::write(dir.join("expected.json"), text).expect("writes the expectation");
    println!(
        "fixtures/: wrote synthetic-disc.iso.bin ({} bytes) and expected.json",
        image.len()
    );
}
