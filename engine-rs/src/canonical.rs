//! Canonical JSON and the checkpoint digest, matching
//! `src/tests/conformance/canonical.ts` and the rules in `conformance/README.md`.

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::jsmath::number_to_string;

/// Escape a string as `JSON.stringify` does: short escapes for `"`, `\`,
/// and the five named controls, `\u00xx` for other controls, `\udxxx` for an
/// unpaired surrogate (which a Rust `str` cannot hold, so none appear), and
/// everything else as is.
fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// UTF-16 code unit order, the order `Array.prototype.sort` gives string keys.
fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// An array index as a JavaScript object key: `"0"` or a decimal without a
/// leading zero, below 2^32 - 1. A JavaScript object visits such keys first,
/// in numeric order, then its other keys in insertion order.
fn array_index(k: &str) -> Option<u32> {
    if k.is_empty() || (k.len() > 1 && k.starts_with('0')) || !k.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    k.parse::<u32>().ok().filter(|&n| n != u32::MAX)
}

/// How `write_value` orders an object's keys.
#[derive(Clone, Copy)]
enum KeyOrder {
    /// UTF-16 code unit order, the canonical text.
    Sorted,
    /// The order `JSON.stringify` visits a JavaScript object built with the
    /// map's keys in insertion order.
    Js,
}

fn write_value(out: &mut String, v: &Value, order: KeyOrder) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            let x = n.as_f64().expect("finite number");
            assert!(x.is_finite(), "canonicalJson: non-finite number");
            out.push_str(&number_to_string(x));
        }
        Value::String(s) => write_string(out, s),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(out, item, order);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            match order {
                KeyOrder::Sorted => keys.sort_by(|a, b| utf16_cmp(a, b)),
                // Stable, so the other keys keep insertion order.
                KeyOrder::Js => keys.sort_by_key(|k| array_index(k).map_or(1u64 << 32, u64::from)),
            }
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(out, k);
                out.push(':');
                write_value(out, &map[*k], order);
            }
            out.push('}');
        }
    }
}

/// The canonical text of a value. A JSON value never holds `undefined`, so
/// callers leave absent fields out of the map before calling this.
pub fn canonical_json(v: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, v, KeyOrder::Sorted);
    out
}

/// `JSON.stringify` of the value as JavaScript would hold it: every map in
/// insertion order (serde_json's `preserve_order`), except that keys that are
/// array indices come first in numeric order, as in any JavaScript object.
/// Numbers and strings are written as in [`canonical_json`]. This is the text
/// the web game's writers compress, so the engine's `.vctower` matches it.
pub fn js_json(v: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, v, KeyOrder::Js);
    out
}

/// First 16 hex digits of the SHA-256 of the canonical JSON's UTF-8 bytes.
pub fn digest(v: &Value) -> String {
    let hash = Sha256::digest(canonical_json(v).as_bytes());
    let mut hex = String::with_capacity(16);
    for byte in &hash[..8] {
        hex.push_str(&format!("{:02x}", byte));
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorts_keys_by_utf16_units_at_every_depth() {
        let v = json!({"b": 1, "a": {"10": 1, "9": 2, "Z": 3}});
        assert_eq!(canonical_json(&v), r#"{"a":{"10":1,"9":2,"Z":3},"b":1}"#);
    }

    #[test]
    fn js_order_puts_array_indices_first_then_insertion_order() {
        let v: Value = serde_json::from_str(
            r#"{"b":1,"10":2,"a":{"z":1,"y":2},"9":3,"01":4,"-1":5,"4294967295":6,"4294967294":7}"#,
        )
        .unwrap();
        assert_eq!(
            js_json(&v),
            r#"{"9":3,"10":2,"4294967294":7,"b":1,"a":{"z":1,"y":2},"01":4,"-1":5,"4294967295":6}"#
        );
    }

    #[test]
    fn prints_numbers_as_js_does() {
        let v = json!([-0.0, 0.1, 1e21, 1e-7, 123456789.125]);
        assert_eq!(canonical_json(&v), "[0,0.1,1e+21,1e-7,123456789.125]");
    }

    #[test]
    fn escapes_strings_as_json_stringify_does() {
        let v = json!("\"\\/\u{8}\t\n\u{c}\r\u{1}\u{1f}\u{1F600}\u{7f}\u{2028}é");
        assert_eq!(
            canonical_json(&v),
            "\"\\\"\\\\/\\b\\t\\n\\f\\r\\u0001\\u001f\u{1F600}\u{7f}\u{2028}é\""
        );
    }

    #[test]
    fn digest_is_sixteen_hex_digits_of_sha256() {
        assert_eq!(digest(&json!({"a": 1})), "015abd7f5cc57a2d");
    }
}
