//! Reading one serialized unit into a gathered room.

use serde_json::Value;

use super::{js_finite, js_num, js_num_raw_site, js_truthy, GatheredRoom};
use crate::facilities::Kind;
use crate::tdt::format::TDT_FLOOR_OFFSET;
use crate::tdt::LegacyExportError;

/// `fitsTdtRows`: every story of a footprint sits on a writable row (0..109).
pub(super) fn fits_tdt_rows(floor: f64, stories: f64) -> bool {
    let bottom = floor + TDT_FLOOR_OFFSET as f64;
    bottom >= 0.0 && bottom + stories - 1.0 <= 109.0
}

/// `residentCount(u)`: the household when one is set, else the catalog
/// population.
pub(super) fn resident_count(u: &GatheredRoom) -> f64 {
    if (u.kind == Kind::Condo || u.kind == Kind::RentalApartment) && u.residents.is_some() {
        return u.residents.unwrap_or(f64::NAN);
    }
    u.kind.facility().population as f64
}

pub(super) fn is_present(state: &str) -> bool {
    matches!(state, "occupied" | "asleep" | "moving_in" | "vacating")
}

/// `norm(u)`: the serialized unit with the loader's defaults applied.
pub(super) fn norm(raw: &Value) -> Result<GatheredRoom, LegacyExportError> {
    let kind_str = raw.get("kind").and_then(Value::as_str).unwrap_or("");
    let Some(kind) = Kind::parse(kind_str) else {
        // Quoted as JSON quotes it, so the TypeScript exporter can write the
        // same message with `JSON.stringify` (#887).
        let quoted = serde_json::to_string(kind_str).unwrap_or_default();
        return Err(LegacyExportError(format!(
            "unit kind {quoted} is not in the catalog"
        )));
    };
    let nullish = |k: &str| matches!(raw.get(k), None | Some(Value::Null));
    let (width, width_finite) = if nullish("width") {
        (kind.facility().width as f64, true)
    } else {
        (
            js_num_raw_site(raw.get("width")),
            js_finite(raw.get("width")).is_some(),
        )
    };
    let state = if nullish("state") {
        "empty".to_string()
    } else {
        raw.get("state")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let occupants = if nullish("occupants") {
        0.0
    } else {
        js_num(raw.get("occupants"))
    };
    let ever_occupied = if nullish("everOccupied") {
        false
    } else {
        js_truthy(raw.get("everOccupied"))
    };
    Ok(GatheredRoom {
        kind,
        floor: js_num_raw_site(raw.get("floor")),
        x: js_num_raw_site(raw.get("x")),
        width,
        coords_finite: js_finite(raw.get("x")).is_some() && width_finite,
        state,
        occupants,
        ever_occupied,
        label: raw.get("label").and_then(Value::as_str).map(str::to_string),
        rent: raw.get("rent").cloned(),
        no_rate: js_truthy(raw.get("noRate")),
        subtype: raw
            .get("subtype")
            .and_then(Value::as_str)
            .map(str::to_string),
        residents: raw
            .get("residents")
            .map(|v| js_finite(Some(v)).unwrap_or(f64::NAN)),
        emitted: false,
        skip_reason: None,
    })
}
