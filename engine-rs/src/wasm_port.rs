//! The engine's own port (facade slice 7; the contract is
//! `architecture-rust-facade-2026-10-20/engine-port-contract.md`): the
//! commands and queries the game calls on `Engine` directly, with no
//! TypeScript adapter between and no JSON on a path that runs per frame, per
//! pointer move, per UI tick or per command.
//!
//! Every argument is a number (a facility kind is its code, its index in the
//! view layout's `kinds`), read raw as `crate::charges::whole` reads it, so a
//! value that is not a whole JS number within `Number.isSafeInteger` is
//! refused, never coerced. A command answers a result record: slot
//! [`STATUS`] is 1 when it was done and 0 when it was refused, slot
//! [`DELTA`] the change in the balance the engine measured around it (0 on a
//! refusal), and the op's own slots follow. A refusal's text is
//! `lastReason()`. Only the members that answer a status (the commands and
//! the quotes) clear it at their start, so view and text reads between a
//! refusal and its display never lose it. A query answers a record of
//! numbers whose slots the layout names. `wasm.rs` holds the bindings; the logic is here so native tests
//! reach it.
use crate::brush::{BrushResult, BRUSH_TILE_LIMIT};
use crate::charges::{whole, ExtendEnd, INVALID_REQUEST};
use crate::facilities::{Kind, FACILITIES};
use crate::gameplay::RemovalMethod;
use crate::services::ExterminatorRefusal;

use super::facade_commands::UNKNOWN_FACILITY;
use super::port_edit::BATCH_SLOTS;
use super::Engine;

/// A result record's slots: done (1) or refused (0), then the balance's change.
pub(crate) const STATUS: usize = 0;
pub(crate) const DELTA: usize = 1;

/// The film policies by code, as `setFilm` takes them.
pub(crate) const FILM_POLICIES: [&str; 3] = ["auto", "feature", "blockbuster"];

/// The onboarding facts by bit, as `onboarding()` packs them.
pub(crate) const ONBOARDING: [&str; 5] = ["lobby", "floor", "office", "connect", "play"];

/// Each command's own slots after [`DELTA`], for the view layout.
pub(crate) const COMMAND_RECORDS: [(&str, &[&str]); 26] = [
    ("buildAt", &[]),
    ("paintTiles", &["placed"]),
    ("buildShaft", &[]),
    ("demolish", &[]),
    ("changeCars", &["cars"]),
    ("extendShaft", &["bottom", "top", "added"]),
    ("bookExterminator", &["cost", "rooms"]),
    ("setCamera", &[]),
    ("setFilm", &["policyCode"]),
    ("markStop", &[]),
    ("expressStops", &[]),
    ("dropStops", &[]),
    ("stepRent", &["rent"]),
    ("noRate", &[]),
    ("setRent", &["rent"]),
    ("rentBatch", &BATCH_SLOTS),
    ("rerollUnit", &["subtypeCode"]),
    ("answerChoice", &[]),
    ("chooseAutoBridge", &["value"]),
    ("flipAutoBridge", &["value"]),
    ("startExtend", &[]),
    ("stopExtend", &[]),
    ("labelUnit", &[]),
    ("nameTower", &[]),
    ("logLine", &[]),
    ("scheduleShaft", &[]),
];

/// Each query record's slots, for the view layout.
const QUERY_RECORDS: [(&str, &[&str]); 10] = [
    ("quoteBuild", &["ok", "cost"]),
    ("quoteShaft", &["ok"]),
    ("hotspot", &["ratio", "floor"]),
    ("loadSave", &["status", "generation"]),
    ("restore", &["status", "generation"]),
    ("foundTower", &["status", "generation"]),
    ("drainEvents", &["dropped", "count"]),
    ("advance", &["steps", "owed"]),
    // A header, then the changed ids.
    ("unitMetaChanged", &["revision", "full"]),
    // One entry per log line, repeated.
    ("logAfter", &["seq", "kindCode", "minute"]),
];

/// The port's records and codes in the view layout, under `records`: each
/// command's slots (`status`, `delta`, then its own), each query record's
/// slots and the HUD strip's counters; then the onboarding bits and the film
/// policies.
pub(crate) fn add_records(layout: &mut serde_json::Value) {
    let mut records: serde_json::Map<String, serde_json::Value> = COMMAND_RECORDS
        .iter()
        .map(|(op, own)| {
            let slots: Vec<&str> = ["status", "delta"]
                .iter()
                .chain(own.iter())
                .copied()
                .collect();
            ((*op).to_owned(), serde_json::json!(slots))
        })
        .collect();
    for (op, slots) in QUERY_RECORDS {
        records.insert(op.to_owned(), serde_json::json!(slots));
    }
    records.insert(
        "statsStrip".to_owned(),
        serde_json::json!(crate::panels::stats::TOWER_STATS),
    );
    layout["records"] = serde_json::Value::Object(records);
    layout["onboarding"] = serde_json::json!(ONBOARDING);
    layout["filmPolicies"] = serde_json::json!(FILM_POLICIES);
    layout["logKinds"] = serde_json::json!(super::port_life::LOG_KINDS);
    layout["scheduleSlots"] = serde_json::json!(super::port_life::SCHEDULE_LEN);
    super::port_panels::add_panel_records(layout);
    super::port_files::add_file_records(layout);
}

/// The layout `viewLayout()` hands over: the view's, with the port's
/// records and codes. `VIEW_LAYOUT_VERSION` covers both, and
/// `wasm_port_tests.rs` pins this whole text.
pub(crate) fn exported_layout() -> serde_json::Value {
    let mut layout = crate::view::layout_json();
    add_records(&mut layout);
    layout
}

/// A facility kind from its layout code.
pub(crate) fn kind_of(code: f64) -> Option<Kind> {
    let i = usize::try_from(whole(code)?).ok()?;
    FACILITIES.get(i).map(|f| f.kind)
}

/// A JSON number as `JSON.stringify` spells it: a whole value within the
/// safe integers without a fraction, so a saved camera reads the same from
/// either engine.
fn number(v: f64) -> serde_json::Value {
    match whole(v) {
        Some(n) => serde_json::json!(n),
        None => serde_json::json!(v),
    }
}

/// A command's answer: status, delta, then its own slots.
pub(crate) fn record(done: bool, delta: f64, own: &[f64]) -> Vec<f64> {
    let mut r = vec![0.0; DELTA + 1 + own.len()];
    r[STATUS] = f64::from(u8::from(done));
    r[DELTA] = delta;
    r[DELTA + 1..].copy_from_slice(own);
    r
}

impl Engine {
    /// The answer to a command begun at balance `before`: done, or refused
    /// with `reason` (`INVALID_REQUEST` when the engine gave none).
    pub(crate) fn finish(
        &mut self,
        before: f64,
        done: bool,
        reason: Option<String>,
        own: &[f64],
    ) -> Vec<f64> {
        if !done {
            self.reason = Some(reason.unwrap_or_else(|| INVALID_REQUEST.into()));
        }
        record(done, self.sim.money - before, own)
    }

    pub(crate) fn refuse(&mut self, reason: &str, own: &[f64]) -> Vec<f64> {
        self.reason = Some(reason.into());
        record(false, 0.0, own)
    }

    /// The text of the last refusal, cleared by the next status-producing call.
    pub(crate) fn last_reason_text(&self) -> Option<String> {
        self.reason.clone()
    }

    pub(crate) fn port_build(&mut self, kind: f64, floor: f64, x: f64) -> Vec<f64> {
        self.reason = None;
        let Some(kind) = kind_of(kind) else {
            return self.refuse(UNKNOWN_FACILITY, &[]);
        };
        let (Some(floor), Some(x)) = (whole(floor), whole(x)) else {
            return self.refuse(INVALID_REQUEST, &[]);
        };
        let before = self.sim.money;
        let r = self.sim.build(kind, floor, x);
        self.finish(before, r.ok, r.reason, &[])
    }

    /// The floor and lobby brush in one call: done when any tile was laid,
    /// with the count; a strip with nothing laid is refused with its reason.
    pub(crate) fn port_paint(&mut self, kind: f64, floor: f64, tiles: &[f64]) -> Vec<f64> {
        self.reason = None;
        if kind_of(kind).is_none() {
            return self.refuse(UNKNOWN_FACILITY, &[0.0]);
        }
        let tiles: Option<Vec<i64>> = (tiles.len() <= BRUSH_TILE_LIMIT)
            .then(|| tiles.iter().map(|&t| whole(t)).collect())
            .flatten();
        let before = self.sim.money;
        let r = match (kind_of(kind), whole(floor), tiles) {
            (Some(kind), Some(floor), Some(tiles)) => self.sim.paint_brush(kind, floor, &tiles),
            _ => BrushResult::invalid(),
        };
        let placed = r.placed as f64;
        self.finish(before, r.placed > 0, r.reason, &[placed])
    }

    pub(crate) fn port_build_shaft(
        &mut self,
        kind: f64,
        x: f64,
        bottom: f64,
        top: f64,
    ) -> Vec<f64> {
        self.reason = None;
        let Some(kind) = kind_of(kind) else {
            return self.refuse(UNKNOWN_FACILITY, &[]);
        };
        let (Some(x), Some(bottom), Some(top)) = (whole(x), whole(bottom), whole(top)) else {
            return self.refuse(INVALID_REQUEST, &[]);
        };
        let before = self.sim.money;
        let r = self.sim.build_transport(kind, x, bottom, top);
        self.finish(before, r.ok, r.reason, &[])
    }

    /// A sell or bulldoze by id; the delta is the refund.
    pub(crate) fn port_demolish(&mut self, id: f64, bulldoze: bool) -> Vec<f64> {
        self.reason = None;
        let Some(id) = whole(id) else {
            return self.refuse(INVALID_REQUEST, &[]);
        };
        let method = if bulldoze {
            RemovalMethod::Bulldoze
        } else {
            RemovalMethod::Sell
        };
        let before = self.sim.money;
        let r = self.sim.remove_facility(id, method);
        self.finish(before, r.ok, r.reason, &[])
    }

    /// One car more (`add`) or fewer on an elevator, with the cars it has after.
    pub(crate) fn port_cars(&mut self, id: f64, add: bool) -> Vec<f64> {
        self.reason = None;
        let Some(id) = whole(id) else {
            return self.refuse(INVALID_REQUEST, &[0.0]);
        };
        let before = self.sim.money;
        let r = if add {
            self.sim.add_car(id)
        } else {
            self.sim.remove_car(id)
        };
        let cars = self.sim.tower.get_transport(id).map_or(0, |t| t.cars) as f64;
        self.finish(before, r.ok, r.reason, &[cars])
    }

    /// Move an elevator's end toward a floor, with its ends after and the
    /// floors added past the gesture's high-water mark; a refusal gives the
    /// ends as they stand.
    pub(crate) fn port_extend(&mut self, id: f64, up: bool, target: f64) -> Vec<f64> {
        self.reason = None;
        let (Some(id), Some(target)) = (whole(id), whole(target)) else {
            let ends = whole(id)
                .and_then(|id| self.sim.tower.get_transport(id))
                .map_or([0.0, 0.0], |t| [t.bottom as f64, t.top as f64]);
            return self.refuse(INVALID_REQUEST, &[ends[0], ends[1], 0.0]);
        };
        let end = if up { ExtendEnd::Up } else { ExtendEnd::Down };
        let before = self.sim.money;
        let r = self.sim.extend_transport(id, end, target);
        let own = [r.bottom as f64, r.top as f64, r.added as f64];
        self.finish(before, r.charge.ok, r.charge.reason, &own)
    }

    /// Book the exterminator, with its cost and the rooms it treats. A
    /// refusal for want of funds is "funds" and still carries both, as the
    /// TypeScript answer does.
    pub(crate) fn port_book_exterminator(&mut self) -> Vec<f64> {
        self.reason = None;
        let before = self.sim.money;
        match self.sim.call_exterminator() {
            Ok((cost, rooms)) => self.finish(before, true, None, &[cost, rooms as f64]),
            Err(ExterminatorRefusal::Funds { cost, rooms }) => {
                self.refuse("funds", &[cost, rooms as f64])
            }
            Err(other) => self.refuse(other.reason(), &[0.0, 0.0]),
        }
    }

    /// Store the camera: its center as finite tile and floor coordinates
    /// (fractional, as the renderer's `viewState()` gives them) and `zoom` a
    /// finite number above 0, or NaN when the view carries none.
    pub(crate) fn port_set_camera(&mut self, tile: f64, floor: f64, zoom: f64) -> Vec<f64> {
        self.reason = None;
        let zoom_ok = zoom.is_nan() || (zoom.is_finite() && zoom > 0.0);
        if !(tile.is_finite() && floor.is_finite() && zoom_ok) {
            return self.refuse(INVALID_REQUEST, &[]);
        }
        let mut v = serde_json::json!({ "tile": number(tile), "floor": number(floor) });
        if !zoom.is_nan() {
            v["zoom"] = number(zoom);
        }
        self.sim.view = Some(v);
        record(true, 0.0, &[])
    }

    /// A cinema's film policy by code ([`FILM_POLICIES`]), with the code stored.
    pub(crate) fn port_set_film(&mut self, id: f64, policy: f64) -> Vec<f64> {
        self.reason = None;
        let code = whole(policy)
            .and_then(|p| usize::try_from(p).ok())
            .filter(|&p| p < FILM_POLICIES.len());
        let (Some(id), Some(code)) = (whole(id), code) else {
            return self.refuse(INVALID_REQUEST, &[f64::NAN]);
        };
        match self.sim.set_film_policy(id, FILM_POLICIES[code]) {
            Some(_) => record(true, 0.0, &[code as f64]),
            None => self.refuse(INVALID_REQUEST, &[f64::NAN]),
        }
    }

    /// `[ok, cost]` for a placement, the dry run `build` makes first; a
    /// refusal's text is `lastReason()`. An unknown kind costs 0.
    pub(crate) fn port_quote_build(&mut self, kind: f64, floor: f64, x: f64) -> [f64; 2] {
        self.reason = None;
        let Some(kind) = kind_of(kind) else {
            self.reason = Some(UNKNOWN_FACILITY.into());
            return [0.0, 0.0];
        };
        let (Some(floor), Some(x)) = (whole(floor), whole(x)) else {
            self.reason = Some(INVALID_REQUEST.into());
            return [0.0, 0.0];
        };
        let c = self.sim.can_build(kind, floor, x);
        if !c.ok {
            self.reason = c.reason;
        }
        [f64::from(u8::from(c.ok)), c.cost]
    }

    /// Whether a shaft would be accepted, nothing written: 1, or 0 with the
    /// reason in `lastReason()`.
    pub(crate) fn port_quote_shaft(&mut self, kind: f64, x: f64, bottom: f64, top: f64) -> f64 {
        self.reason = None;
        let Some(kind) = kind_of(kind) else {
            self.reason = Some(UNKNOWN_FACILITY.into());
            return 0.0;
        };
        let (Some(x), Some(bottom), Some(top)) = (whole(x), whole(bottom), whole(top)) else {
            self.reason = Some(INVALID_REQUEST.into());
            return 0.0;
        };
        let r = self.sim.tower.validate_transport(kind, x, bottom, top);
        if !r.ok {
            self.reason = Some(r.reason.unwrap_or_else(|| INVALID_REQUEST.into()));
        }
        f64::from(u8::from(r.ok))
    }

    /// `[ratio, floor]` for the busiest served floor, the floor NaN when none.
    pub(crate) fn port_hotspot(&self) -> [f64; 2] {
        let (ratio, floor) = self.sim.peak_congestion();
        [ratio, floor.map_or(f64::NAN, |f| f as f64)]
    }

    /// The onboarding facts as bits in [`ONBOARDING`] order.
    pub(crate) fn port_onboarding(&self) -> f64 {
        self.sim
            .onboarding_flags()
            .iter()
            .enumerate()
            .filter(|(_, on)| **on)
            // A fold from 0, since an empty float `sum` is -0.
            .fold(0.0, |bits, (i, _)| bits + f64::from(1u8 << i))
    }
}

#[cfg(test)]
#[path = "wasm_port_tests.rs"]
mod tests;
