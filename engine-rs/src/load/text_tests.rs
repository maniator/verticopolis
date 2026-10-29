//! Tests for the container text helpers: number reading, base64 leniency and byte order marks.

use super::{decode_vctower, detect_founder, js_number, js_string_number, lenient_base64};
use serde_json::json;

/// `Number.parseInt` skips the JavaScript whitespace set, the byte order
/// mark included, so a stamped version behind one still reads.
#[test]
fn founder_stamp_reads_through_a_byte_order_mark() {
    assert!(detect_founder(&json!({ "appVersion": "\u{feff}1.9" })));
    assert!(detect_founder(&json!({ "appVersion": "  1.9" })));
    assert!(!detect_founder(&json!({ "appVersion": "2.0" })));
    assert!(!detect_founder(&json!({ "appVersion": "\u{feff}" })));
    assert!(detect_founder(
        &json!({ "founder": true, "appVersion": "9" })
    ));
}

/// Pinned with Node: `Number(s)` for each input.
#[test]
fn string_number_matches_javascript() {
    let same = [
        ("", 0.0),
        ("  12 ", 12.0),
        ("\u{feff}7\u{feff}", 7.0),
        ("0x1A", 26.0),
        ("0X1a", 26.0),
        ("0b101", 5.0),
        ("0o17", 15.0),
        ("Infinity", f64::INFINITY),
        ("-Infinity", f64::NEG_INFINITY),
        ("+Infinity", f64::INFINITY),
        ("1e5", 100000.0),
        (".5", 0.5),
        ("5.", 5.0),
        ("+5", 5.0),
        ("1.5e-3", 0.0015),
        (" 3.0e+2 ", 300.0),
        ("\u{a0}7\u{2028}", 7.0),
        ("+.5", 0.5),
        ("1e309", f64::INFINITY),
        ("-.5e1", -5.0),
        ("  ", 0.0),
        ("Infinity ", f64::INFINITY),
        ("1E5", 100000.0),
        ("00012", 12.0),
        // 2^57 + 31: exact rounding gives 2^57 + 32, per-digit rounding
        // (which ties 2^53 + 1 down first) would give 2^57.
        ("0x20000000000001F", 144115188075855904.0),
        ("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", 8.711228593176025e40),
    ];
    for (s, want) in same {
        assert_eq!(js_string_number(s), want, "{s:?}");
    }
    assert!(js_string_number("-0").is_sign_negative());
    assert_eq!(js_string_number("-0"), 0.0);
    for s in [
        "0x", "inf", "infinity", "NaN", "1e", "1e+", "1_000", "12abc", "0x1.5", "-0x10", "e5", ".",
        "\u{85}7", "\u{661}", "+-5",
    ] {
        assert!(js_string_number(s).is_nan(), "{s:?}");
    }
}

/// Pinned with Node: `Number(v)` for non-string shapes.
#[test]
fn number_of_other_shapes_matches_javascript() {
    assert_eq!(js_number(Some(&json!(null))), 0.0);
    assert_eq!(js_number(Some(&json!(true))), 1.0);
    assert_eq!(js_number(Some(&json!(false))), 0.0);
    assert_eq!(js_number(Some(&json!(2.5))), 2.5);
    assert_eq!(js_number(Some(&json!([]))), 0.0);
    assert_eq!(js_number(Some(&json!([7]))), 7.0);
    assert_eq!(js_number(Some(&json!([[7]]))), 7.0);
    assert_eq!(js_number(Some(&json!([null]))), 0.0);
    assert_eq!(js_number(Some(&json!([" 7 "]))), 7.0);
    assert_eq!(js_number(Some(&json!([""]))), 0.0);
    assert_eq!(js_number(Some(&json!([[]]))), 0.0);
    assert_eq!(js_number(Some(&json!(["0x10"]))), 16.0);
    assert_eq!(js_number(Some(&json!([1e21]))), 1e21);
    for v in [
        json!([true]),
        json!([7, 8]),
        json!([{}]),
        json!({}),
        json!("abc"),
    ] {
        assert!(js_number(Some(&v)).is_nan(), "{v}");
    }
    assert!(js_number(None).is_nan());
    assert!(js_number(Some(&json!([-0.0]))).is_sign_positive());
    assert!(js_number(Some(&json!([[-0.0]]))).is_sign_positive());
    assert!(js_number(Some(&json!(["-0"]))).is_sign_negative());
    assert!(js_number(Some(&json!([["-0"]]))).is_sign_negative());
}

/// Pinned with Node: `Buffer.from(s, "base64").toString("latin1")`.
#[test]
fn base64_is_as_lenient_as_buffer_from() {
    for (b64, want) in [
        ("YWJj", "abc"),
        ("YWJjZA", "abcd"),
        ("YWJ", "ab"),
        ("YR==", "a"),
        ("YQ==Y", "a"),
        ("YQ==YQ==", "a"),
        ("YW Jj", "abc"),
        ("YW!Jj", "abc"),
        ("YWJjZ", "abc"),
        ("YWJj\u{85}2", "abc"),
        ("YWJj=", "abc"),
        ("=YWJj", ""),
        ("YWK", "ab"),
    ] {
        assert_eq!(lenient_base64(b64), want.as_bytes(), "{b64:?}");
    }
    assert_eq!(lenient_base64("YW-j"), [97, 111, 163]);
    assert_eq!(lenient_base64("YW_j"), [97, 111, 227]);
    assert_eq!(lenient_base64("YQ-_"), [97, 15, 191]);
}

/// `String.prototype.trim` strips a leading U+FEFF before the magic and
/// `TextDecoder` strips one inside the inflated JSON; NEL is neither.
#[test]
fn container_tolerates_byte_order_marks() {
    use std::io::Write;
    let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(b"\xEF\xBB\xBF{\"version\":7}").unwrap();
    let packed = enc.finish().unwrap();
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &packed);
    let text = format!("\u{feff}VCTOWER1\n{b64}\n");
    assert_eq!(decode_vctower(&text).unwrap(), json!({"version": 7}));
    assert!(decode_vctower(&format!("\u{85}{text}")).is_err());
}
