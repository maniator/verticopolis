//! Tests for the .vctower writer and its round trips.

use super::{
    decode_vctower, deserialize, detect_founder, encode_simulation_vctower, encode_vctower,
    mark_founder_from_loaded_file, stamp_save, TOWER_FILE_MAGIC,
};
use crate::canonical::digest;
use crate::snapshot::state_view;
use serde_json::{json, Value};

fn text(bytes: &[u8]) -> &str {
    std::str::from_utf8(bytes).expect("a .vctower is ASCII")
}

fn inflate_payload(bytes: &[u8]) -> String {
    use base64::Engine;
    use std::io::Read;
    let s = text(bytes);
    let body = &s[TOWER_FILE_MAGIC.len() + 1..s.len() - 1];
    let packed = base64::engine::general_purpose::STANDARD
        .decode(body)
        .expect("strict standard base64");
    let mut out = String::new();
    flate2::read::DeflateDecoder::new(&packed[..])
        .read_to_string(&mut out)
        .expect("raw deflate of UTF-8");
    out
}

/// Every `.vctower` the web game wrote that the repository keeps, read as
/// an import reads it.
fn web_fixtures() -> Vec<(String, Value)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .expect("fixtures directory")
        .map(|e| e.expect("entry").path())
        .filter(|p| p.extension().is_some_and(|x| x == "vctower"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no .vctower fixtures found in {dir}");
    paths
        .into_iter()
        .map(|p| {
            let raw = std::fs::read_to_string(&p).expect("fixture reads");
            let save = decode_vctower(&raw).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
            (p.display().to_string(), save)
        })
        .collect()
}

/// The framing `SaveGame.export` writes: magic, newline, one line of
/// padded standard base64, newline, and nothing outside ASCII.
#[test]
fn writes_the_typescript_framing() {
    let bytes = encode_vctower(&json!({"version": 7, "units": []})).unwrap();
    let s = text(&bytes);
    assert!(s.starts_with("VCTOWER1\n"), "{s:?}");
    assert!(s.ends_with('\n') && !s.ends_with("\n\n"), "{s:?}");
    assert!(!s.contains('\r') && s.matches('\n').count() == 2, "{s:?}");
    let body = &s["VCTOWER1\n".len()..s.len() - 1];
    assert!(!body.is_empty());
    assert_eq!(body.len() % 4, 0, "padded base64: {body:?}");
    assert!(body
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'='));
}

/// The inflated payload is the save's `JSON.stringify` text. Keys keep
/// their insertion order, as in JavaScript. Integral doubles print as
/// integers, strings escape as JavaScript escapes them, and text outside
/// ASCII is UTF-8 as written.
#[test]
fn payload_is_javascript_json_text() {
    let save = json!({
        "money": 1500000.0,
        "rate": 0.1,
        "towerName": "Caf\u{e9} \"Tower\"\n\u{1F3E2}",
        "big": 1e21,
        "units": [{"x": -0.0, "floor": 1}]
    });
    assert_eq!(
        inflate_payload(&encode_vctower(&save).unwrap()),
        "{\"money\":1500000,\"rate\":0.1,\"towerName\":\"Caf\u{e9} \\\"Tower\\\"\\n\u{1F3E2}\",\"big\":1e+21,\"units\":[{\"x\":0,\"floor\":1}]}"
    );
}

/// Encoding then decoding gives back the save, for shapes beyond a
/// tower too (the container does not look inside).
#[test]
fn round_trips_through_the_decoder() {
    for save in [
        json!({}),
        json!({"version": 7, "units": [], "minutes": 0}),
        json!({"towerName": "\u{feff}lead\u{2028}sep\u{0}nul", "nested": {"a": [1, 2.5, null, true]}}),
        json!([1, "two", {"three": 3}]),
        json!("a bare string"),
    ] {
        let bytes = encode_vctower(&save).unwrap();
        assert_eq!(decode_vctower(text(&bytes)).unwrap(), save, "{save}");
    }
}

/// The same save always encodes to the same bytes.
#[test]
fn encoding_is_deterministic() {
    let save = json!({"b": 2, "a": [1, 2, 3], "towerName": "x"});
    assert_eq!(
        encode_vctower(&save).unwrap(),
        encode_vctower(&save).unwrap()
    );
}

/// A file the web game wrote decodes, re-encodes and decodes to the same
/// save, and a second re-encode is the same bytes as the first.
#[test]
fn web_written_files_survive_a_rewrite() {
    for (name, save) in web_fixtures() {
        let once = encode_vctower(&save).unwrap();
        let back = decode_vctower(text(&once)).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(
            back, save,
            "{name}: the save changed through the engine's writer"
        );
        assert_eq!(
            encode_vctower(&back).unwrap(),
            once,
            "{name}: re-encoding is not stable"
        );
    }
}

/// A tower written from a running simulation loads back to the same
/// hashed state, carries the host's stamp, and does not pick up Founder
/// status the way an unstamped save would.
#[test]
fn simulation_export_loads_back_to_the_same_state() {
    for (name, save) in web_fixtures() {
        let mut sim = deserialize(&save).unwrap_or_else(|e| panic!("{name}: {e}"));
        mark_founder_from_loaded_file(&mut sim, &save);
        let before = digest(&state_view(&sim));
        let bytes = encode_simulation_vctower(&sim, "9.9.9", 1_750_000_000_123.0)
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let raw = decode_vctower(text(&bytes)).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(raw["appVersion"], json!("9.9.9"), "{name}");
        assert_eq!(raw["savedAt"], json!(1_750_000_000_123u64), "{name}");
        let mut again = deserialize(&raw).unwrap_or_else(|e| panic!("{name}: {e}"));
        mark_founder_from_loaded_file(&mut again, &raw);
        assert_eq!(again.founder, sim.founder, "{name}: Founder status moved");
        assert_eq!(digest(&state_view(&again)), before, "{name}: state moved");
    }
}

/// A fresh game is no founder's tower, and its stamped export keeps it so.
#[test]
fn stamped_export_of_a_new_game_is_not_a_founder() {
    let save = json!({"version": 7, "units": [], "minutes": 0, "money": 1});
    let sim = deserialize(&save).unwrap();
    assert!(!sim.founder);
    for version in ["2.0.0", "3.1.4", "dev", ""] {
        let bytes = encode_simulation_vctower(&sim, version, 0.0).unwrap();
        let raw = decode_vctower(text(&bytes)).unwrap();
        assert!(!detect_founder(&raw), "{version:?}");
        let mut back = deserialize(&raw).unwrap();
        mark_founder_from_loaded_file(&mut back, &raw);
        assert!(!back.founder, "{version:?}");
    }
}

/// The stamp refuses what would load wrong: a build name the web game
/// reads as before 2.0 (a founder's tower), a time no `Date` holds, and
/// a save the web import would refuse as no tower.
#[test]
fn the_stamp_refuses_what_would_load_wrong() {
    let tower = || json!({"version": 7, "units": [], "minutes": 0});
    for version in ["1.9.0", "0.1", " 1", "\u{feff}1.100.0", "-3"] {
        assert!(
            stamp_save(&mut tower(), version, 0.0).is_err(),
            "{version:?}"
        );
    }
    for at in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 8.64e15 + 1.0] {
        assert!(stamp_save(&mut tower(), "3.0.0", at).is_err(), "{at}");
    }
    for not_tower in [
        json!(null),
        json!([]),
        json!({}),
        json!({"minutes": "0", "units": []}),
        json!({"minutes": 0, "units": {}}),
    ] {
        let mut v = not_tower.clone();
        assert!(stamp_save(&mut v, "3.0.0", 0.0).is_err(), "{not_tower}");
        assert_eq!(v, not_tower, "a refused stamp leaves the save alone");
    }
    let mut ok = tower();
    stamp_save(&mut ok, "3.0.0", -8.64e15).unwrap();
    assert_eq!(ok["appVersion"], json!("3.0.0"));
    assert!(ok.get("founder").is_none(), "no founder status to carry");
}

/// A save still holding a stamp that reads as a founder's keeps that
/// status through the new stamp, so a re-stamp cannot burn the badge.
#[test]
fn the_stamp_carries_an_older_founder_stamp() {
    for old in ["1.100.0", "0.9", " 1"] {
        let mut save = json!({"version": 7, "units": [], "minutes": 0, "appVersion": old});
        stamp_save(&mut save, "3.0.0", 0.0).unwrap();
        assert_eq!(save["founder"], json!(true), "{old:?}");
        let raw = decode_vctower(text(&encode_vctower(&save).unwrap())).unwrap();
        assert!(detect_founder(&raw), "{old:?}");
        let mut sim = deserialize(&raw).unwrap();
        mark_founder_from_loaded_file(&mut sim, &raw);
        assert!(sim.founder, "{old:?}");
    }
    let mut later = json!({"version": 7, "units": [], "minutes": 0, "appVersion": "2.4.0"});
    stamp_save(&mut later, "3.0.0", 0.0).unwrap();
    assert!(later.get("founder").is_none());
}
