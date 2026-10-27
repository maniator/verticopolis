//! The JavaScript binding: the engine behind a narrow, Simulation-shaped
//! surface that `wasm-bindgen` turns into a module. Structured values cross
//! as JSON text so the surface stays small and the glue stays generated.
//! Nothing here simulates anything; every method forwards to the engine.
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::canonical::{canonical_json, digest};
use crate::facilities::Kind;
pub use crate::frame::{frame_view, log_since, FRAME_HEADER, PERSON_FIXED, UNKNOWN_ROUTINE};
use crate::load_stream::parse_mode;
use crate::sim::Simulation;
use crate::snapshot::state_view;

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
}

#[wasm_bindgen]
impl Engine {
    /// `Simulation.newGame(seed, mode, modernCalendar, startUnbridged)`; the
    /// calendar defaults to the real-world one and the tower starts bridged,
    /// as the TypeScript defaults do.
    #[wasm_bindgen(js_name = newGame)]
    pub fn new_game(
        seed: u32,
        mode: &str,
        modern_calendar: Option<String>,
        start_unbridged: Option<bool>,
    ) -> Result<Engine, JsError> {
        let mode = parse_mode(mode).map_err(err)?;
        let calendar = match modern_calendar.as_deref() {
            None => crate::clock::CalendarKind::RealWorld,
            Some(c) => crate::clock::CalendarKind::parse(c).ok_or_else(|| {
                err(format!(
                    "modernCalendar must be canon or realWorld, got {c}"
                ))
            })?,
        };
        Ok(Engine {
            sim: Simulation::new_game_with(seed, mode, calendar, start_unbridged.unwrap_or(false)),
        })
    }

    /// `Simulation.deserialize(JSON.parse(text))`: a serialized game, migrated
    /// and loaded, with a lone surrogate escape read as U+FFFD
    /// (`load::parse_save_json`). Nothing else the import path does (the
    /// founder mark) runs.
    /// `markers`, when given, is JSON `{ lastHour, lastDay, lastQuarter,
    /// lastMonth, extendGesture?, commuteStress? }`: the live engine's
    /// boundary markers, open extend gesture `{ id, bottom, top }` (#990) and
    /// commute-stress rows (#1083), which a save does not carry (a load
    /// rebuilds the markers from the clock, a founded game keeps them unset
    /// until the first boundary, and a load has no gesture and no averages),
    /// so a shadow can start exactly where the live engine stands.
    #[wasm_bindgen(js_name = fromSave)]
    pub fn from_save(text: &str, markers: Option<String>) -> Result<Engine, JsError> {
        // A current save is read without a whole-save tree; any other text
        // goes through `load::parse_save_json` and `load::deserialize`.
        let mut sim = crate::load_stream::load_save_text(text.as_bytes()).map_err(err)?;
        if let Some(m) = markers {
            apply_markers(&mut sim, &m).map_err(err)?;
        }
        Ok(Engine { sim })
    }

    /// The import path for a `.vctower` file: decode, migrate and load, then
    /// mark a save from before 2.0 as a founder's tower. `mode`, when given,
    /// overwrites the save's mode before loading, as a scenario start does.
    #[wasm_bindgen(js_name = fromVctower)]
    pub fn from_vctower(text: &str, mode: Option<String>) -> Result<Engine, JsError> {
        // Decoded, then read as `fromSave` reads a save, with the mode set.
        let sim = crate::load_stream::load_vctower_text(text, mode.as_deref()).map_err(err)?;
        Ok(Engine { sim })
    }

    /// `serialize()` as JSON text.
    pub fn serialize(&self) -> String {
        self.sim.serialize().to_string()
    }

    /// The hashed state view: the saved game minus prose, as canonical JSON.
    #[wasm_bindgen(js_name = stateView)]
    pub fn state_view(&self) -> String {
        canonical_json(&state_view(&self.sim))
    }

    /// The hashed crowd view (people, id source, rng), as canonical JSON.
    #[wasm_bindgen(js_name = crowdView)]
    pub fn crowd_view(&self) -> String {
        canonical_json(&self.sim.crowd.view())
    }

    /// The state view's hash, as the lock records it.
    #[wasm_bindgen(js_name = stateDigest)]
    pub fn state_digest(&self) -> String {
        digest(&state_view(&self.sim))
    }

    /// The crowd view's hash, as the lock records it.
    #[wasm_bindgen(js_name = crowdDigest)]
    pub fn crowd_digest(&self) -> String {
        digest(&self.sim.crowd.view())
    }

    pub fn mode(&self) -> String {
        self.sim.mode.as_str().to_string()
    }

    pub fn money(&self) -> f64 {
        self.sim.money
    }

    #[wasm_bindgen(js_name = setMoney)]
    pub fn set_money(&mut self, amount: f64) {
        self.sim.money = amount;
    }

    /// The number of units on fire.
    pub fn fires(&self) -> u32 {
        self.sim.events.count() as u32
    }

    pub fn tick(&mut self, dt_minutes: f64) {
        self.sim.tick(dt_minutes);
    }

    /// `build(kind, floor, x)`: JSON `{ ok, reason? }`. An unknown kind is
    /// refused with "Unknown facility.", as TypeScript's `build` does.
    pub fn build(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
        floor: i32,
        x: i32,
    ) -> Result<String, JsError> {
        let Ok(kind) = parse_kind(&kind.as_string().unwrap_or_default()) else {
            return Ok(facade_commands::unknown_facility());
        };
        Ok(build_result(self.sim.build(kind, floor.into(), x.into())))
    }

    /// `canBuild(kind, floor, x)`: JSON `{ ok, reason?, cost }`, the dry run
    /// `build` makes first. When the placement fits, `cost` is its full
    /// price: the facility, the floor tiles laid under a room, and the tiles
    /// bridged to the tower when bridging is on; a "Not enough money."
    /// refusal carries that same full price. Any other refusal (placement or
    /// star gate) carries the reason `build` would give and the facility's
    /// base price. An unknown kind answers the way TypeScript does, with
    /// "Unknown facility." and a cost of 0.
    #[wasm_bindgen(js_name = canBuild)]
    pub fn can_build(
        &self,
        #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
        floor: i32,
        x: i32,
    ) -> String {
        let Ok(kind) = parse_kind(&kind.as_string().unwrap_or_default()) else {
            return can_build_json(false, Some(facade_commands::UNKNOWN_FACILITY), 0.0);
        };
        let c = self.sim.can_build(kind, floor.into(), x.into());
        can_build_json(c.ok, c.reason.as_deref(), c.cost)
    }

    /// `buildTransport(kind, x, bottom, top)`: JSON `{ ok, reason? }`. An
    /// unknown kind is refused with "Unknown facility.".
    #[wasm_bindgen(js_name = buildTransport)]
    pub fn build_transport(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
        x: i32,
        bottom: i32,
        top: i32,
    ) -> Result<String, JsError> {
        let Ok(kind) = parse_kind(&kind.as_string().unwrap_or_default()) else {
            return Ok(facade_commands::unknown_facility());
        };
        Ok(build_result(self.sim.build_transport(
            kind,
            x.into(),
            bottom.into(),
            top.into(),
        )))
    }

    /// `sellAt(floor, x)`: whether a facility went. Read raw (#996): a floor
    /// or column that is not a whole JS number within `Number.isSafeInteger`
    /// is refused with `false`, never coerced.
    #[wasm_bindgen(js_name = sellAt)]
    pub fn sell_at(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] floor: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] x: JsValue,
    ) -> bool {
        self.sell_at_checked(floor.as_f64(), x.as_f64())
    }

    /// The unit covering a tile, serialized as the save would, or null.
    #[wasm_bindgen(js_name = unitAt)]
    pub fn unit_at(&self, floor: i32, x: i32) -> Option<String> {
        self.sim
            .tower
            .unit_at(floor.into(), x.into())
            .map(|u| u.serialize().to_string())
    }

    /// The shaft covering a tile, serialized as the save would, or null.
    #[wasm_bindgen(js_name = transportAt)]
    pub fn transport_at(&self, floor: i32, x: i32) -> Option<String> {
        self.sim
            .tower
            .transport_at(floor.into(), x.into())
            .map(|t| t.serialize().to_string())
    }

    /// `adjustRent(id, dir)`: the new rent, or null when nothing moved. Read
    /// raw (#996): an id that is not a whole JS number within
    /// `Number.isSafeInteger`, or a `dir` that is not exactly 1 or -1, is
    /// refused with null.
    #[wasm_bindgen(js_name = adjustRent)]
    pub fn adjust_rent(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] dir: JsValue,
    ) -> Option<f64> {
        self.adjust_rent_checked(id.as_f64(), dir.as_f64())
    }

    /// `setNoRate(id)`: whether the unit is now off the market. The id is
    /// read raw (#996), as for `sellAt`.
    #[wasm_bindgen(js_name = setNoRate)]
    pub fn set_no_rate(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
    ) -> bool {
        self.set_no_rate_checked(id.as_f64())
    }

    /// `setCars(id, cars)`: the simulation-layer edit, which reports
    /// `capacity_changed`. Read raw (#996): an id or count that is not a
    /// whole JS number within `Number.isSafeInteger` is refused with `false`.
    #[wasm_bindgen(js_name = setCars)]
    pub fn set_cars(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] cars: JsValue,
    ) -> bool {
        self.set_cars_checked(id.as_f64(), cars.as_f64())
    }

    /// `tower.setCars(id, cars)`: the bare tower edit, silent in both
    /// engines (#906). Relay-only: the dual-run mirror replays a bare
    /// TypeScript tower edit with it. Player and UI edits use the charge commands
    /// (`addCar`, `removeCar`, `extendTransport`), and
    /// `towerRelayOps.guard.test.ts` keeps other callers out. Read raw
    /// (#996), as `setCars`.
    #[wasm_bindgen(js_name = towerSetCars)]
    pub fn tower_set_cars(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] cars: JsValue,
    ) -> bool {
        self.tower_set_cars_checked(id.as_f64(), cars.as_f64())
    }

    /// `Tower.setSchedule(id, schedule)` with the schedule as JSON text. The
    /// id is read raw (#996): one that is not a whole JS number within
    /// `Number.isSafeInteger` is refused with `false` before the text is read.
    #[wasm_bindgen(js_name = setSchedule)]
    pub fn set_schedule(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
        schedule: &str,
    ) -> Result<bool, JsError> {
        self.set_schedule_checked(id.as_f64(), schedule)
            .map_err(err)
    }

    /// `toggleAutoBridge()`: the preference after the flip.
    #[wasm_bindgen(js_name = toggleAutoBridge)]
    pub fn toggle_auto_bridge(&mut self) -> bool {
        self.sim.toggle_auto_bridge()
    }

    /// `setFilmPolicy(id, policy)`: the policy stored, or null.
    #[wasm_bindgen(js_name = setFilmPolicy)]
    pub fn set_film_policy(&mut self, id: i32, policy: &str) -> Option<String> {
        self.sim
            .set_film_policy(id.into(), policy)
            .map(str::to_string)
    }

    /// `rerollSubtype(id)`: the new subtype, or null.
    #[wasm_bindgen(js_name = rerollSubtype)]
    pub fn reroll_subtype(&mut self, id: i32) -> Option<String> {
        self.sim.reroll_subtype(id.into()).map(str::to_string)
    }

    /// `applyRentBatch(kind, target, onlyDefaultPriced)` with the target as
    /// JSON text (a number, `"default"` or `"noRate"`): the result counters
    /// as JSON, or null when the batch does not apply: an unknown or unpriced
    /// kind, a No Rate target off the ladder, or a target that is not
    /// `"default"`, `"noRate"` or a finite number, as in TypeScript.
    #[wasm_bindgen(js_name = applyRentBatch)]
    pub fn apply_rent_batch(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
        target: &str,
        #[wasm_bindgen(unchecked_param_type = "boolean")] only_default_priced: JsValue,
    ) -> Result<Option<String>, JsError> {
        let kind = kind.as_string().unwrap_or_default();
        Ok(self.apply_rent_batch_named(&kind, target, only_default_priced.is_truthy()))
    }

    /// `resizeTransport(id, bottom, top)`, the simulation-layer edit that
    /// reports `capacity_changed`: JSON `{ ok: true, added,
    /// floorTilesCreated }` or `{ ok: false, reason }`. Read raw (#996): an
    /// id or floor that is not a whole JS number within
    /// `Number.isSafeInteger` is refused with `INVALID_REQUEST`.
    #[wasm_bindgen(js_name = resizeTransport)]
    pub fn resize_transport(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] bottom: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] top: JsValue,
    ) -> String {
        self.resize_checked(id.as_f64(), bottom.as_f64(), top.as_f64())
    }

    /// `tower.resizeTransport(id, bottom, top)`, the bare tower edit, silent
    /// in both engines (#906): the same JSON, read raw the same way (#996).
    /// Relay-only, as `towerSetCars`.
    #[wasm_bindgen(js_name = towerResizeTransport)]
    pub fn tower_resize_transport(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] bottom: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] top: JsValue,
    ) -> String {
        self.tower_resize_checked(id.as_f64(), bottom.as_f64(), top.as_f64())
    }

    /// `addCar(id)`: JSON `{ ok, reason?, delta }`; the engine checks the car
    /// limit and the balance and pays for the car itself. The id is typed
    /// `number` but read raw (#923): anything but a whole JS number within
    /// `Number.isSafeInteger` is refused with `INVALID_REQUEST`, never coerced.
    #[wasm_bindgen(js_name = addCar)]
    pub fn add_car(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
    ) -> String {
        self.add_car_checked(id.as_f64())
    }

    /// `removeCar(id)`: JSON `{ ok, reason?, delta }` with the half-back refund.
    /// The id is read raw, as for `addCar` (#923).
    #[wasm_bindgen(js_name = removeCar)]
    pub fn remove_car(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
    ) -> String {
        self.remove_car_checked(id.as_f64())
    }

    /// `beginExtend(id)`: open an extend gesture on an elevator (#990), its
    /// high-water mark starting at the shaft's span; any open gesture is
    /// dropped first. False, with no gesture open, when `id` is not a whole
    /// JS number or names no elevator. The id is read raw, as for `addCar`.
    #[wasm_bindgen(js_name = beginExtend)]
    pub fn begin_extend(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
    ) -> bool {
        self.begin_extend_checked(id.as_f64())
    }

    /// `endExtend()`: close the open extend gesture, if any.
    #[wasm_bindgen(js_name = endExtend)]
    pub fn end_extend(&mut self) {
        self.sim.end_extend();
    }

    /// `extendTransport(id, end, targetFloor)`: JSON `{ ok, reason?, delta,
    /// bottom, top, added }`, the floors billed past the high-water mark: the
    /// open gesture's when `beginExtend` opened one on this shaft, the
    /// shaft's span otherwise. Every argument is read raw (#923): an id or
    /// floor that is not a whole JS number, or an `end` that is not exactly
    /// `"up"` or `"down"`, is refused with `INVALID_REQUEST` and the shaft's
    /// ends as they stand.
    #[wasm_bindgen(js_name = extendTransport)]
    pub fn extend_transport(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
        #[wasm_bindgen(unchecked_param_type = "\"up\" | \"down\"")] end: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] target_floor: JsValue,
    ) -> String {
        self.extend_checked(id.as_f64(), end.as_string(), target_floor.as_f64())
    }

    /// `removeFacility(id, method)`: the player's sell or bulldoze of a unit
    /// or shaft by id, paying the refund. JSON `{ ok, reason?, delta }`. Read
    /// raw (#923): an id that is not a whole JS number or a method that is not
    /// exactly `"sell"` or `"bulldoze"` is refused with `INVALID_REQUEST`.
    #[wasm_bindgen(js_name = removeFacility)]
    pub fn remove_facility(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
        #[wasm_bindgen(unchecked_param_type = "\"sell\" | \"bulldoze\"")] method: JsValue,
    ) -> String {
        self.remove_facility_checked(id.as_f64(), method.as_string())
    }

    /// `tower.removeUnit(id)`: whether a unit went.
    #[wasm_bindgen(js_name = removeUnit)]
    pub fn remove_unit(&mut self, id: i32) -> bool {
        self.sim.tower.remove_unit(id.into()).is_some()
    }

    /// `tower.removeTransport(id)`: whether a shaft went.
    #[wasm_bindgen(js_name = removeTransport)]
    pub fn remove_transport(&mut self, id: i32) -> bool {
        self.sim.tower.remove_transport(id.into()).is_some()
    }

    /// `tower.setStop(id, floor, stop)`: whether the stop is set. Read raw
    /// (#996): an id or floor that is not a whole JS number within
    /// `Number.isSafeInteger`, or a `stop` that is not a JS boolean, is
    /// refused with `false`.
    #[wasm_bindgen(js_name = setStop)]
    pub fn set_stop(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] floor: JsValue,
        #[wasm_bindgen(unchecked_param_type = "boolean")] stop: JsValue,
    ) -> bool {
        self.set_stop_checked(id.as_f64(), floor.as_f64(), stop.as_bool())
    }

    /// `setExpressStops(id)`: whether the id names a shaft, as TypeScript's
    /// answers; a shaft's stops are rebuilt, an unknown id changes nothing.
    #[wasm_bindgen(js_name = setExpressStops)]
    pub fn set_express_stops(&mut self, id: i32) -> bool {
        let id = i64::from(id);
        let known = self.sim.tower.get_transport(id).is_some();
        if known {
            self.sim.tower.set_express_stops(id);
        }
        known
    }

    #[wasm_bindgen(js_name = clearStops)]
    pub fn clear_stops(&mut self, id: i32) -> bool {
        self.sim.tower.clear_stops(id.into())
    }

    /// `priceUnit(u, target)`: the new price, or null when not repriceable.
    #[wasm_bindgen(js_name = priceUnit)]
    pub fn price_unit(&mut self, id: i32, target: f64) -> Option<f64> {
        self.sim.price_unit(id.into(), target)
    }

    /// The editor's rename of a unit.
    #[wasm_bindgen(js_name = setLabel)]
    pub fn set_label(&mut self, id: i32, label: &str) -> bool {
        self.sim.tower.set_label(id.into(), label)
    }

    /// `tower.towerName = name`; null clears it, as the host's `undefined`
    /// leaves the key out of the save.
    #[wasm_bindgen(js_name = setTowerName)]
    pub fn set_tower_name(&mut self, name: Option<String>) {
        self.sim.tower.tower_name = name;
    }

    /// `sim.autoBridge`.
    #[wasm_bindgen(js_name = autoBridge)]
    pub fn auto_bridge(&self) -> bool {
        self.sim.auto_bridge
    }

    /// `sim.view = view`, the camera a save carries, as JSON text (null clears).
    #[wasm_bindgen(js_name = setView)]
    pub fn set_view(&mut self, view: Option<String>) -> Result<(), JsError> {
        self.sim.view = match view {
            None => None,
            Some(text) => Some(serde_json::from_str(&text).map_err(err)?),
        };
        Ok(())
    }

    /// `sim.autoBridge = value`, the direct write an undo restore makes.
    #[wasm_bindgen(js_name = setAutoBridge)]
    pub fn set_auto_bridge(&mut self, value: bool) {
        self.sim.auto_bridge = value;
    }

    /// `sim.emit(text, kind)`: a log entry at the engine's clock.
    pub fn emit(&mut self, text: &str, kind: &str) -> Result<(), JsError> {
        let kind = match kind {
            "info" => crate::sim::LogKind::Info,
            "good" => crate::sim::LogKind::Good,
            "bad" => crate::sim::LogKind::Bad,
            "money" => crate::sim::LogKind::Money,
            other => return Err(err(format!("unknown log kind {other}"))),
        };
        self.sim.emit(text, kind);
        Ok(())
    }

    #[wasm_bindgen(js_name = startFire)]
    pub fn start_fire(&mut self) {
        self.sim.start_fire();
    }

    #[wasm_bindgen(js_name = bombThreat)]
    pub fn bomb_threat(&mut self) {
        self.sim.bomb_threat();
    }

    #[wasm_bindgen(js_name = evaluateStar)]
    pub fn evaluate_star(&mut self) {
        self.sim.evaluate_star();
    }

    /// `callExterminator()`: JSON `{ ok, reason?, cost?, rooms? }`, the
    /// TypeScript `ExterminatorResult`: `cost` and `rooms` ride on a booking
    /// and on the "funds" refusal, the other refusals carry the reason alone.
    #[wasm_bindgen(js_name = callExterminator)]
    pub fn call_exterminator(&mut self) -> String {
        facade_commands::exterminator_json(&self.sim.call_exterminator())
    }

    /// The pending player choice as JSON `{ kind, cost, message }`, or null.
    #[wasm_bindgen(js_name = pendingChoice)]
    pub fn pending_choice(&self) -> Option<String> {
        self.sim
            .events
            .pending
            .as_ref()
            .map(|p| pending_json(p.kind, p.cost, &p.message))
    }

    /// `resolveChoice(accept ? "accept" : "decline")`.
    #[wasm_bindgen(js_name = resolveChoice)]
    pub fn resolve_choice(&mut self, accept: bool) {
        self.sim.resolve_choice(accept);
    }

    /// The hourly elevator telemetry (`elevatorUtil`, `elevatorHourly`,
    /// `elevatorOrigins`) as JSON; see `Simulation::telemetry_json`.
    #[wasm_bindgen(js_name = elevatorTelemetry)]
    pub fn elevator_telemetry(&self) -> String {
        self.sim.telemetry_json().to_string()
    }

    /// `economy.housekeepingReport()`: yesterday's shift result as JSON
    /// `{ cleaned, leftover }`, or nothing (`undefined`) before the first
    /// morning checkout.
    #[wasm_bindgen(js_name = housekeepingReport)]
    pub fn housekeeping_report(&self) -> Option<String> {
        self.sim
            .housekeeping
            .yesterday
            .map(|(cleaned, leftover)| format!(r#"{{"cleaned":{cleaned},"leftover":{leftover}}}"#))
    }

    /// `crowd.commuteStressByFloor`: the per-origin-floor commute-stress
    /// average as JSON `[[floor, seconds], ...]`, by floor. No save carries
    /// it; it rebuilds as trips finish, as on the TypeScript engine.
    #[wasm_bindgen(js_name = commuteStress)]
    pub fn commute_stress(&self) -> String {
        self.sim.crowd.commute_stress_json().to_string()
    }

    /// Changes whenever a completed trip contributes a commute sample.
    #[wasm_bindgen(js_name = commuteStressRevision)]
    pub fn commute_stress_revision(&self) -> u32 {
        self.sim.crowd.commute_revision
    }

    /// Replace the elevator telemetry with an `elevatorTelemetry` document.
    /// Tooling only (the gallery's engine leg); no game command reaches it.
    #[wasm_bindgen(js_name = seedElevatorTelemetry)]
    pub fn seed_elevator_telemetry(&mut self, json: &str) -> Result<(), JsError> {
        let doc: Value = serde_json::from_str(json).map_err(err)?;
        self.sim.seed_telemetry(&doc).map_err(err)
    }

    /// Move the clock by `minutes` and run nothing: the TypeScript
    /// `clock.advance(minutes)`. Whatever pass the move skips is owed and runs
    /// on the next tick, as on the TypeScript engine. Tooling only (the
    /// gallery's clock pin); no game command reaches it.
    #[wasm_bindgen(js_name = advanceClock)]
    pub fn advance_clock(&mut self, minutes: f64) -> Result<(), JsError> {
        if !minutes.is_finite() || minutes < 0.0 {
            return Err(err(format!(
                "advanceClock: {minutes} is not a forward move"
            )));
        }
        self.sim.clock.advance(minutes);
        Ok(())
    }

    /// The loop's pass memos as `[lastHour, lastDay, lastMonth, lastQuarter]`,
    /// the counterpart of `seedLoopMemos`. Tooling only: the gallery's handoff
    /// carries a hosted tower's owed passes across the load that restarts it.
    #[wasm_bindgen(js_name = loopMemos)]
    pub fn loop_memos(&self) -> Vec<f64> {
        vec![
            self.sim.last_hour as f64,
            self.sim.last_day as f64,
            self.sim.last_month as f64,
            self.sim.last_quarter as f64,
        ]
    }

    /// Set the loop's pass memos (`lastHour`, `lastDay`, `lastMonth`,
    /// `lastQuarter`), which a load derives from the clock. Tooling only: the
    /// gallery's engine leg hands over a tower built in place, whose memos
    /// still owe its first passes, and this keeps them owed.
    #[wasm_bindgen(js_name = seedLoopMemos)]
    pub fn seed_loop_memos(
        &mut self,
        last_hour: f64,
        last_day: f64,
        last_month: f64,
        last_quarter: f64,
    ) -> Result<(), JsError> {
        let whole = |v: f64, what: &str| -> Result<i64, JsError> {
            if v.is_finite() && v.fract() == 0.0 && v.abs() <= 9007199254740991.0 {
                Ok(v as i64)
            } else {
                Err(err(format!(
                    "seedLoopMemos: {what} {v} is not a whole number"
                )))
            }
        };
        let memos = (
            whole(last_hour, "lastHour")?,
            whole(last_day, "lastDay")?,
            whole(last_month, "lastMonth")?,
            whole(last_quarter, "lastQuarter")?,
        );
        (
            self.sim.last_hour,
            self.sim.last_day,
            self.sim.last_month,
            self.sim.last_quarter,
        ) = memos;
        Ok(())
    }

    /// The per-frame read model as one flat number array (see
    /// `frame_view` for the layout): what the host reads every frame while
    /// the engine runs the simulation.
    #[wasm_bindgen(js_name = frameView)]
    pub fn frame_view(&self) -> Vec<f64> {
        frame_view(&self.sim)
    }

    /// The log entries emitted after `seq` (the `logSeq` the host last saw),
    /// oldest first, as JSON `[{ seq, minute, text, kind }]`. The engine keeps
    /// a ring of the last entries, so a host that falls further behind than
    /// the ring gets the ring.
    #[wasm_bindgen(js_name = logSince)]
    pub fn log_since(&self, seq: i32) -> String {
        log_since(&self.sim, seq.into()).to_string()
    }

    /// The gameplay events emitted since the last drain, oldest first, as
    /// JSON `[{ name, payload }]` (`conformance/events/catalog.json`); the
    /// buffer is empty afterwards.
    #[wasm_bindgen(js_name = drainGameplayEvents)]
    pub fn drain_gameplay_events(&mut self) -> String {
        crate::gameplay::batch_json(&self.sim.gameplay.drain()).to_string()
    }

    /// How many gameplay events wait for the next drain. A host reads it
    /// before draining, so a batch whose text it cannot read is counted as
    /// lost (the drain empties the buffer either way).
    #[wasm_bindgen(js_name = gameplayEventsPending)]
    pub fn gameplay_events_pending(&self) -> f64 {
        self.sim.gameplay.len() as f64
    }

    /// How many gameplay events a full buffer has pushed out since this
    /// engine was made (a host that drains every frame never sees one).
    #[wasm_bindgen(js_name = gameplayEventsDropped)]
    pub fn gameplay_events_dropped(&self) -> f64 {
        self.sim.gameplay.dropped as f64
    }
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
    let mut save = crate::load::parse_save_json(save_json.as_bytes())
        .map_err(|e| err(format!("save: {e}")))?;
    crate::load::stamp_save(&mut save, app_version, saved_at_ms).map_err(err)?;
    // The container is ASCII by construction (magic, base64, newlines).
    String::from_utf8(crate::load::encode_vctower(&save).map_err(err)?).map_err(err)
}

#[path = "wasm_facade_commands.rs"]
mod facade_commands;

/// The command answers the Rust-backed facade reads (slice 6d, #1216); the
/// logic is in `wasm_facade_commands.rs`.
#[wasm_bindgen]
impl Engine {
    /// `previewRentBatch(kind, target, onlyDefaultPriced)` with the target as
    /// JSON text, as for `applyRentBatch`: the counters that call would
    /// report, as JSON, with nothing written; null where it would not apply.
    /// A kind that is not a string is an unknown kind, and the flag is read
    /// by JavaScript truthiness, as TypeScript's `opts.onlyDefaultPriced` is.
    #[wasm_bindgen(js_name = previewRentBatch)]
    pub fn preview_rent_batch(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
        target: &str,
        #[wasm_bindgen(unchecked_param_type = "boolean")] only_default_priced: JsValue,
    ) -> Option<String> {
        let kind = kind.as_string().unwrap_or_default();
        self.preview_rent_batch_named(&kind, target, only_default_priced.is_truthy())
    }

    /// `tower.validateTransport(kind, x, bottom, top)`: JSON `{ ok, reason? }`,
    /// nothing written. An unknown kind is refused with "Unknown facility."; a
    /// coordinate that is not a whole JS number within `Number.isSafeInteger`
    /// is refused with `INVALID_REQUEST`, never coerced (#923).
    #[wasm_bindgen(js_name = validateTransport)]
    pub fn validate_transport(
        &self,
        #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] x: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] bottom: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] top: JsValue,
    ) -> String {
        let kind = kind.as_string().unwrap_or_default();
        self.validate_transport_json(&kind, x.as_f64(), bottom.as_f64(), top.as_f64())
    }

    /// `tower.placeTransportDryRun(kind, x, bottom, top)`: whether
    /// `validateTransport` accepts the shaft, read the same way.
    #[wasm_bindgen(js_name = placeTransportDryRun)]
    pub fn place_transport_dry_run(
        &self,
        #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] x: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] bottom: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] top: JsValue,
    ) -> bool {
        let kind = kind.as_string().unwrap_or_default();
        self.place_transport_dry_run_checked(&kind, x.as_f64(), bottom.as_f64(), top.as_f64())
    }
}

/// The view's layout (facade slice 6a, #1213) as JSON: the version, every
/// slot and width of the dynamic frame and the structural snapshot by name,
/// and the kind, state, weather, mode and calendar codes
/// (`view::layout_json`). A host checks it on load and refuses a version or
/// width it does not know.
#[wasm_bindgen(js_name = viewLayout)]
pub fn view_layout() -> String {
    crate::view::layout_json().to_string()
}

/// The renderer-facing view (facade slice 6a, #1213): one-line wrappers over
/// `crate::view`, which documents each layout.
#[wasm_bindgen]
impl Engine {
    /// The structural snapshot (`view::structure_view`): the floor bounds,
    /// the mode and calendar, rooms by slot, floor and lobby tiles as runs,
    /// transports with their skipped floors. Read again when the frame
    /// header's tower revision moves.
    #[wasm_bindgen(js_name = viewStructure)]
    pub fn view_structure(&self) -> Vec<f64> {
        crate::view::structure_view(&self.sim)
    }

    /// The dynamic frame (`view::ViewReader::frame`): the header, the
    /// people, the rooms whose fields changed since the last call (every room
    /// when `full` is `true`, on the first call, or after a structural
    /// change, with the header's full flag set) and the cars. One reader per
    /// engine, so one caller: the header's frame number tells it when it
    /// missed a frame. Read raw: only a JS `true` asks for a full frame.
    #[wasm_bindgen(js_name = viewFrame)]
    pub fn view_frame(
        &self,
        #[wasm_bindgen(unchecked_param_type = "boolean")] full: JsValue,
    ) -> Vec<f64> {
        crate::view::view_frame(&self.sim, full.as_bool() == Some(true))
    }

    /// The labels and subtypes changed after the meta revision `since`, as
    /// JSON `{ revision, full, units: [[id, label, subtype], ...] }`
    /// (`view::meta_since`). Read raw: a `since` of 0, or of anything but a
    /// whole JS number from the log's reach up to the current revision
    /// (`undefined` from untyped JavaScript among them), gets a full listing.
    #[wasm_bindgen(js_name = unitMetaSince)]
    pub fn unit_meta_since(
        &self,
        #[wasm_bindgen(unchecked_param_type = "number")] since: JsValue,
    ) -> String {
        let since = crate::view::whole_revision(since.as_f64());
        crate::view::meta_since(&self.sim.tower, since).to_string()
    }

    /// The tower signature (`Simulation::tower_signature`) as a `bigint`: two
    /// reads are equal when the fields the tower half of `towerStateSig`
    /// reads are equal, and differ when they differ (but for a 64-bit
    /// collision). Undo reads it, beside money, at a gesture's capture and
    /// commit; it walks every unit, so it is too slow to read each frame.
    #[wasm_bindgen(js_name = towerSignature)]
    pub fn tower_signature(&self) -> u64 {
        self.sim.tower_signature()
    }
}

// ---- panel getters (facade slice 6b, #1214) ----------------------------
//
// One-line wrappers over `crate::panels`: each answers JSON text keyed with
// the TypeScript field names, read-only, so a panel asks the engine for what
// it used to compute on the mirrored `Simulation`. An id that is not a whole
// JS number within `Number.isSafeInteger` is refused with null, as the
// commands refuse it (#996).

impl Engine {
    pub(crate) fn unit_detail_checked(&mut self, id: Option<f64>) -> Option<String> {
        let id = id.and_then(crate::charges::whole)?;
        self.sim.unit_detail(id).map(|v| v.to_string())
    }

    pub(crate) fn transport_detail_checked(&self, id: Option<f64>) -> Option<String> {
        let id = id.and_then(crate::charges::whole)?;
        self.sim.transport_detail(id).map(|v| v.to_string())
    }
}

#[wasm_bindgen]
impl Engine {
    /// `stats()`: the HUD strip's counters, as JSON.
    #[wasm_bindgen(js_name = towerStats)]
    pub fn tower_stats(&self) -> String {
        self.sim.tower_stats().to_string()
    }

    /// Everything the stats screen reads beyond `stats()`, as JSON.
    #[wasm_bindgen(js_name = statsReport)]
    pub fn stats_report(&mut self) -> String {
        self.sim.stats_report().to_string()
    }

    /// `housekeepingCoverage()`, as JSON.
    #[wasm_bindgen(js_name = housekeepingCoverage)]
    pub fn housekeeping_coverage(&self) -> String {
        self.sim.housekeeping_coverage().to_json().to_string()
    }

    /// The unit inspector and editor card for unit `id`, as JSON, or null.
    #[wasm_bindgen(js_name = unitDetail)]
    pub fn unit_detail(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
    ) -> Option<String> {
        self.unit_detail_checked(id.as_f64())
    }

    /// The transport inspector and editor card for shaft `id`, as JSON, or null.
    #[wasm_bindgen(js_name = transportDetail)]
    pub fn transport_detail(
        &self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
    ) -> Option<String> {
        self.transport_detail_checked(id.as_f64())
    }

    /// `floorHeatmap(mode)`'s cells as JSON; a mode that is not one of the
    /// four overlays is an error.
    #[wasm_bindgen(js_name = floorHeatmap)]
    pub fn floor_heatmap(&self, mode: &str) -> Result<String, JsError> {
        let mode = crate::panels::heatmap::HeatmapMode::parse(mode)
            .ok_or_else(|| err(format!("unknown heatmap mode {mode}")))?;
        Ok(self.sim.floor_heatmap_json(mode))
    }

    /// `peakCongestionHotspot()`: `{ ratio, floor }` as JSON.
    #[wasm_bindgen(js_name = peakCongestionHotspot)]
    pub fn peak_congestion_hotspot(&self) -> String {
        self.sim.peak_congestion_hotspot().to_string()
    }

    /// The five onboarding facts as JSON.
    #[wasm_bindgen(js_name = onboardingFacts)]
    pub fn onboarding_facts(&self) -> String {
        self.sim.onboarding_facts().to_string()
    }
}

/// Facade slice 6c (#1215): the inspector's diagnostics facts.
#[wasm_bindgen]
impl Engine {
    /// The facts behind the inspector's diagnostics for one unit, as JSON
    /// text (`diagnostics::DiagnosticFacts`); TypeScript keeps the wording.
    /// Undefined for an id that names no unit (a transport's, zero or a
    /// negative one) and for a malformed one (fractional, not finite, past
    /// the safe integers), read raw so it cannot wrap onto a real unit.
    /// The read may fill the engine's caches, which sit outside the save; it
    /// changes nothing in the game.
    #[wasm_bindgen(js_name = diagnosticFacts)]
    pub fn diagnostic_facts(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "number")] id: JsValue,
    ) -> Option<String> {
        crate::diagnostics::facts_json(&mut self.sim, id.as_f64())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameMode;
    use crate::load_stream::override_mode;

    /// The binding stamps the save and hands back the crate encoder's text.
    /// (A refusal is a JavaScript error, which cannot be built off the wasm
    /// target; the crate's `stamp_save` tests and the Node suite cover those.)
    #[test]
    fn the_vctower_binding_stamps_and_writes_what_the_crate_writes() {
        let save =
            serde_json::json!({"version": 7, "units": [], "minutes": 0, "towerName": "Caf\u{e9}"});
        let Ok(text) = encode_vctower(&save.to_string(), "3.0.0", 1.5e12) else {
            panic!("the binding refused a tower save");
        };
        let mut stamped = save.clone();
        crate::load::stamp_save(&mut stamped, "3.0.0", 1.5e12).unwrap();
        assert_eq!(
            text.as_bytes(),
            crate::load::encode_vctower(&stamped).unwrap()
        );
        assert_eq!(
            canonical_json(&crate::load::decode_vctower(&text).unwrap()),
            canonical_json(&stamped)
        );
    }

    /// The two TDT free functions answer every lock case the way the referee
    /// does: the JSON envelope carries the pinned save and warnings, each
    /// refusal carries the pinned message, and each embedded export matches
    /// its pinned bytes or refusal.
    #[test]
    fn the_tdt_binding_answers_from_the_lock() {
        use crate::canonical::digest;
        use crate::tdt::referee::{inflate, read_lock, sha256_hex};
        let suite = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance");
        let lock = read_lock(&suite.join("tdt-cases.json")).expect("lock");
        let mut parsed = 0;
        for case in lock.import.iter().filter(|c| c.expected.is_some()) {
            let Ok(json) = import_tdt(&inflate(&case.bytes).expect("bytes"), &case.filename) else {
                panic!("the import refused {}, which the lock parses", case.id);
            };
            let v: serde_json::Value = serde_json::from_str(&json).expect("json envelope");
            let expected = case.expected.as_ref().unwrap();
            assert_eq!(digest(&v["save"]), expected.save, "{}", case.id);
            let mut warnings: Vec<String> =
                serde_json::from_value(v["warnings"].clone()).expect("a string array");
            // The lock stores warnings sorted (as the referee compares them);
            // their order is pinned by the TypeScript versus WASM
            // differential test.
            warnings.sort();
            assert_eq!(warnings, expected.warnings, "{}", case.id);
            parsed += 1;
        }
        assert!(parsed > 0, "the lock has import cases that parse");
        // A JavaScript error cannot be built off the wasm target, so each
        // refusal is asserted on the crate function the binding wraps, with
        // the lock's exact message.
        let mut refused = 0;
        for case in lock.import.iter().filter(|c| c.throws.is_some()) {
            let got = crate::tdt::import_tdt(&inflate(&case.bytes).expect("bytes"), &case.filename);
            assert_eq!(got.err().as_ref(), case.throws.as_ref(), "{}", case.id);
            refused += 1;
        }
        assert!(refused > 0, "the lock has import cases that refuse");
        let mut written = 0;
        for ex in lock
            .export
            .iter()
            .filter(|c| c.save.is_some() && c.expected.is_some())
        {
            let Ok(bytes) = export_tdt(&ex.save.as_ref().unwrap().to_string()) else {
                panic!("the export refused {}, which the lock writes", ex.id);
            };
            assert_eq!(
                sha256_hex(&bytes),
                *ex.expected.as_ref().unwrap(),
                "{}",
                ex.id
            );
            written += 1;
        }
        assert!(written > 0, "the lock has embedded export cases");
        for ex in lock
            .export
            .iter()
            .filter(|c| c.save.is_some() && c.throws.is_some())
        {
            let got = crate::tdt::export_tdt(&ex.save.as_ref().unwrap().to_string());
            assert_eq!(got.err().as_ref(), ex.throws.as_ref(), "{}", ex.id);
        }
    }

    #[test]
    fn the_charge_commands_cross_as_the_typescript_spells_them() {
        use crate::charges::{ChargeResult, ExtendEnd, ExtendResult};
        use crate::gameplay::RemovalMethod;
        let refused = ChargeResult {
            ok: false,
            reason: Some("Not enough money.".into()),
            delta: 0.0,
        };
        let v = charge_json(&refused);
        assert_eq!(v["ok"], false);
        assert_eq!(v["reason"], "Not enough money.");
        assert_eq!(v["delta"].as_f64(), Some(0.0));
        let paid = ExtendResult {
            charge: ChargeResult {
                ok: true,
                reason: None,
                delta: -10_000.0,
            },
            bottom: 1,
            top: 4,
            added: 2,
        };
        let v = extend_json(&paid);
        assert!(v.get("reason").is_none());
        assert_eq!(v["delta"].as_f64(), Some(-10_000.0));
        assert_eq!(
            (v["bottom"].as_i64(), v["top"].as_i64(), v["added"].as_i64()),
            (Some(1), Some(4), Some(2))
        );
        assert_eq!(ExtendEnd::parse("down"), Some(ExtendEnd::Down));
        assert_eq!(ExtendEnd::parse("sideways"), None);
        assert_eq!(
            RemovalMethod::parse("bulldoze"),
            Some(RemovalMethod::Bulldoze)
        );
        assert_eq!(RemovalMethod::parse("burn"), None);
    }

    /// A malformed charge command (#923) is refused with one reason and moves
    /// nothing: a fractional or NaN id or floor that the old `i32` arguments
    /// truncated to a real shaft, an unknown `end` or `method`, a bad mark.
    #[test]
    fn a_malformed_charge_command_is_refused_and_moves_nothing() {
        use crate::charges::INVALID_REQUEST;
        use crate::facilities::Kind;
        let mut sim = Simulation::new_game(1, crate::clock::GameMode::Classic);
        for x in 10..40 {
            assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        }
        for x in 10..40 {
            assert!(sim.tower.place(Kind::Floor, 2, x).ok);
        }
        assert!(sim.build_transport(Kind::ElevatorStandard, 10, 1, 2).ok);
        let lift = sim.tower.transport_at(1, 10).unwrap().id;
        sim.money = 1_000_000.0;
        let mut e = Engine { sim };
        let before = e.serialize();
        e.sim.gameplay.drain();
        let refused = |text: String| -> Value {
            let v: Value = serde_json::from_str(&text).unwrap();
            assert_eq!(v["ok"], false, "{text}");
            assert_eq!(v["reason"], INVALID_REQUEST, "{text}");
            assert_eq!(v["delta"].as_f64(), Some(0.0), "{text}");
            v
        };
        let id = Some(lift as f64);
        let near = Some(lift as f64 + 0.5);
        let up = || Some("up".to_string());
        // A non-number id (a numeric string, null, a boolean, a missing
        // argument) reaches the checked call as None and is refused.
        refused(e.add_car_checked(None));
        refused(e.add_car_checked(near));
        refused(e.add_car_checked(Some(f64::NAN)));
        refused(e.remove_car_checked(None));
        refused(e.remove_car_checked(Some(f64::INFINITY)));
        refused(e.remove_car_checked(Some(f64::NEG_INFINITY)));
        refused(e.add_car_checked(Some(9_007_199_254_740_992.0))); // 2^53: past Number.isSafeInteger
        refused(e.extend_checked(id, Some("UP".into()), Some(3.0))); // exact match
        refused(e.remove_facility_checked(id, Some("Sell".into())));
        let v = refused(e.extend_checked(id, Some("sideways".into()), Some(3.0)));
        assert_eq!(
            (v["bottom"].as_i64(), v["top"].as_i64()),
            (Some(1), Some(2))
        );
        let v = refused(e.extend_checked(id, None, Some(3.0))); // a non-string end
        assert_eq!(
            (v["bottom"].as_i64(), v["top"].as_i64()),
            (Some(1), Some(2))
        );
        refused(e.extend_checked(id, up(), Some(3.5)));
        refused(e.extend_checked(id, up(), Some(f64::NAN)));
        refused(e.extend_checked(id, up(), None));
        let v = refused(e.extend_checked(near, up(), Some(3.0)));
        assert_eq!(
            (v["bottom"].as_i64(), v["top"].as_i64()),
            (Some(0), Some(0))
        );
        // A malformed beginExtend opens no gesture and drops the open one.
        assert!(e.begin_extend_checked(id));
        assert!(!e.begin_extend_checked(None));
        assert_eq!(e.sim.extend_gesture, None);
        assert!(!e.begin_extend_checked(near));
        assert!(!e.begin_extend_checked(Some(f64::NAN)));
        refused(e.remove_facility_checked(id, Some("burn".into())));
        refused(e.remove_facility_checked(id, None));
        refused(e.remove_facility_checked(near, Some("sell".into())));
        refused(e.remove_facility_checked(None, Some("sell".into())));
        assert_eq!(
            e.serialize(),
            before,
            "a refusal moved the tower or the money"
        );
        assert!(
            e.sim.gameplay.drain().is_empty(),
            "a refusal emitted an event"
        );
        // A well-formed call still lands.
        let ok: Value = serde_json::from_str(&e.add_car_checked(id)).unwrap();
        assert_eq!(ok["ok"], true);
        // A gesture opened through the binding bills a wiggle once.
        assert!(e.begin_extend_checked(id));
        let at = |e: &mut Engine, floor: f64| -> Value {
            serde_json::from_str(&e.extend_checked(id, up(), Some(floor))).unwrap()
        };
        assert_eq!(at(&mut e, 3.0)["added"].as_i64(), Some(1));
        assert_eq!(at(&mut e, 2.0)["added"].as_i64(), Some(0));
        assert_eq!(at(&mut e, 3.0)["added"].as_i64(), Some(0));
    }

    #[test]
    fn the_frame_view_carries_the_header_and_one_record_per_person_unit_and_car() {
        // A real tower, so the view carries people, every unit kind and cars.
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../conformance/fixtures/towerone-star4.vctower"
        ))
        .expect("fixture");
        let raw = crate::load::decode_vctower(&text).expect("decodes");
        let mut sim = crate::load::deserialize(&raw).expect("loads");
        sim.tick(600.0);
        let v = frame_view(&sim);
        let people = v[23] as usize;
        let units = v[24] as usize;
        let transports = v[25] as usize;
        assert_eq!(people, sim.crowd.people.len());
        assert_eq!(units, sim.tower.units.len());
        assert_eq!(transports, sim.tower.transports.len());
        assert!(people > 0 && transports > 0);
        let cars: usize = sim.tower.transports.iter().map(|t| t.cars as usize).sum();
        let person_slots: usize = sim
            .crowd
            .people
            .iter()
            .map(|p| PERSON_FIXED + p.floors.len() + p.shafts.len())
            .sum();
        assert_eq!(
            v.len(),
            FRAME_HEADER + person_slots + units * 6 + 2 * transports + 3 * cars
        );
        assert_eq!(v[0], sim.clock.minutes);
        assert_eq!(v[4], sim.money);
        assert_eq!(v[22], sim.on_hour_runs as f64);
        // The first unit record names the first unit and its occupants.
        let u0 = FRAME_HEADER + person_slots;
        assert_eq!(v[u0], sim.tower.units[0].id as f64);
        assert_eq!(v[u0 + 2], sim.tower.units[0].occupants as f64);
        // The transport record follows the units.
        let t0 = u0 + units * 6;
        assert_eq!(v[t0], sim.tower.transports[0].id as f64);
        assert_eq!(v[t0 + 1], sim.tower.transports[0].cars as f64);
        // The first person record names the first person, its position and
        // its route: the floors and shafts follow the fixed slots.
        let p0 = &sim.crowd.people[0];
        assert_eq!(v[FRAME_HEADER], p0.id as f64);
        assert_eq!(v[FRAME_HEADER + 5], p0.x);
        assert_eq!(v[FRAME_HEADER + 8], p0.origin_floor as f64);
        assert_eq!(v[FRAME_HEADER + 16], p0.floors.len() as f64);
        assert_eq!(v[FRAME_HEADER + 17], p0.shafts.len() as f64);
        let floors: Vec<i64> = v
            [FRAME_HEADER + PERSON_FIXED..FRAME_HEADER + PERSON_FIXED + p0.floors.len()]
            .iter()
            .map(|f| *f as i64)
            .collect();
        assert_eq!(floors, p0.floors);
        // A round-tripper in the crowd carries its origin unit and venue; the
        // record agrees with the person's own fields.
        let (mut at, mut seen) = (FRAME_HEADER, false);
        for p in &sim.crowd.people {
            assert_eq!(v[at], p.id as f64);
            assert_eq!(v[at + 9], p.origin_unit_id.map_or(-1.0, |n| n as f64));
            assert_eq!(v[at + 11], p.meal_venue_id.map_or(-1.0, |n| n as f64));
            assert_eq!(v[at + 14], if p.returning { 1.0 } else { 0.0 });
            match p.dwell_seconds_left {
                Some(left) => assert_eq!(v[at + 15], left),
                None => assert!(v[at + 15].is_nan()),
            }
            seen |= p.origin_unit_id.is_some();
            at += PERSON_FIXED + p.floors.len() + p.shafts.len();
        }
        assert!(seen, "the fixture's noon crowd has a round-tripper");
    }

    #[test]
    fn log_since_numbers_the_ring_from_the_sequence_counter() {
        let mut sim = Simulation::new_game(7, GameMode::Classic);
        let founded = sim.log_seq;
        sim.emit("one", crate::sim::LogKind::Info);
        sim.emit("two", crate::sim::LogKind::Good);
        sim.emit("three", crate::sim::LogKind::Money);
        let all = log_since(&sim, 0);
        assert_eq!(all.as_array().map(Vec::len), Some(sim.log.len()));
        assert_eq!(log_since(&sim, founded).as_array().map(Vec::len), Some(3));
        let later = log_since(&sim, sim.log_seq - 1);
        let later = later.as_array().expect("array");
        assert_eq!(later.len(), 1);
        assert_eq!(later[0]["text"], "three");
        assert_eq!(later[0]["kind"], "money");
        assert_eq!(later[0]["seq"], sim.log_seq);
        assert_eq!(
            log_since(&sim, sim.log_seq).as_array().map(Vec::len),
            Some(0)
        );
    }

    #[test]
    fn the_catalog_crosses_as_canonical_json_for_a_named_mode() {
        let text = catalog_text("modern").unwrap();
        assert_eq!(text, crate::catalog::catalog_json(GameMode::Modern));
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["mode"], "modern");
        assert!(catalog_text("arcade")
            .unwrap_err()
            .contains("classic or modern"));
    }

    #[test]
    fn modes_and_kinds_parse_by_their_saved_spelling() {
        assert_eq!(parse_mode("classic"), Ok(GameMode::Classic));
        assert_eq!(parse_mode("modern"), Ok(GameMode::Modern));
        assert!(parse_mode("Classic")
            .unwrap_err()
            .contains("classic or modern"));
        assert_eq!(parse_kind("lobby"), Ok(Kind::Lobby));
        assert!(parse_kind("penthouse").unwrap_err().contains("penthouse"));
    }

    #[test]
    fn outcomes_and_choices_take_the_typescript_shape() {
        assert_eq!(outcome(true, None), r#"{"ok":true}"#);
        assert_eq!(
            outcome(false, Some("no money")),
            r#"{"ok":false,"reason":"no money"}"#
        );
        let v: Value = serde_json::from_str(&pending_json("bombThreat", 20000.0, "pay"))
            .expect("pending choice is JSON");
        assert_eq!(v["kind"], "bombThreat");
        assert_eq!(v["cost"], 20000.0);
        assert_eq!(v["message"], "pay");
    }

    #[test]
    fn batch_targets_parse_and_results_take_the_typescript_keys() {
        use crate::rent::{BatchRentResult, BatchTarget};
        assert_eq!(parse_batch_target("\"default\""), Ok(BatchTarget::Default));
        assert_eq!(parse_batch_target("\"noRate\""), Ok(BatchTarget::NoRate));
        assert_eq!(parse_batch_target("1500"), Ok(BatchTarget::Price(1500.0)));
        assert!(parse_batch_target("\"cheap\"").is_err());
        assert!(parse_batch_target("[1]").is_err());
        let r = BatchRentResult {
            matched: 3,
            eligible: 2,
            changed: 1,
            skipped_sold: 1,
            ..BatchRentResult::default()
        };
        let v: Value = serde_json::from_str(&batch_result_json(&r)).unwrap();
        assert_eq!(v["matched"], 3);
        assert_eq!(v["skippedSold"], 1);
        assert_eq!(v["clampedHigh"], 0);
        assert_eq!(v.as_object().unwrap().len(), 8);
    }

    #[test]
    fn markers_land_on_the_engine_and_refuse_a_bad_shape() {
        let mut sim = Simulation::new_game(1, GameMode::Classic);
        apply_markers(
            &mut sim,
            r#"{"lastHour":7,"lastDay":0,"lastQuarter":-1,"lastMonth":-1}"#,
        )
        .expect("whole numbers land");
        assert_eq!(
            (
                sim.last_hour,
                sim.last_day,
                sim.last_quarter,
                sim.last_month
            ),
            (7, 0, -1, -1)
        );
        assert!(apply_markers(&mut sim, r#"{"lastHour":7}"#)
            .unwrap_err()
            .contains("lastDay"));
        assert!(apply_markers(
            &mut sim,
            r#"{"lastHour":1.5,"lastDay":0,"lastQuarter":0,"lastMonth":0}"#
        )
        .unwrap_err()
        .contains("lastHour"));
        assert!(apply_markers(&mut sim, "[]")
            .unwrap_err()
            .contains("lastHour"));
    }

    /// The live engine's open extend gesture rides with the markers (#990):
    /// restored as given on an elevator, dropped on anything else, refused
    /// when malformed.
    #[test]
    fn markers_carry_the_open_extend_gesture() {
        use crate::facilities::Kind;
        let mut sim = Simulation::new_game(1, GameMode::Classic);
        for x in 10..40 {
            assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
            assert!(sim.tower.place(Kind::Floor, 2, x).ok);
        }
        sim.money = 1_000_000.0;
        assert!(sim.build_transport(Kind::ElevatorStandard, 10, 1, 2).ok);
        let lift = sim.tower.transport_at(1, 10).unwrap().id;
        let base = r#""lastHour":7,"lastDay":0,"lastQuarter":-1,"lastMonth":-1"#;
        let with = |g: &str| format!("{{{base},\"extendGesture\":{g}}}");
        apply_markers(
            &mut sim,
            &with(&format!(r#"{{"id":{lift},"bottom":1,"top":5}}"#)),
        )
        .expect("a gesture lands");
        assert_eq!(sim.extend_gesture, Some((lift, 1, 5)));
        apply_markers(&mut sim, &with("null")).expect("no gesture lands");
        assert_eq!(sim.extend_gesture, None, "null is no gesture");
        apply_markers(
            &mut sim,
            &with(&format!(r#"{{"id":{lift},"bottom":1,"top":5}}"#)),
        )
        .expect("a gesture lands again");
        apply_markers(&mut sim, &format!("{{{base}}}")).expect("an absent gesture lands");
        assert_eq!(sim.extend_gesture, None, "absent is no gesture");
        apply_markers(&mut sim, &with(r#"{"id":99999,"bottom":1,"top":5}"#))
            .expect("a gone shaft is no gesture");
        assert_eq!(sim.extend_gesture, None);
        assert!(
            apply_markers(&mut sim, &with(r#"{"id":1.5,"bottom":1,"top":5}"#))
                .unwrap_err()
                .contains("extendGesture.id")
        );
    }

    #[test]
    fn mode_override_edits_an_object_and_refuses_anything_else() {
        let mut raw = serde_json::json!({ "mode": "classic", "seed": 1 });
        override_mode(&mut raw, "modern").expect("object takes the mode");
        assert_eq!(raw["mode"], "modern");
        assert_eq!(raw["seed"], 1);
        assert!(override_mode(&mut raw, "arcade")
            .unwrap_err()
            .contains("classic or modern"));
        for mut not_a_save in [Value::Null, serde_json::json!([1]), serde_json::json!(3)] {
            assert!(override_mode(&mut not_a_save, "modern")
                .unwrap_err()
                .contains("saved game"));
        }
    }
}
