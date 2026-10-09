//! The committed fixtures are exactly what the test kit builds, and the
//! native reader reports exactly `expected.json` for them. The WASM suite
//! (`src/tests/integration/discWasm.integration.test.ts`) checks the same
//! file against the module, so both hosts are held to one expectation.
#![cfg(feature = "testkit")]

use std::path::Path;

use serde_json::Value;
use sha2::{Digest, Sha256};
use verticopolis_disc::source::Bytes;
use verticopolis_disc::testkit::{synthetic_disc, synthetic_disc_parts};
use verticopolis_disc::{Disc, Limits};

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(name),
    )
    .expect("fixture exists")
}

#[test]
fn the_committed_image_is_exactly_what_the_test_kit_builds() {
    assert!(
        fixture("synthetic-disc.iso.bin") == synthetic_disc(),
        "fixtures/synthetic-disc.iso.bin drifted; regenerate with cargo run --features testkit --bin disc-fixtures"
    );
}

#[test]
fn the_native_reader_reports_the_committed_expectation() {
    let image = fixture("synthetic-disc.iso.bin");
    let want: Value = serde_json::from_slice(&fixture("expected.json")).unwrap();
    let mut disc = Disc::open(Bytes(&image), Limits::default()).unwrap();
    let opened = serde_json::to_value(disc.opened()).unwrap();
    assert_eq!(opened, want["opened"]);
    for (i, read) in want["reads"].as_array().unwrap().iter().enumerate() {
        let got = match disc.read(i as u32) {
            Ok((info, _)) => serde_json::to_value(info).unwrap(),
            Err(r) => {
                serde_json::json!({ "refusal": r.to_value() })
            }
        };
        assert_eq!(&got, read, "entry {i}");
    }
    for stored in want["stored"].as_array().unwrap() {
        let token = stored["token"].as_u64().unwrap() as u32;
        let got = match disc.read_stored(token) {
            Ok(bytes) => {
                let hex: String = Sha256::digest(&bytes)
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect();
                serde_json::json!({ "token": token, "sha256": hex })
            }
            Err(r) => serde_json::json!({ "token": token, "refusal": r.to_value() }),
        };
        assert_eq!(&got, stored, "stored {token}");
    }
}

/// The decoder's reads match what the test kit put in, independently of
/// `expected.json` (which the decoder itself produced).
#[test]
fn every_read_matches_the_plaintext_the_test_kit_encoded() {
    let (image, plain) = synthetic_disc_parts();
    let mut disc = Disc::open(Bytes(&image), Limits::default()).unwrap();
    let entries = disc.opened().entries;
    for (path, want) in plain {
        let entry = entries.iter().find(|e| e.path == path).expect("listed");
        let (info, bytes) = disc.read(entry.token).unwrap();
        assert_eq!(bytes, want, "{path}");
        let hex: String = Sha256::digest(&want)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(info.sha256, hex, "{path}");
    }
}
