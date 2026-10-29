//! The JavaScript binding: the engine behind a narrow, Simulation-shaped
//! surface that `wasm-bindgen` turns into a module. Structured values cross
//! as JSON text so the surface stays small and the glue stays generated.
//! Nothing here simulates anything; every method forwards to the engine.
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::facilities::Kind;
pub use crate::frame::{frame_view, log_since, FRAME_HEADER, PERSON_FIXED, UNKNOWN_ROUTINE};
use crate::load_stream::parse_mode;
use crate::save_delta::SaveMirror;
use crate::sim::Simulation;

/// Every failure crosses as a JavaScript error with its message; the helpers
/// below carry plain strings so they can be tested natively, and the methods
/// convert at the boundary.
fn err(what: impl std::fmt::Display) -> JsError {
    JsError::new(&what.to_string())
}

fn parse_kind(s: &str) -> Result<Kind, String> {
    Kind::parse(s).ok_or_else(|| format!("unknown facility kind {s}"))
}

/// `{ ok, reason? }` as the TypeScript `BuildResult` spells it.
fn outcome(ok: bool, reason: Option<&str>) -> String {
    let v = match reason {
        Some(reason) => serde_json::json!({ "ok": ok, "reason": reason }),
        None => serde_json::json!({ "ok": ok }),
    };
    v.to_string()
}

fn build_result(r: crate::build::BuildResult) -> String {
    outcome(r.ok, r.reason.as_deref())
}

/// A resize result as TypeScript spells it: `{ ok: true, added,
/// floorTilesCreated }`, or `{ ok: false, reason }` for a refusal (#996).
fn resize_json(r: crate::tower::ResizeResult) -> String {
    if !r.ok {
        let mut v = serde_json::json!({ "ok": false });
        if let Some(reason) = r.reason {
            v["reason"] = Value::String(reason);
        }
        return v.to_string();
    }
    serde_json::json!({
        "ok": true,
        "added": r.added,
        "floorTilesCreated": r.floor_tiles_created,
    })
    .to_string()
}

#[path = "wasm_relay.rs"]
mod relay;
#[path = "wasm_sync.rs"]
mod sync;

/// `canBuild`'s answer as the TypeScript spells it: `{ ok, reason?, cost }`.
fn can_build_json(ok: bool, reason: Option<&str>, cost: f64) -> String {
    let mut v = serde_json::json!({ "ok": ok, "cost": cost });
    if let Some(reason) = reason {
        v["reason"] = Value::String(reason.into());
    }
    v.to_string()
}

/// `ChargeResult` as the TypeScript spells it: `{ ok, reason?, delta }`.
fn charge_json(r: &crate::charges::ChargeResult) -> Value {
    let mut v = serde_json::json!({ "ok": r.ok, "delta": r.delta });
    if let Some(reason) = &r.reason {
        v["reason"] = Value::String(reason.clone());
    }
    v
}

/// `ExtendResult`: the charge plus `bottom`, `top` and `added`.
fn extend_json(r: &crate::charges::ExtendResult) -> Value {
    let mut v = charge_json(&r.charge);
    v["bottom"] = r.bottom.into();
    v["top"] = r.top.into();
    v["added"] = r.added.into();
    v
}

/// The refusal JSON for a malformed charge command (#923).
fn invalid_charge() -> String {
    charge_json(&crate::charges::ChargeResult::refuse(
        crate::charges::INVALID_REQUEST,
    ))
    .to_string()
}

/// The charge commands behind the binding, on arguments already read off
/// their `JsValue`s: a number is `Some` only for a JS number and a string
/// only for a JS string (`JsValue::as_f64`, `as_string`), so a numeric
/// string, `null`, a boolean or a missing argument reaches here as `None`
/// and is refused with `INVALID_REQUEST`, the TypeScript engine's answer.
/// Native tests call these directly; `JsValue` itself needs a wasm target.
impl Engine {
    pub(crate) fn add_car_checked(&mut self, id: Option<f64>) -> String {
        match id.and_then(crate::charges::whole) {
            Some(id) => charge_json(&self.sim.add_car(id)).to_string(),
            None => invalid_charge(),
        }
    }

    pub(crate) fn remove_car_checked(&mut self, id: Option<f64>) -> String {
        match id.and_then(crate::charges::whole) {
            Some(id) => charge_json(&self.sim.remove_car(id)).to_string(),
            None => invalid_charge(),
        }
    }

    /// `beginExtend`: a malformed id opens no gesture and drops any open
    /// one, as TypeScript's does.
    pub(crate) fn begin_extend_checked(&mut self, id: Option<f64>) -> bool {
        match id.and_then(crate::charges::whole) {
            Some(id) => self.sim.begin_extend(id),
            None => {
                self.sim.end_extend();
                false
            }
        }
    }

    pub(crate) fn extend_checked(
        &mut self,
        id: Option<f64>,
        end: Option<String>,
        target_floor: Option<f64>,
    ) -> String {
        use crate::charges::{whole, ChargeResult, ExtendEnd, ExtendResult, INVALID_REQUEST};
        let id_whole = id.and_then(whole);
        let end = end.as_deref().and_then(ExtendEnd::parse);
        let r = match (id_whole, end, target_floor.and_then(whole)) {
            (Some(id), Some(end), Some(target)) => self.sim.extend_transport(id, end, target),
            _ => {
                let (bottom, top) = id_whole
                    .and_then(|id| self.sim.tower.get_transport(id))
                    .map_or((0, 0), |t| (t.bottom, t.top));
                ExtendResult {
                    charge: ChargeResult::refuse(INVALID_REQUEST),
                    bottom,
                    top,
                    added: 0,
                }
            }
        };
        extend_json(&r).to_string()
    }

    pub(crate) fn remove_facility_checked(
        &mut self,
        id: Option<f64>,
        method: Option<String>,
    ) -> String {
        let method = method
            .as_deref()
            .and_then(crate::gameplay::RemovalMethod::parse);
        match (id.and_then(crate::charges::whole), method) {
            (Some(id), Some(method)) => {
                charge_json(&self.sim.remove_facility(id, method)).to_string()
            }
            _ => invalid_charge(),
        }
    }
}

/// `{ kind, cost, message }` for the choice the engine is waiting on.
fn pending_json(kind: &str, cost: f64, message: &str) -> String {
    serde_json::json!({ "kind": kind, "cost": cost, "message": message }).to_string()
}

/// A batch rent target as its JSON text: `"default"`, `"noRate"` or a number.
fn parse_batch_target(text: &str) -> Result<crate::rent::BatchTarget, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("target: {e}"))?;
    match v {
        Value::String(s) if s == "default" => Ok(crate::rent::BatchTarget::Default),
        Value::String(s) if s == "noRate" => Ok(crate::rent::BatchTarget::NoRate),
        Value::Number(n) => n
            .as_f64()
            .map(crate::rent::BatchTarget::Price)
            .ok_or_else(|| "target must be a finite number".to_string()),
        other => Err(format!(
            "target must be default, noRate or a number, got {other}"
        )),
    }
}

/// `BatchRentResult` as the TypeScript spells its keys.
fn batch_result_json(r: &crate::rent::BatchRentResult) -> String {
    serde_json::json!({
        "matched": r.matched,
        "eligible": r.eligible,
        "changed": r.changed,
        "skippedSold": r.skipped_sold,
        "skippedCustom": r.skipped_custom,
        "customOverwritten": r.custom_overwritten,
        "clampedLow": r.clamped_low,
        "clampedHigh": r.clamped_high,
    })
    .to_string()
}

/// The transient boundary markers a shadow takes over from the live engine.
fn apply_markers(sim: &mut Simulation, text: &str) -> Result<(), String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("markers: {e}"))?;
    let field = |name: &str| -> Result<i64, String> {
        v.get(name)
            .and_then(Value::as_f64)
            .filter(|x| x.fract() == 0.0 && x.abs() < 9007199254740992.0)
            .map(|x| x as i64)
            .ok_or_else(|| format!("markers: {name} must be a whole number"))
    };
    sim.last_hour = field("lastHour")?;
    sim.last_day = field("lastDay")?;
    sim.last_quarter = field("lastQuarter")?;
    sim.last_month = field("lastMonth")?;
    // The live engine's commute-stress averages (#1083); absent or null
    // keeps the empty map a load starts with.
    if let Some(rows) = v.get("commuteStress").filter(|r| !r.is_null()) {
        sim.crowd
            .seed_commute_stress(rows)
            .map_err(|e| format!("markers: {e}"))?;
    }
    // The live engine's open extend gesture (#990); absent or null is none.
    match v.get("extendGesture") {
        None | Some(Value::Null) => sim.end_extend(),
        Some(g) => {
            let part = |name: &str| -> Result<i64, String> {
                g.get(name)
                    .and_then(Value::as_f64)
                    .and_then(crate::charges::whole)
                    .ok_or_else(|| format!("markers: extendGesture.{name} must be a whole number"))
            };
            sim.restore_extend(part("id")?, part("bottom")?, part("top")?);
        }
    }
    Ok(())
}

/// The catalog text for a mode, as [`catalog`] returns it.
fn catalog_text(mode: &str) -> Result<String, String> {
    Ok(crate::catalog::catalog_json(parse_mode(mode)?))
}

/// Every price, size and build rule a frontend shows, resolved for `mode`
/// (`classic` or `modern`), as canonical JSON in the shape of the `Catalog`
/// type (declared in `src/engine/catalogTypes.ts`, read through `readCatalog`
/// in `src/dualrun/catalog.ts`; see `verticopolis_engine::catalog`). It needs
/// no running game.
#[wasm_bindgen]
pub fn catalog(mode: &str) -> Result<String, JsError> {
    catalog_text(mode).map_err(err)
}

/// Which engine this is and which contracts it speaks, as canonical JSON in
/// the shape of `verticopolis_engine::identity::identity`: the record's
/// schema, the crate's name and version, the save version it writes and the
/// oldest it loads, the frame layout version, the catalog version with each
/// mode's digest, and the conformance lock digest. It needs no running game
/// and holds no build hash: a hash of the sources cannot be compiled into
/// them, so the served package's `BUILD.json` records it.
#[wasm_bindgen(js_name = engineIdentity)]
pub fn engine_identity() -> String {
    crate::identity::identity_json()
}

/// One running simulation. Construct with `newGame`, `fromSave` or
/// `fromVctower`; drive it with the command methods; read it back with
/// `serialize` and the two hashed views.
#[wasm_bindgen]
pub struct Engine {
    sim: Simulation,
    mirror: SaveMirror,
    /// The text of the last port refusal (`wasm_port.rs`).
    reason: Option<String>,
    /// Moves on every done tower swap (`wasm_port_life.rs`).
    generation: u64,
    /// Whether the current tower is the title screen's scenery.
    backdrop: bool,
    /// The batch the last `drainEvents()` took, for `eventText(i)`.
    drained: Vec<crate::gameplay::GameplayEvent>,
    /// A `.TDT` file read by `loadTdt`, waiting for `adoptTdt`.
    staged_tdt: Option<Box<port_files::StagedTdt>>,
    /// The bytes the last `tdtExport` wrote, for `tdtFile()`; a done swap
    /// drops them.
    tdt_file: Option<Vec<u8>>,
    /// The step mode `advance` last stepped under; it outlives a swap, as
    /// the web host's step debt outlives an adopted tower.
    stepper: crate::fixed_step::FrameStepper,
    /// The last `queueView` and `congestion` answers and their keys.
    render_memo: port_render::RenderMemo,
}

/// `importTdt(bytes, filename)`: a 1994 `.TDT` file as JSON text
/// `{ "save": <serialized game>, "warnings": [...] }`, where `save` is what
/// `fromSave` takes. A file that cannot be read is a JavaScript error with
/// the player-readable message.
#[wasm_bindgen(js_name = importTdt)]
pub fn import_tdt(bytes: &[u8], filename: &str) -> Result<String, JsError> {
    // The same entry point a native host calls, so the two cannot drift.
    let (save, warnings) = crate::tdt::import_tdt(bytes, filename).map_err(err)?;
    let warnings = serde_json::to_string(&warnings).map_err(err)?;
    Ok(format!("{{\"save\":{save},\"warnings\":{warnings}}}"))
}

/// `exportTdt(saveJson)`: the `.TDT` bytes for a serialized game (what
/// `serialize` returns). A tower the format cannot hold is a JavaScript error
/// with the player-readable message.
#[wasm_bindgen(js_name = exportTdt)]
pub fn export_tdt(save_json: &str) -> Result<Vec<u8>, JsError> {
    crate::tdt::export_tdt(save_json).map_err(err)
}

/// `encodeVctower(saveJson, appVersion, savedAtMs)`: the `.vctower` file
/// text for a serialized game (what `serialize` returns), stamped the way
/// `SaveGame.export` stamps it (`load::stamp_save`). Text that is not JSON,
/// a save that is not a tower, a time no `Date` holds, a build name that
/// reads as before 2.0 (which would mark the tower as a founder's) and a
/// save whose JSON passes 32 MiB (more than a reader will hold) are
/// JavaScript errors. A lone surrogate escape reads as U+FFFD
/// (`load::parse_save_json`).
#[wasm_bindgen(js_name = encodeVctower)]
pub fn encode_vctower(
    save_json: &str,
    app_version: &str,
    saved_at_ms: f64,
) -> Result<String, JsError> {
    // The text is read key by key, so the save is not held whole as a tree
    // (#1338); the bytes and the messages are the tree path's.
    let bytes =
        crate::export_stream::encode_vctower_text(save_json.as_bytes(), app_version, saved_at_ms)
            .map_err(err)?;
    // The container is ASCII by construction (magic, base64, newlines).
    String::from_utf8(bytes).map_err(err)
}

#[path = "wasm_facade_commands.rs"]
mod facade_commands;

#[path = "wasm_port.rs"]
mod port;

#[path = "wasm_port_edit.rs"]
mod port_edit;

#[path = "wasm_port_life.rs"]
mod port_life;

#[path = "wasm_port_panels.rs"]
mod port_panels;

#[path = "wasm_port_reports.rs"]
mod port_reports;

#[path = "wasm_port_files.rs"]
mod port_files;

#[path = "wasm_port_render.rs"]
mod port_render;

// The exported members of `Engine`, grouped by what they do. Each file holds
// plain `#[wasm_bindgen] impl Engine` blocks; the logic they forward to is in
// the `wasm_*.rs` modules above and in the rest of the crate.
mod exports_core;
mod exports_edits;
mod exports_port;
mod exports_port_more;
mod exports_state;

#[cfg(test)]
mod tests;
