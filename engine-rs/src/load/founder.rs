//! The founder status test.

use super::*;

/// JS `Number.parseInt(s, 10)` as an option.
pub(super) fn parse_int(s: &str) -> Option<f64> {
    // `parseInt` skips the JavaScript whitespace set, the byte order mark included.
    let t = js_trim(s);
    let (neg, rest) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let v: f64 = digits.parse().ok()?;
    Some(if neg { -v } else { v })
}

/// `detectFounder(raw)`.
pub fn detect_founder(raw: &Value) -> bool {
    if raw.get("founder") == Some(&Value::Bool(true)) {
        return true;
    }
    raw.get("appVersion")
        .and_then(Value::as_str)
        .and_then(parse_int)
        .is_some_and(|v| v < 2.0)
}

/// `markFounderFromLoadedFile(sim, raw)`.
pub fn mark_founder_from_loaded_file(sim: &mut Simulation, raw: &Value) {
    if !sim.founder && raw.get("appVersion").is_none() {
        sim.founder = true;
    }
}
