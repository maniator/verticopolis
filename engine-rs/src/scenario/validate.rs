//! Checking a scenario file against the field table before it is deserialized.

use crate::facilities::Kind;
use serde_json::Value;

/// Field types of `loadScenario`: "int" a whole number, "u32" a whole number
/// from 0 to 4294967295, "count" a whole number above zero, "dir" 1 or -1,
/// "num" a finite number, "str" a non-empty string, "bool" a boolean, "place"
/// a facility kind that is not a transport, "shaft" a transport kind, "mode"
/// classic or modern, "obj" a JSON object, "kind" any facility kind,
/// "choice" fireRescue or bombThreat, "policy" a film policy, "target" a
/// batch rent target (a finite number, default or noRate), "star" a whole
/// number from 1 to 5. A trailing "?" marks the field optional.
fn field_fits(ty: &str, v: &Value) -> bool {
    let int = |v: &Value| v.as_i64().is_some();
    match ty {
        "int" => int(v),
        "u32" => v.as_i64().is_some_and(|n| (0..=0xffff_ffff).contains(&n)),
        "count" => v.as_i64().is_some_and(|n| n > 0),
        "star" => v.as_i64().is_some_and(|n| (1..=5).contains(&n)),
        "dir" => matches!(v.as_i64(), Some(1) | Some(-1)),
        "num" => v.as_f64().is_some_and(f64::is_finite),
        "str" => v.as_str().is_some_and(|s| !s.is_empty()),
        "bool" => v.is_boolean(),
        "place" => v
            .as_str()
            .and_then(Kind::parse)
            .is_some_and(|k| !k.is_transport()),
        "shaft" => v
            .as_str()
            .and_then(Kind::parse)
            .is_some_and(|k| k.is_transport()),
        "mode" => matches!(v.as_str(), Some("classic") | Some("modern")),
        "obj" => v.is_object(),
        "kind" => v.as_str().and_then(Kind::parse).is_some(),
        "choice" => matches!(v.as_str(), Some("fireRescue") | Some("bombThreat")),
        "policy" => matches!(
            v.as_str(),
            Some("auto") | Some("feature") | Some("blockbuster")
        ),
        "target" => {
            matches!(v.as_str(), Some("default") | Some("noRate"))
                || v.as_f64().is_some_and(f64::is_finite)
        }
        "end" => matches!(v.as_str(), Some("up") | Some("down")),
        "method" => matches!(v.as_str(), Some("sell") | Some("bulldoze")),
        _ => unreachable!("field type {ty}"),
    }
}

/// `check(where, value, spec, skip)`: an object with no field outside the
/// spec (or `skip`), every required field present and of its type, and
/// every optional field absent (`undefined`, so a literal null fails) or of
/// its type.
fn check_fields(
    where_: &str,
    value: &Value,
    spec: &[(&str, &str)],
    skip: &[&str],
) -> Result<(), String> {
    let obj = value
        .as_object()
        .ok_or_else(|| format!("{where_}: must be an object"))?;
    for k in obj.keys() {
        if !skip.contains(&k.as_str()) && !spec.iter().any(|(name, _)| name == k) {
            return Err(format!("{where_}: unknown field {k}"));
        }
    }
    for (k, t) in spec {
        let (ty, optional) = match t.strip_suffix('?') {
            Some(ty) => (ty, true),
            None => (*t, false),
        };
        match obj.get(*k) {
            None if optional => {}
            Some(v) if field_fits(ty, v) => {}
            _ => return Err(format!("{where_}: {k} must be {ty}")),
        }
    }
    Ok(())
}

const AT: [(&str, &str); 2] = [("floor", "int"), ("x", "int")];

fn op_spec(op: &str) -> Option<&'static [(&'static str, &'static str)]> {
    Some(match op {
        "setMoney" => &[("amount", "num")],
        "build" => &[
            ("kind", "place"),
            ("floor", "int"),
            ("x", "int"),
            ("expectFail", "bool?"),
            ("reason", "str?"),
        ],
        "buildRow" => &[
            ("kind", "place"),
            ("floor", "int"),
            ("from", "int"),
            ("to", "int"),
        ],
        "buildTransport" => &[
            ("kind", "shaft"),
            ("x", "int"),
            ("bottom", "int"),
            ("top", "int"),
            ("expectFail", "bool?"),
            ("reason", "str?"),
        ],
        "setNoRate" => &[("floor", "int"), ("x", "int"), ("expectFail", "bool?")],
        "sell" => &[
            ("floor", "int"),
            ("x", "int"),
            ("kind", "kind?"),
            ("expectFail", "bool?"),
        ],
        "adjustRent" => &[
            ("floor", "int"),
            ("x", "int"),
            ("dir", "dir"),
            ("expectFail", "bool?"),
        ],
        "setCars" => &[
            ("floor", "int"),
            ("x", "int"),
            ("cars", "count"),
            ("expectFail", "bool?"),
        ],
        "addCar" | "removeCar" => &[("floor", "int"), ("x", "int"), ("reason", "str?")],
        "extendTransport" => &[
            ("floor", "int"),
            ("x", "int"),
            ("end", "end"),
            ("targetFloor", "int"),
            ("reason", "str?"),
        ],
        "beginExtend" => &AT,
        "endExtend" => &[],
        "removeFacility" => &[
            ("floor", "int"),
            ("x", "int"),
            ("method", "method"),
            ("shaft", "bool?"),
            ("reason", "str?"),
        ],
        "startFire" => &[("expectFail", "bool?")],
        "bombThreat" | "evaluateStar" | "reload" | "toggleAutoBridge" => &[],
        "setFilmPolicy" => &[("floor", "int"), ("x", "int"), ("policy", "policy")],
        "rerollSubtype" | "clearStops" => &AT,
        "resizeTransport" => &[
            ("floor", "int"),
            ("x", "int"),
            ("bottom", "int"),
            ("top", "int"),
            ("expectFail", "bool?"),
            ("reason", "str?"),
        ],
        "setStop" => &[
            ("floor", "int"),
            ("x", "int"),
            ("stopFloor", "int"),
            ("stop", "bool"),
        ],
        "priceUnit" => &[("floor", "int"), ("x", "int"), ("target", "num")],
        "applyRentBatch" => &[
            ("kind", "place"),
            ("target", "target"),
            ("onlyDefaultPriced", "bool?"),
        ],
        "callExterminator" => &[("expectFail", "bool?"), ("reason", "str?")],
        "resolveChoice" => &[("accept", "bool"), ("kind", "choice?")],
        "setSchedule" => &[
            ("floor", "int"),
            ("x", "int"),
            ("schedule", "obj"),
            ("expectFail", "bool?"),
        ],
        "tick" => &[
            ("dt", "count"),
            ("times", "count?"),
            ("checkpointEvery", "count?"),
        ],
        "checkpoint" => &[("label", "str")],
        _ => return None,
    })
}

pub(super) fn check_scenario(s: &Value) -> Result<(), String> {
    check_fields(
        "scenario",
        s,
        &[("id", "str"), ("description", "str")],
        &["start", "commands"],
    )?;
    let start = s.get("start").unwrap_or(&Value::Null);
    if start.get("newGame").is_some() {
        check_fields("start", start, &[], &["newGame"])?;
        check_fields(
            "start.newGame",
            &start["newGame"],
            &[("seed", "u32"), ("mode", "mode"), ("star", "star?")],
            &[],
        )?;
    } else {
        check_fields(
            "start",
            start,
            &[("fixture", "str"), ("mode", "mode?")],
            &[],
        )?;
    }
    let commands = s
        .get("commands")
        .and_then(Value::as_array)
        .ok_or("scenario: commands must be an array")?;
    for (i, c) in commands.iter().enumerate() {
        let where_ = format!("command {i}");
        if !c.is_object() {
            return Err(format!("{where_}: must be an object"));
        }
        let op = c.get("op").and_then(Value::as_str);
        let spec = op.and_then(op_spec).ok_or_else(|| {
            format!(
                "{where_}: unknown op {}",
                c.get("op").unwrap_or(&Value::Null)
            )
        })?;
        check_fields(&where_, c, spec, &["op"])?;
        if op == Some("buildRow") && c["from"].as_i64() > c["to"].as_i64() {
            return Err(format!("{where_}: buildRow from must not be past to"));
        }
    }
    Ok(())
}

/// `Number.isInteger(1.0)` is true, so a scenario may spell a whole number
/// with a fraction; serde's integer fields would refuse it. Whole floats
/// outside the i64 range stay floats and fail the integer checks, where the
/// TypeScript would accept them and fail the command instead.
pub(super) fn whole_floats_to_ints(v: &mut Value) {
    match v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if n.as_i64().is_none() && f.fract() == 0.0 && f.abs() < i64::MAX as f64 {
                    *v = Value::from(f as i64);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(whole_floats_to_ints),
        Value::Object(o) => o.values_mut().for_each(whole_floats_to_ints),
        _ => {}
    }
}
