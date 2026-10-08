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

fn write_value(out: &mut String, v: &Value) {
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
                write_value(out, item);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| utf16_cmp(a, b));
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(out, k);
                out.push(':');
                write_value(out, &map[*k]);
            }
            out.push('}');
        }
    }
}

/// The canonical text of a value. A JSON value never holds `undefined`, so
/// callers leave absent fields out of the map before calling this.
pub fn canonical_json(v: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, v);
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
