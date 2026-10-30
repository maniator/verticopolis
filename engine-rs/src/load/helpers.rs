//! Small numeric, string and entity helpers the loaders share.

use super::*;

/// `typeof v === "number" && Number.isFinite(v) ? v : fallback`.
pub(super) fn num(v: Option<&Value>, fallback: f64) -> f64 {
    match v.and_then(Value::as_f64) {
        Some(x) if x.is_finite() => x,
        _ => fallback,
    }
}

pub(super) fn is_num(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64).is_some()
}

pub(super) fn finite_num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite())
}

/// `Number(v)` for the shapes a save holds: a number is itself, a missing
/// value is NaN, null is 0, a boolean is 0 or 1, and a string follows the
/// `StringNumericLiteral` grammar (`js_string_number`); anything else is NaN.
pub(crate) fn js_number(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::String(s)) => js_string_number(s),
        // `ToPrimitive` joins an array with commas, so only an empty array
        // (0) or a single scalar element can read as a number; a boolean
        // element spells "true", which is NaN.
        Some(Value::Array(a)) => match a.as_slice() {
            [] => 0.0,
            [Value::Bool(_)] | [Value::Object(_)] => f64::NAN,
            // The element is rendered as text first: a number `-0` prints
            // as "0" and loses its sign, while the string "-0" keeps it.
            [one @ Value::Number(_)] => {
                let v = js_number(Some(one));
                if v == 0.0 {
                    0.0
                } else {
                    v
                }
            }
            [one] => js_number(Some(one)),
            _ => f64::NAN,
        },
        _ => f64::NAN,
    }
}

/// `Number(string)`: trim JavaScript whitespace (which includes U+FEFF), an
/// empty string is 0, `0x`/`0o`/`0b` prefixes are unsigned integer literals,
/// `Infinity` is spelled exactly so, and the rest is a decimal literal
/// (`[+-] digits [. digits] [e [+-] digits]`, `.5` and `5.` included). Rust's
/// `f64::from_str` also takes `inf`, `nan` and `infinity` in any case, so the
/// decimal path is checked character by character before it is parsed.
pub(super) fn js_string_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    let radix = |rest: &str, radix: u32| -> f64 {
        if rest.is_empty() {
            return f64::NAN;
        }
        // The exact value rounded once: u128 covers 32 hex digits, which is
        // past any save; a longer literal falls back to per-digit rounding.
        let mut exact: Option<u128> = Some(0);
        let mut acc = 0.0f64;
        for c in rest.chars() {
            match c.to_digit(radix) {
                Some(d) => {
                    exact = exact
                        .and_then(|e| e.checked_mul(radix as u128))
                        .and_then(|e| e.checked_add(d as u128));
                    acc = acc * radix as f64 + d as f64;
                }
                None => return f64::NAN,
            }
        }
        exact.map(|e| e as f64).unwrap_or(acc)
    };
    let lower = t.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("0x") {
        return radix(rest, 16);
    }
    if let Some(rest) = lower.strip_prefix("0o") {
        return radix(rest, 8);
    }
    if let Some(rest) = lower.strip_prefix("0b") {
        return radix(rest, 2);
    }
    let (neg, body) = match t.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    if body == "Infinity" {
        return if neg {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    // StrUnsignedDecimalLiteral: digits, an optional fraction, an optional
    // exponent; at least one digit in the mantissa.
    let mut chars = body.chars().peekable();
    let mut mantissa_digits = 0;
    while chars.peek().is_some_and(|c| c.is_ascii_digit()) {
        chars.next();
        mantissa_digits += 1;
    }
    if chars.peek() == Some(&'.') {
        chars.next();
        while chars.peek().is_some_and(|c| c.is_ascii_digit()) {
            chars.next();
            mantissa_digits += 1;
        }
    }
    if mantissa_digits == 0 {
        return f64::NAN;
    }
    if matches!(chars.peek(), Some('e') | Some('E')) {
        chars.next();
        if matches!(chars.peek(), Some('+') | Some('-')) {
            chars.next();
        }
        let mut exp_digits = 0;
        while chars.peek().is_some_and(|c| c.is_ascii_digit()) {
            chars.next();
            exp_digits += 1;
        }
        if exp_digits == 0 {
            return f64::NAN;
        }
    }
    if chars.next().is_some() {
        return f64::NAN;
    }
    let v = body.parse::<f64>().unwrap_or(f64::NAN);
    if neg {
        -v
    } else {
        v
    }
}

pub(super) fn kind_of(u: &Value) -> Option<Kind> {
    u.get("kind").and_then(Value::as_str).and_then(Kind::parse)
}

/// `Math.min` / `Math.max`: a NaN wins, where `f64::min`/`max` would drop it.
pub(super) fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

pub(super) fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// JS `ToUint32`.
pub(super) fn to_uint32(x: f64) -> u32 {
    if !x.is_finite() {
        return 0;
    }
    let t = x.trunc();
    let m = t.rem_euclid(4294967296.0);
    m as u32
}

/// `FAR_COORD` (v1tov2.ts): a room floor, column or width at least this far
/// from 0 is left out of the checks (floor) and the reflow (all three), so no
/// loop over its stories or columns runs where adding 1 stops moving, no
/// `as i64` saturates, and both engines treat it alike (#858).
pub(super) const FAR_COORD: f64 = 4_503_599_627_370_496.0;

/// `!(Math.abs(v) < FAR_COORD)` in v1tov2.ts: NaN counts as far.
pub(super) fn is_far(v: f64) -> bool {
    v.is_nan() || v.abs() >= FAR_COORD
}

/// A structure tile's width as `tileSpan` reads it: 1 when not a number, and no
/// wider than the lot (#858).
pub(super) fn tile_width(u: &Value) -> f64 {
    u.get("width")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .min(LOT as f64)
}

pub(super) fn tile_key(f: f64, x: f64) -> String {
    format!("{}:{}", number_to_string(f), number_to_string(x))
}

pub(super) fn stories_at_version(kind: Kind, version: Option<f64>) -> i64 {
    if kind == Kind::PartyHall && version.unwrap_or(0.0) < 6.0 {
        return 1;
    }
    kind.floors()
}

/// The width a kind had when the v1 to v2 migration was written, so it still
/// re-lays an old save the way it always did. The catalog moved security,
/// medical, housekeeping and recycling to their SimTower widths and the metro
/// to 30 tiles (#1500); this keeps the old widths for that one migration.
pub(super) fn v2_width(kind: Kind) -> i64 {
    match kind {
        Kind::Security | Kind::Housekeeping => 8,
        Kind::Medical => 16,
        Kind::Recycling => 20,
        Kind::Metro => LOT,
        _ => kind.facility().width,
    }
}

pub(super) fn floor_unit(id: i64, floor: i64, x: i64) -> Value {
    json!({
        "id": id, "kind": "floor", "floor": floor, "x": x, "width": 1, "state": "empty",
        "satisfaction": 1, "occupants": 0, "everOccupied": false, "pendingIncome": 0, "label": "Floor"
    })
}

pub(super) fn units_of(data: &Value) -> &[Value] {
    data.get("units")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice)
}

pub(super) fn version_of(data: &Value) -> Option<f64> {
    data.get("version").and_then(Value::as_f64)
}

/// `{...data, ...patches}`: the keys a patch replaces are not cloned first
/// (a patched `units` is the whole tower), and every key keeps the position
/// the object gave it.
pub(super) fn with(data: &Value, patches: Vec<(&str, Value)>) -> Value {
    let mut patches: Vec<Option<(&str, Value)>> = patches.into_iter().map(Some).collect();
    let mut m = Map::new();
    for (k, v) in data.as_object().into_iter().flatten() {
        let patch = patches
            .iter_mut()
            .rev()
            .find(|p| p.as_ref().is_some_and(|(pk, _)| pk == k))
            .and_then(Option::take);
        match patch {
            Some((_, pv)) => m.insert(k.clone(), pv),
            None => m.insert(k.clone(), v.clone()),
        };
    }
    for (k, v) in patches.into_iter().flatten() {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

/// `with` on a save this call owns: the patches go in place, nothing is cloned.
pub(super) fn with_owned(data: Value, patches: Vec<(&str, Value)>) -> Value {
    let mut m = match data {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    for (k, v) in patches {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}
