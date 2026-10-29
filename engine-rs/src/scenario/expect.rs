//! The runner's expectations and lookups, shared by the commands.

use crate::sim::Simulation;
use serde_json::Value;

/// The id of the shaft covering a tile, or the runner's "no transport" error.
pub(super) fn transport_id_at(sim: &Simulation, floor: i64, x: i64) -> Result<i64, String> {
    sim.tower
        .transport_at(floor, x)
        .map(|t| t.id)
        .ok_or_else(|| format!("no transport at floor {floor}, x {x}"))
}

/// The id of the unit covering a tile, or the runner's "no unit" error.
pub(super) fn unit_id_at(sim: &Simulation, floor: i64, x: i64) -> Result<i64, String> {
    sim.tower
        .unit_at(floor, x)
        .map(|u| u.id)
        .ok_or_else(|| format!("no unit at floor {floor}, x {x}"))
}

pub(super) fn expect_ok(
    ok: bool,
    expect_fail: bool,
    what: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    if ok == !expect_fail {
        return Ok(());
    }
    Err(if ok {
        format!("{what} succeeded but was expected to fail")
    } else {
        format!("{what} failed: {}", reason.unwrap_or("no reason"))
    })
}

/// A result against `expectFail` and, when the scenario names a `reason`, the
/// exact refusal reason, so an engine that refuses for another reason (or
/// checks the gates in another order) fails.
pub(super) fn expect_outcome(
    ok: bool,
    got: Option<&str>,
    expect_fail: &Option<bool>,
    want: &Option<String>,
    what: &str,
) -> Result<(), String> {
    let fail = expect_fail.unwrap_or(false);
    if want.is_some() && !fail {
        return Err(format!("{what}: a reason needs expectFail"));
    }
    expect_ok(ok, fail, what, got)?;
    match want {
        Some(w) if got != Some(w.as_str()) => Err(format!(
            "{what} was refused for {:?}, expected {w:?}",
            got.unwrap_or("no reason")
        )),
        _ => Ok(()),
    }
}

/// The buffered events may be hashed: none was pushed out of a full ring
/// (the scenario must checkpoint more often), and each is one the catalog
/// describes (`conformance/events/catalog.json`).
pub(super) fn events_fit(sim: &Simulation) -> Result<(), String> {
    use crate::gameplay::{check_catalog, check_event, CATALOG_JSON, GAMEPLAY_RING_CAP};
    static CATALOG: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    if sim.gameplay.dropped > 0 {
        return Err(format!(
            "more than {GAMEPLAY_RING_CAP} gameplay events between two checkpoints; checkpoint more often"
        ));
    }
    let catalog = CATALOG.get_or_init(|| {
        let c: Value = serde_json::from_str(CATALOG_JSON).expect("the catalog parses");
        check_catalog(&c).expect("the catalog is valid");
        c
    });
    for e in sim.gameplay.iter() {
        check_event(catalog, &e.to_json())?;
    }
    Ok(())
}

/// `expectCharge`: a charge op lands, or, when the scenario names a reason,
/// is refused with exactly that reason, so both engines' copy is pinned.
/// Either way the balance must have moved by exactly the reported delta.
pub(super) fn expect_charge(
    r: &crate::charges::ChargeResult,
    reason: &Option<String>,
    what: &str,
    moved: f64,
) -> Result<(), String> {
    if moved != r.delta {
        return Err(format!(
            "{what}: the balance moved {moved} but the command reported {}",
            r.delta
        ));
    }
    if !r.ok && r.delta != 0.0 {
        return Err(format!(
            "{what}: refused but reported a delta of {}",
            r.delta
        ));
    }
    let Some(want) = reason else {
        return expect_ok(r.ok, false, what, r.reason.as_deref());
    };
    if r.ok {
        return Err(format!(
            "{what} succeeded but was expected to fail with {want}"
        ));
    }
    if r.reason.as_deref() != Some(want.as_str()) {
        return Err(format!(
            "{what} failed with {}, expected {want}",
            r.reason.as_deref().unwrap_or("no reason")
        ));
    }
    Ok(())
}
