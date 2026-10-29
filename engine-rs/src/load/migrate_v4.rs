//! The version 4 to 5 migration.

use super::*;

#[derive(Clone, Copy)]
pub(super) struct Fp {
    x: i64,
    w: i64,
    bottom: i64,
    top: i64,
}

/// `widenLegacyElevatorShafts`.
pub fn widen_legacy_elevator_shafts(data: &Value) -> Value {
    let transports = data.get("transports").and_then(Value::as_array);
    match transports.and_then(|t| widen_shafts(t)) {
        Some(out) => with(data, vec![("transports", Value::Array(out))]),
        None => data.clone(),
    }
}

/// `widen_legacy_elevator_shafts` on a save this call owns.
pub(super) fn widen_shafts_in_place(data: &mut Value) {
    let widened = data
        .get("transports")
        .and_then(Value::as_array)
        .and_then(|t| widen_shafts(t));
    if let (Some(out), Some(m)) = (widened, data.as_object_mut()) {
        m.insert("transports".to_string(), Value::Array(out));
    }
}

/// The transports `widen_legacy_elevator_shafts` writes back, or `None` when
/// the list is longer than the pools hold and it leaves the save as it is.
pub(crate) fn widen_shafts(transports: &[Value]) -> Option<Vec<Value>> {
    let pool_cap: i64 = POOLED_CAPS.iter().map(|p| p.cap).sum();
    if transports.len() as i64 > pool_cap {
        return None;
    }
    let mut fps: Vec<Option<Fp>> = transports
        .iter()
        .map(|t| {
            let kind = kind_of(t)?;
            let catalog_w = kind.facility().width;
            let bottom = (round(num(t.get("bottom"), 1.0)) as i64).clamp(MIN_FLOOR, MAX_FLOOR - 1);
            let top = (round(num(t.get("top"), (bottom + 1) as f64)) as i64)
                .min(MAX_FLOOR)
                .max(bottom + 1);
            let w0 = round(num(t.get("width"), catalog_w as f64)) as i64;
            let w = if w0 > 0 { w0.min(catalog_w) } else { catalog_w };
            let x = (round(num(t.get("x"), 0.0)) as i64).clamp(0, LOT - w);
            Some(Fp { x, w, bottom, top })
        })
        .collect();
    let collides = |a: &Fp, b: &Fp| {
        a.x < b.x + b.w && b.x < a.x + a.w && a.bottom <= b.top && b.bottom <= a.top
    };
    let mut out: Vec<Value> = Vec::new();
    for i in 0..transports.len() {
        let t = &transports[i];
        let Some(fp) = fps[i] else {
            out.push(t.clone());
            continue;
        };
        let kind = kind_of(t).unwrap();
        if !kind.is_elevator() {
            out.push(t.clone());
            continue;
        }
        let canon_w = kind.facility().width;
        if fp.w >= canon_w {
            out.push(t.clone());
            continue;
        }
        let mut widened: Option<Value> = None;
        for shift in 0..=canon_w - fp.w {
            let cand = Fp {
                x: fp.x - shift,
                w: canon_w,
                bottom: fp.bottom,
                top: fp.top,
            };
            if cand.x < 0 || cand.x + cand.w > LOT {
                continue;
            }
            let fits =
                (0..fps.len()).all(|j| j == i || fps[j].is_none_or(|o| !collides(&cand, &o)));
            if fits {
                fps[i] = Some(cand);
                widened = Some(with(
                    t,
                    vec![("x", json!(cand.x)), ("width", json!(canon_w))],
                ));
                break;
            }
        }
        out.push(widened.unwrap_or_else(|| t.clone()));
    }
    Some(out)
}
