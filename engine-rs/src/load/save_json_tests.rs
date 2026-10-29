//! Tests for reading save text and the inflate cap.

use super::{decode_vctower, encode_vctower, parse_save_json};
use serde_json::{json, Value};

fn parse(text: &str) -> Value {
    parse_save_json(text.as_bytes()).unwrap_or_else(|e| panic!("{text}: {e}"))
}

/// A lone surrogate escape, as `JSON.stringify` writes one, reads as
/// U+FFFD in place; a paired one reads as the character it spells.
#[test]
fn lone_surrogates_become_replacement_characters() {
    let cases = [
        (r#"{"towerName":"Tower \ud83c"}"#, "Tower \u{FFFD}"),
        (r#"{"towerName":"\udfe2 Tower"}"#, "\u{FFFD} Tower"),
        (r#"{"towerName":"\uD83C\uDFE2"}"#, "\u{1F3E2}"),
        (r#"{"towerName":"\ud83c\ud83c\udfe2"}"#, "\u{FFFD}\u{1F3E2}"),
        (r#"{"towerName":"\ud83c\u0041"}"#, "\u{FFFD}A"),
        (r#"{"towerName":"\uD83C"}"#, "\u{FFFD}"),
        (r#"{"towerName":"\ud83c\n"}"#, "\u{FFFD}\n"),
        (r#"{"towerName":"\udfe2\ud83c"}"#, "\u{FFFD}\u{FFFD}"),
        (r#"{"towerName":"a\"\ud83c\\"}"#, "a\"\u{FFFD}\\"),
    ];
    for (text, want) in cases {
        assert_eq!(parse(text)["towerName"], json!(want), "{text}");
    }
}

/// Keys are strings too, and nested values are reached.
#[test]
fn keys_and_nested_strings_are_repaired() {
    let v = parse(r#"{"k\ud800":[{"label":"x\udc00"}]}"#);
    assert_eq!(v, json!({"k\u{FFFD}": [{"label": "x\u{FFFD}"}]}));
}

/// An escaped backslash followed by a literal `u` stays text.
#[test]
fn an_escaped_backslash_is_not_an_escape() {
    assert_eq!(parse(r#"{"a":"\\ud83c"}"#)["a"], json!("\\ud83c"));
    assert_eq!(parse(r#"{"a":"\\\ud83c"}"#)["a"], json!("\\\u{FFFD}"));
}

/// Text with no lone surrogate parses exactly as serde_json parses it,
/// and broken JSON is still refused.
#[test]
fn everything_else_is_left_to_the_parser() {
    let text = r#"{"money":1.5e3,"n":"\u00e9\n\t\"","u":[1,null,true]}"#;
    assert_eq!(parse(text), serde_json::from_str::<Value>(text).unwrap());
    for bad in [
        r#"{"a":"\u12"}"#,
        r#"{"a":"\ud83c"#,
        r#"{"a":"\uzzzz"}"#,
        "{",
    ] {
        assert!(parse_save_json(bad.as_bytes()).is_err(), "{bad}");
    }
}

/// A `.vctower` whose payload carries a lone surrogate escape (what the
/// web writes for a split emoji) opens, and the engine writes it back
/// with the replacement character.
#[test]
fn a_vctower_with_a_lone_surrogate_opens() {
    use std::io::Write;
    let json = br#"{"version":7,"units":[],"minutes":0,"towerName":"Sky \ud83c"}"#;
    let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::new(1));
    enc.write_all(json).unwrap();
    let b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        enc.finish().unwrap(),
    );
    let save = decode_vctower(&format!("VCTOWER1\n{b64}\n")).unwrap();
    assert_eq!(save["towerName"], json!("Sky \u{FFFD}"));
    let again = encode_vctower(&save).unwrap();
    let back = decode_vctower(std::str::from_utf8(&again).unwrap()).unwrap();
    assert_eq!(back["towerName"], json!("Sky \u{FFFD}"));
}

/// The encoder refuses a save the readers would refuse as too large.
#[test]
fn the_encoder_refuses_a_save_over_the_read_cap() {
    let big = "x".repeat(super::MAX_SAVE_INFLATED_BYTES as usize);
    let err = encode_vctower(&json!({ "towerName": big })).unwrap_err();
    assert!(err.contains("more than"), "{err}");
    let fits = "x".repeat(super::MAX_SAVE_INFLATED_BYTES as usize - 20);
    assert!(encode_vctower(&json!({ "t": fits })).is_ok());
}
