//! The JavaScript binding: the engine behind a narrow, Simulation-shaped
//! surface that `wasm-bindgen` turns into a module. Structured values cross
//! as JSON text so the surface stays small and the glue stays generated.
//! Nothing here simulates anything; every method forwards to the engine.
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::canonical::{canonical_json, digest};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::scenario::state_view;
use crate::sim::Simulation;

/// Every failure crosses as a JavaScript error with its message; the helpers
/// below carry plain strings so they can be tested natively, and the methods
/// convert at the boundary.
fn err(what: impl std::fmt::Display) -> JsError {
    JsError::new(&what.to_string())
}

fn parse_mode(s: &str) -> Result<GameMode, String> {
    GameMode::parse(s).ok_or_else(|| format!("mode must be classic or modern, got {s}"))
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
    Ok(())
}

/// `raw.mode = mode`, the override a scenario start applies before loading.
/// The TypeScript throws on a non-object; here that is an error rather than
/// a panic, which under WASM would trap and poison the module.
fn override_mode(raw: &mut Value, mode: &str) -> Result<(), String> {
    parse_mode(mode)?;
    let obj = raw
        .as_object_mut()
        .ok_or_else(|| "the file does not hold a saved game".to_string())?;
    obj.insert("mode".into(), Value::String(mode.to_string()));
    Ok(())
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
    /// and loaded. Nothing else the import path does (the founder mark) runs.
    /// `markers`, when given, is JSON `{ lastHour, lastDay, lastQuarter,
    /// lastMonth }`: the live engine's boundary markers, which a save does
    /// not carry (a load rebuilds them from the clock, a founded game keeps
    /// them unset until the first boundary), so a shadow can start exactly
    /// where the live engine stands.
    #[wasm_bindgen(js_name = fromSave)]
    pub fn from_save(text: &str, markers: Option<String>) -> Result<Engine, JsError> {
        let raw: Value = serde_json::from_str(text).map_err(err)?;
        let mut sim = crate::load::deserialize(&raw).map_err(err)?;
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
        let mut raw = crate::load::decode_vctower(text).map_err(err)?;
        if let Some(m) = &mode {
            override_mode(&mut raw, m).map_err(err)?;
        }
        let mut sim = crate::load::deserialize(&raw).map_err(err)?;
        crate::load::mark_founder_from_loaded_file(&mut sim, &raw);
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

    /// `build(kind, floor, x)`: JSON `{ ok, reason? }`.
    pub fn build(&mut self, kind: &str, floor: i32, x: i32) -> Result<String, JsError> {
        let kind = parse_kind(kind).map_err(err)?;
        Ok(build_result(self.sim.build(kind, floor.into(), x.into())))
    }

    /// `buildTransport(kind, x, bottom, top)`: JSON `{ ok, reason? }`.
    #[wasm_bindgen(js_name = buildTransport)]
    pub fn build_transport(
        &mut self,
        kind: &str,
        x: i32,
        bottom: i32,
        top: i32,
    ) -> Result<String, JsError> {
        let kind = parse_kind(kind).map_err(err)?;
        Ok(build_result(self.sim.build_transport(
            kind,
            x.into(),
            bottom.into(),
            top.into(),
        )))
    }

    #[wasm_bindgen(js_name = sellAt)]
    pub fn sell_at(&mut self, floor: i32, x: i32) -> bool {
        self.sim.sell_at(floor.into(), x.into())
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

    /// `adjustRent(id, dir)`: the new rent, or null when nothing moved.
    #[wasm_bindgen(js_name = adjustRent)]
    pub fn adjust_rent(&mut self, id: i32, dir: i32) -> Option<f64> {
        self.sim.adjust_rent(id.into(), dir.into())
    }

    #[wasm_bindgen(js_name = setNoRate)]
    pub fn set_no_rate(&mut self, id: i32) -> bool {
        self.sim.set_no_rate(id.into())
    }

    #[wasm_bindgen(js_name = setCars)]
    pub fn set_cars(&mut self, id: i32, cars: i32) -> bool {
        self.sim.tower.set_cars(id.into(), cars.into())
    }

    /// `Tower.setSchedule(id, schedule)` with the schedule as JSON text.
    #[wasm_bindgen(js_name = setSchedule)]
    pub fn set_schedule(&mut self, id: i32, schedule: &str) -> Result<bool, JsError> {
        let raw: Value = serde_json::from_str(schedule).map_err(err)?;
        Ok(self.sim.tower.set_schedule(id.into(), &raw))
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
    /// as JSON, or null when the batch does not apply.
    #[wasm_bindgen(js_name = applyRentBatch)]
    pub fn apply_rent_batch(
        &mut self,
        kind: &str,
        target: &str,
        only_default_priced: bool,
    ) -> Result<Option<String>, JsError> {
        let kind = parse_kind(kind).map_err(err)?;
        let target = parse_batch_target(target).map_err(err)?;
        Ok(self
            .sim
            .apply_rent_batch(kind, target, only_default_priced)
            .map(|r| batch_result_json(&r)))
    }

    /// `tower.resizeTransport(id, bottom, top)`: JSON
    /// `{ ok, reason?, added, floorTilesCreated }`.
    #[wasm_bindgen(js_name = resizeTransport)]
    pub fn resize_transport(&mut self, id: i32, bottom: i32, top: i32) -> String {
        let r = self
            .sim
            .tower
            .resize_transport(id.into(), bottom.into(), top.into());
        let mut v = serde_json::json!({
            "ok": r.ok,
            "added": r.added,
            "floorTilesCreated": r.floor_tiles_created,
        });
        if let Some(reason) = r.reason {
            v["reason"] = Value::String(reason);
        }
        v.to_string()
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

    #[wasm_bindgen(js_name = setStop)]
    pub fn set_stop(&mut self, id: i32, floor: i32, stop: bool) -> bool {
        self.sim.tower.set_stop(id.into(), floor.into(), stop)
    }

    #[wasm_bindgen(js_name = setExpressStops)]
    pub fn set_express_stops(&mut self, id: i32) {
        self.sim.tower.set_express_stops(id.into());
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

    /// `callExterminator()`: JSON `{ ok, reason? }`.
    #[wasm_bindgen(js_name = callExterminator)]
    pub fn call_exterminator(&mut self) -> String {
        match self.sim.call_exterminator() {
            Ok(_) => outcome(true, None),
            Err(r) => outcome(false, Some(r.reason())),
        }
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
}

/// Fixed header slots of the frame view, before the three variable sections.
pub const FRAME_HEADER: usize = 26;

/// Fixed slots of a person record, before its route (`floors` then `shafts`).
pub const PERSON_FIXED: usize = 18;

/// The per-frame read model: every value the web host reads from the
/// simulation between two structural syncs, flat so it crosses the WASM
/// boundary as one typed array.
///
/// Header (`FRAME_HEADER` slots): 0 minutes, 1 tower revision, 2 meal
/// overlay revision, 3 logSeq, 4 money, 5 star, 6 weather (0 clear, 1 cloudy,
/// 2 rain), 7 santaFxSeq, 8..10 explosionFx (seq, floor, x), 11..13 thiefFx
/// (seq, caught, floor), 14..16 treasureFx (seq, floor, x), 17 vipFxSeq,
/// 18..20 event counts (fires, firesGutRooms, bombs), 21 a pending choice
/// (0 or 1), 22 onHourRuns, 23 people count, 24 unit count, 25 transport
/// count.
///
/// Then `people count` records of `PERSON_FIXED + floors + shafts`: id, seed,
/// staff (0 or 1), state (the `PersonState` index), floor, x, fy, wait, then
/// the routing slice the suites read: originFloor (always present, so -1 is
/// a real basement floor), originUnitId, venueUnitId, mealVenueId (each -1
/// when absent), countedHotelGuest (0 or 1), routine
/// (0 none, 1 schoolRun, 2 salesCall), returning (0 or 1), dwellSecondsLeft
/// (NaN when absent: a drained timer stays negative on the person through
/// the return leg, so no number is free), the floors count, the shafts
/// count, then the route's floors and its shafts. Then `unit count` records
/// of 6: id, state (the `UnitState` index), occupants, customersIn,
/// hotelCustomersIn, outForMeal (an absent counter is -1). Then
/// `transport count` records of `2 + 3 * cars`: id, cars, then per car
/// position, load (-1 when the shaft keeps none), direction.
pub fn frame_view(sim: &Simulation) -> Vec<f64> {
    use crate::crowd::PState;
    use crate::sim_loop::Weather;
    use crate::tower::UnitState;
    let people = &sim.crowd.people;
    let units = &sim.tower.units;
    let transports = &sim.tower.transports;
    let mut v = Vec::with_capacity(
        FRAME_HEADER
            + people
                .iter()
                .map(|p| PERSON_FIXED + p.floors.len() + p.shafts.len())
                .sum::<usize>()
            + units.len() * 6
            + transports
                .iter()
                .map(|t| 2 + 3 * t.cars as usize)
                .sum::<usize>(),
    );
    let fx = &sim.fx;
    v.extend_from_slice(&[
        sim.clock.minutes,
        sim.tower.revision as f64,
        sim.tower.meal_overlay_revision as f64,
        sim.log_seq as f64,
        sim.money,
        sim.star as f64,
        match sim.weather {
            Weather::Clear => 0.0,
            Weather::Cloudy => 1.0,
            Weather::Rain => 2.0,
        },
        fx.santa_seq as f64,
        fx.explosion.seq as f64,
        fx.explosion.floor as f64,
        fx.explosion.x,
        fx.thief.seq as f64,
        if fx.thief.caught { 1.0 } else { 0.0 },
        fx.thief.floor as f64,
        fx.treasure.seq as f64,
        fx.treasure.floor as f64,
        fx.treasure.x,
        fx.vip_seq as f64,
        sim.events.fires_started as f64,
        sim.events.fires_gut_rooms as f64,
        sim.events.bombs_detonated as f64,
        if sim.events.pending.is_some() {
            1.0
        } else {
            0.0
        },
        sim.on_hour_runs as f64,
        people.len() as f64,
        units.len() as f64,
        transports.len() as f64,
    ]);
    debug_assert_eq!(v.len(), FRAME_HEADER);
    for p in people {
        let state = match p.state {
            PState::ToShaft => 0.0,
            PState::Waiting => 1.0,
            PState::Riding => 2.0,
            PState::Climbing => 3.0,
            PState::ToDest => 4.0,
            PState::Dwelling => 5.0,
            PState::Done => 6.0,
        };
        let id = |v: Option<i64>| v.map_or(-1.0, |n| n as f64);
        let flag = |b: bool| if b { 1.0 } else { 0.0 };
        let routine = match p.routine {
            None => 0.0,
            Some("schoolRun") => 1.0,
            Some("salesCall") => 2.0,
            // The routines are engine-set literals; a new one must be added
            // here and to `ROUTINES` in frameView.ts, and until then it
            // crosses as none.
            Some(other) => {
                debug_assert!(false, "routine {other} has no frame code");
                0.0
            }
        };
        v.extend_from_slice(&[
            p.id as f64,
            p.seed as f64,
            flag(p.staff),
            state,
            p.floor as f64,
            p.x,
            p.fy,
            p.wait,
            p.origin_floor as f64,
            id(p.origin_unit_id),
            id(p.venue_unit_id),
            id(p.meal_venue_id),
            flag(p.counted_hotel_guest),
            routine,
            flag(p.returning),
            p.dwell_seconds_left.unwrap_or(f64::NAN),
            p.floors.len() as f64,
            p.shafts.len() as f64,
        ]);
        v.extend(p.floors.iter().map(|f| *f as f64));
        v.extend(p.shafts.iter().map(|s| *s as f64));
    }
    let counter = |c: Option<i64>| c.map_or(-1.0, |n| n as f64);
    for u in units {
        let state = match u.state {
            UnitState::Construction => 0.0,
            UnitState::Empty => 1.0,
            UnitState::Occupied => 2.0,
            UnitState::MovingIn => 3.0,
            UnitState::Vacating => 4.0,
            UnitState::Asleep => 5.0,
            UnitState::Dirty => 6.0,
            UnitState::Infested => 7.0,
            UnitState::Fire => 8.0,
            UnitState::Gutted => 9.0,
        };
        v.extend_from_slice(&[
            u.id as f64,
            state,
            u.occupants as f64,
            counter(u.customers_in),
            counter(u.hotel_customers_in),
            counter(u.out_for_meal),
        ]);
    }
    for t in transports {
        v.push(t.id as f64);
        v.push(t.cars as f64);
        for i in 0..t.cars as usize {
            v.push(t.car_positions.get(i).copied().unwrap_or(0.0));
            v.push(
                t.car_load
                    .as_ref()
                    .and_then(|l| l.get(i).copied())
                    .unwrap_or(-1.0),
            );
            v.push(t.car_dir.get(i).copied().unwrap_or(0) as f64);
        }
    }
    v
}

/// The log entries numbered after `seq`, oldest first. The ring's entries
/// are numbered from `log_seq` backwards, so the last entry is `log_seq`.
pub fn log_since(sim: &Simulation, seq: i64) -> Value {
    let len = sim.log.len() as i64;
    let first = sim.log_seq - len + 1;
    Value::Array(
        sim.log
            .iter()
            .enumerate()
            .map(|(i, e)| (first + i as i64, e))
            .filter(|(n, _)| *n > seq)
            .map(|(n, e)| {
                serde_json::json!({ "seq": n, "minute": e.minute, "text": e.text, "kind": e.kind.as_str() })
            })
            .collect(),
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The two TDT free functions answer every lock case the way the referee
    /// does: the JSON envelope carries the pinned save and warnings, each
    /// refusal carries the pinned message, and each embedded export matches
    /// its pinned bytes or refusal.
    #[test]
    fn the_tdt_binding_answers_from_the_lock() {
        use crate::canonical::digest;
        use crate::tdt::referee::{inflate, read_lock, sha256_hex};
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let lock = read_lock(&root.join("conformance").join("tdt-cases.json")).expect("lock");
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
    fn the_frame_view_carries_the_header_and_one_record_per_person_unit_and_car() {
        // A real tower, so the view carries people, every unit kind and cars.
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/tests/fixtures/towerone-star4.vctower"
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
