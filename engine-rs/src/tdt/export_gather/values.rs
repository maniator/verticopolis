//! JavaScript value readers and the floor map key.

use serde_json::Value;

/// `Number(v)` for the JSON values a save can hold; `undefined` is NaN. It is
/// the loader's reading (`crate::load::js_number`), which follows the
/// `StringNumericLiteral` grammar and `ToPrimitive` for arrays; its full
/// Node-pinned tables live beside it in `load.rs`.
pub fn js_num(v: Option<&Value>) -> f64 {
    crate::load::js_number(v)
}

/// The reading at the three sites the TypeScript gather keeps raw (a unit's
/// `floor`, `x` and `width`, passed through `norm()` with `??` and then
/// concatenated, compared with `===` or with `<`). It is the reading these
/// sites had before round 3 of the #881 review, kept on purpose: a number,
/// a boolean (`true` 1, `false` 0), `null` and an empty array read as
/// `Number()` would, and a string is trimmed and parsed with Rust's float
/// grammar, else NaN, so a radix string such as `"0x10"` lands on NaN where
/// TypeScript's concatenation also yields no number. An empty or
/// whitespace-only string reads 0 as `Number("")` does: the reader checks
/// for an empty trimmed string before it parses, so Rust's parse never sees
/// it. It differs from `Number()` in these places:
///
/// - a one-element array reads its element with this same reader, so
///   `[true]` and `[false]` read 1 and 0 (`Number([true])` is NaN);
/// - Rust's float grammar accepts `inf`, `infinity` and `NaN` in any case
///   (`Number("inf")` is NaN);
/// - Rust's `trim` strips U+0085 but not U+FEFF, so `"\u{85}2"` reads 2 and
///   `"\u{feff}2"` reads NaN (`Number()` reads the first as NaN and the
///   second as 2); the same split decides which strings count as
///   whitespace-only, so `"\u{feff}"` alone reads NaN where `Number()`
///   reads 0, and `"\u{85}"` alone reads 0 where `Number()` reads NaN;
/// - radix strings (`"0x10"`, `"0o7"`, `"0b11"`) read NaN.
///
/// TypeScript keeps these sites raw anyway (a string floor concatenates), so
/// neither this reader nor `js_num` is exact for a forged value here. The
/// unit tests pin this reading (`js_num_raw_site_outputs_are_pinned`) and
/// which reader each `norm()` and rent site uses (the `gather_*` tests), so
/// neither can drift by accident. Modeling the raw sites is #884's work.
pub fn js_num_raw_site(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        Some(Value::Array(a)) if a.is_empty() => 0.0,
        Some(Value::Array(a)) if a.len() == 1 => js_num_raw_site(Some(&a[0])),
        Some(_) => f64::NAN,
    }
}

/// `Number.isFinite(v)` as a reader: `Some` only for a JSON number that is
/// finite. There is no coercion, so `null`, a boolean, a string and an array
/// all read as `None`, exactly the values `Number.isFinite` rejects. (A JSON
/// number is finite by construction; the check guards an out-of-range
/// literal `serde_json` could not represent.)
pub fn js_finite(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => n.as_f64().filter(|x| x.is_finite()),
        _ => None,
    }
}

/// JavaScript truthiness.
pub fn js_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `Math.min` / `Math.max`: NaN wins.
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// A `Map` key for a floor number: SameValueZero, so `-0` is `0` and every
/// NaN is one key.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FloorKey(u64);

impl FloorKey {
    pub fn of(f: f64) -> Self {
        if f.is_nan() {
            FloorKey(f64::NAN.to_bits())
        } else if f == 0.0 {
            FloorKey(0)
        } else {
            FloorKey(f.to_bits())
        }
    }

    pub fn value(self) -> f64 {
        f64::from_bits(self.0)
    }
}
