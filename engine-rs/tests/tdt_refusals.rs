//! What the codec refuses, what it reads around, and the small helpers under
//! it: cut-off and damaged files never panic, a file that stops early still
//! brings its floors over with a rebuilt transport layout, and the byte reader
//! and writer say exactly where they stopped.

use std::path::PathBuf;

use serde_json::Value;
use verticopolis_engine::tdt::byte_reader::ByteReader;
use verticopolis_engine::tdt::byte_writer::ByteWriter;
use verticopolis_engine::tdt::pacing::pace_factor;
use verticopolis_engine::tdt::{export_tdt, import_tdt, LegacyExportError, LegacyImportError};

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit")
        .join(name);
    std::fs::read(path).expect("fixture")
}

fn refusal(bytes: &[u8]) -> String {
    import_tdt(bytes, "X.TDT")
        .expect_err("the file is refused")
        .to_string()
}

#[test]
fn a_file_too_small_to_hold_the_header_is_refused() {
    let bytes = fixture("TOWER2.TDT");
    for cut in [0, 1, 100, 559] {
        assert_eq!(
            refusal(&bytes[..cut]),
            "This file is too small to be a SimTower save.",
            "cut at {cut}"
        );
    }
}

#[test]
fn a_file_with_the_wrong_magic_is_refused() {
    let mut bytes = fixture("TOWER2.TDT");
    bytes[0] = 1;
    assert_eq!(
        refusal(&bytes),
        "This file doesn't look like a SimTower save."
    );
}

#[test]
fn a_file_cut_inside_the_floor_map_says_where() {
    let bytes = fixture("TOWER2.TDT");
    assert!(refusal(&bytes[..560]).contains("floor map (floor record 0)"));
    assert!(refusal(&bytes[..20_000]).contains("floor map"));
}

#[test]
fn a_file_cut_after_the_floor_map_keeps_its_rooms_and_rebuilds_the_transport() {
    let bytes = fixture("TOWER2.TDT");
    let full: Value =
        serde_json::from_str(&import_tdt(&bytes, "X.TDT").expect("imports").0).expect("json");
    let (json, _) = import_tdt(&bytes[..100_000], "X.TDT").expect("imports without its tail");
    let cut: Value = serde_json::from_str(&json).expect("json");
    assert_eq!(cut["units"], full["units"], "the floors are all there");
    let rebuilt = cut["transports"].as_array().expect("transports");
    assert!(!rebuilt.is_empty(), "a working layout was rebuilt");
    assert!(rebuilt.iter().any(|t| t["kind"] == "elevatorStandard"));
    assert!(rebuilt.iter().any(|t| t["kind"] == "elevatorExpress"));
}

#[test]
fn a_file_cut_anywhere_never_panics() {
    for name in ["TOWER1.TDT", "TOWER5.TDT", "TOWER8.TDT"] {
        let bytes = fixture(name);
        let step = (bytes.len() / 400).max(1);
        for cut in (0..=bytes.len()).step_by(step) {
            let _ = import_tdt(&bytes[..cut], name);
        }
    }
}

#[test]
fn a_file_with_damaged_bytes_never_panics() {
    // A fixed pseudo-random walk, so a failure names the same bytes every run.
    let mut state: u64 = 0x2545_f491_4f6c_dd1d;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for name in ["TOWER1.TDT", "TOWER5.TDT"] {
        let original = fixture(name);
        for round in 0..150 {
            let mut bytes = original.clone();
            for _ in 0..(1 + round % 6) {
                let at = (next() as usize) % bytes.len();
                bytes[at] = next() as u8;
            }
            let _ = import_tdt(&bytes, name);
        }
    }
}

#[test]
fn an_export_of_something_that_is_not_a_save_is_refused() {
    let refused = export_tdt("not json").expect_err("refused");
    assert!(!refused.is_empty());
}

#[test]
fn both_errors_print_their_message() {
    assert_eq!(LegacyImportError("no".into()).to_string(), "no");
    assert_eq!(LegacyExportError("nope".into()).to_string(), "nope");
}

#[test]
fn the_reader_stops_where_the_file_ends() {
    let mut reader = ByteReader::new(&[1, 2, 3]);
    reader.enter_block("people block");
    assert_eq!(reader.u8().expect("one byte"), 1);
    reader.seek(3).expect("the end is a valid place to stand");
    let past = reader.seek(4).expect_err("past the end is refused");
    assert_eq!(
        past.to_string(),
        "This SimTower save is cut short. The file ends in the middle of its people block."
    );
    reader.seek(0).expect("back to the start");
    assert_eq!(reader.offset(), 0);
}

#[test]
fn the_writer_patches_what_it_wrote_and_refuses_to_patch_beyond_it() {
    let mut writer = ByteWriter::new();
    assert!(writer.is_empty());
    writer.u16(0);
    writer.u16(0x1234);
    assert_eq!(writer.len(), 4);
    writer.set_u16(0, 0xabcd);
    assert_eq!(writer.to_bytes(), vec![0xcd, 0xab, 0x34, 0x12]);
}

#[test]
#[should_panic(expected = "out of range")]
fn the_writer_does_not_patch_past_its_end() {
    let mut writer = ByteWriter::new();
    writer.u16(0);
    writer.set_u16(1, 7);
}

#[test]
fn pacing_is_neutral_without_a_minute_and_faster_where_frames_are_long() {
    assert_eq!(pace_factor(f64::NAN), 1.0);
    assert_eq!(pace_factor(f64::INFINITY), 1.0);
    for minute in [0.0, 420.0, 900.0, 1300.0, 1439.0] {
        let rate = pace_factor(minute);
        assert!(rate.is_finite() && rate > 0.0, "minute {minute}: {rate}");
    }
}
