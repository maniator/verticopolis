// Checking the gameplay event catalog and the events drained against it.

use serde_json::Value;

/// A JSON number that is a whole number JavaScript holds exactly, as
/// `Number.isSafeInteger` reads it: `3` and `3.0` alike (the parsed text
/// cannot tell them apart in TypeScript, so neither side may either), and
/// nothing past 2^53 - 1 in magnitude.
fn whole(v: &Value) -> Option<i64> {
    const SAFE: i64 = 9_007_199_254_740_991;
    v.as_i64()
        .or_else(|| {
            v.as_f64()
                .filter(|f| f.fract() == 0.0 && f.abs() <= SAFE as f64)
                .map(|f| f as i64)
        })
        .filter(|n| n.unsigned_abs() <= SAFE as u64)
}

/// `snake_case` from a lowercase letter: an event name.
fn is_event_name(s: &str) -> bool {
    s.starts_with(|c: char| c.is_ascii_lowercase())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Enum set names whose generated type would collide with one the
/// declaration already exports.
const RESERVED_SETS: [&str; 5] = [
    "catalogVersion",
    "event",
    "eventName",
    "eventPayloads",
    "eventVersions",
];

/// `camelCase` from a lowercase letter: an enum set or a payload field, both
/// of which become TypeScript identifiers in the generated declaration.
fn is_camel_name(s: &str) -> bool {
    s.starts_with(|c: char| c.is_ascii_lowercase()) && s.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Prose the generated declaration carries in a doc comment: non-empty and
/// unable to close that comment early.
fn prose(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty() && !s.contains("*/"))
}

/// Checks a catalog's shape and its payload rule: every field is an enum the
/// catalog defines or a bounded integer, so no free text, money or name can
/// enter an event.
pub fn check_catalog(catalog: &Value) -> Result<(), String> {
    if !catalog.is_object() {
        return Err("catalog: must be an object".into());
    }
    if !catalog
        .get("catalogVersion")
        .and_then(whole)
        .is_some_and(|v| v >= 1)
    {
        return Err("catalog: catalogVersion must be a whole number from 1".into());
    }
    if !prose(catalog.get("about")) {
        return Err("catalog: about must be a non-empty string without */".into());
    }
    let enums = catalog
        .get("enums")
        .and_then(Value::as_object)
        .ok_or("catalog: enums must be an object")?;
    for (name, values) in enums {
        if !is_camel_name(name) {
            return Err(format!("enum {name}: name must be camelCase"));
        }
        if RESERVED_SETS.contains(&name.as_str()) {
            return Err(format!(
                "enum {name}: name is reserved by the generated declaration"
            ));
        }
        let values = values
            .as_array()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| format!("enum {name}: must be a non-empty array"))?;
        let mut seen = std::collections::HashSet::new();
        for v in values {
            let s = v
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("enum {name}: values must be non-empty strings"))?;
            if !seen.insert(s) {
                return Err(format!("enum {name}: {s} is listed twice"));
            }
        }
    }
    let events = catalog
        .get("events")
        .and_then(Value::as_array)
        .ok_or("catalog: events must be an array")?;
    let mut names = std::collections::HashSet::new();
    for e in events {
        let name = e
            .get("name")
            .and_then(Value::as_str)
            .filter(|s| is_event_name(s))
            .ok_or("event: name must be snake_case")?;
        if !names.insert(name) {
            return Err(format!("event {name}: listed twice"));
        }
        if !e.get("version").and_then(whole).is_some_and(|v| v >= 1) {
            return Err(format!(
                "event {name}: version must be a whole number from 1"
            ));
        }
        if !matches!(
            e.get("cardinality").and_then(Value::as_str),
            Some("per_occurrence") | Some("per_tower")
        ) {
            return Err(format!(
                "event {name}: cardinality must be per_occurrence or per_tower"
            ));
        }
        for key in ["semantics", "history"] {
            if !prose(e.get(key)) {
                return Err(format!(
                    "event {name}: {key} must be a non-empty string without */"
                ));
            }
        }
        let payload = e
            .get("payload")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("event {name}: payload must be an object"))?;
        for (field, spec) in payload {
            let where_ = format!("event {name} field {field}");
            if !is_camel_name(field) {
                return Err(format!("{where_}: name must be camelCase"));
            }
            match spec.get("type").and_then(Value::as_str) {
                Some("enum") => {
                    let set = spec
                        .get("enum")
                        .and_then(Value::as_str)
                        .ok_or_else(|| format!("{where_}: enum must name a catalog enum"))?;
                    if !enums.contains_key(set) {
                        return Err(format!("{where_}: enum {set} is not in the catalog"));
                    }
                }
                Some("integer") => {
                    let min = spec.get("min").and_then(whole);
                    let max = spec.get("max").and_then(whole);
                    match (min, max) {
                        (Some(lo), Some(hi))
                            if lo <= hi && lo.unsigned_abs() <= 100_000 && hi.unsigned_abs() <= 100_000 => {}
                        _ => {
                            return Err(format!(
                                "{where_}: an integer needs whole min and max within 100000"
                            ))
                        }
                    }
                }
                other => {
                    return Err(format!(
                        "{where_}: type {} is not allowed; payloads carry closed enums and small integers only",
                        other.unwrap_or("(none)")
                    ))
                }
            }
        }
    }
    Ok(())
}

/// Checks one drained event (as [`GameplayEvent::to_json`](super::GameplayEvent::to_json) writes it) against
/// a catalog: a known name, exactly the catalog's fields, each enum value
/// listed and each integer in range.
///
/// ```
/// use verticopolis_engine::clock::GameMode;
/// use verticopolis_engine::gameplay::{check_event, GameplayEvent, CATALOG_JSON};
///
/// let catalog: serde_json::Value = serde_json::from_str(CATALOG_JSON).unwrap();
/// let event = GameplayEvent::TowerFounded { mode: GameMode::Modern };
/// assert!(check_event(&catalog, &event.to_json()).is_ok());
/// ```
pub fn check_event(catalog: &Value, event: &Value) -> Result<(), String> {
    let name = event
        .get("name")
        .and_then(Value::as_str)
        .ok_or("event: name must be a string")?;
    let entry = catalog["events"]
        .as_array()
        .and_then(|a| a.iter().find(|e| e["name"] == name))
        .ok_or_else(|| format!("event {name}: not in the catalog"))?;
    let spec = entry["payload"]
        .as_object()
        .ok_or_else(|| format!("event {name}: the catalog entry has no payload"))?;
    let payload = match (event.as_object().map(|o| o.len()), event.get("payload")) {
        (Some(2), Some(Value::Object(p))) => p,
        _ => return Err(format!("event {name}: must be exactly {{ name, payload }}")),
    };
    for k in payload.keys() {
        if !spec.contains_key(k) {
            return Err(format!("event {name}: field {k} is not in the catalog"));
        }
    }
    for (field, s) in spec {
        let v = payload
            .get(field)
            .ok_or_else(|| format!("event {name}: field {field} is missing"))?;
        let ok = match s["type"].as_str() {
            Some("enum") => {
                let set = s["enum"].as_str().unwrap_or_default();
                v.as_str().is_some_and(|x| {
                    catalog["enums"][set]
                        .as_array()
                        .is_some_and(|vals| vals.iter().any(|y| y == x))
                })
            }
            Some("integer") => whole(v).is_some_and(|n| {
                whole(&s["min"]).is_some_and(|lo| n >= lo)
                    && whole(&s["max"]).is_some_and(|hi| n <= hi)
            }),
            _ => false,
        };
        if !ok {
            return Err(format!(
                "event {name}: field {field} = {v} is outside the catalog"
            ));
        }
    }
    Ok(())
}
