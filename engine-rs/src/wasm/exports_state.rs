//! Stops, labels, events and the sync reads of the binding (`Engine` members).

#[cfg(feature = "tooling")]
use serde_json::Value;
use wasm_bindgen::prelude::*;

pub use crate::frame::{frame_view, log_since};

use super::{err, facade_commands, pending_json, Engine};

#[wasm_bindgen]
impl Engine {
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

    /// Tooling: a fire, which is no edit, so it is no part of an open
    /// gesture's undo step.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = startFire)]
    pub fn start_fire(&mut self) {
        self.sim.outside_the_gesture(|s| s.start_fire());
    }

    /// Tooling only: the daily roll's fire outbreak in room `id`, with the
    /// paid-rescue offer it raises, so a test can set a chosen room ablaze
    /// mid-run (`startFire` picks a room at random and offers nothing). It
    /// draws nothing from the random stream. False, changing nothing, while
    /// a fire burns or a choice is pending, or when `id` names no room that
    /// can catch fire. Like `startFire`, this is not part of an open undo step.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = startFireAt)]
    pub fn start_fire_at(&mut self, id: f64) -> bool {
        whole_id(id).is_some_and(|id| self.sim.outside_the_gesture(|s| s.start_fire_at(id)))
    }

    /// Tooling: a bomb threat, outside an open gesture as a fire is.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = bombThreat)]
    pub fn bomb_threat(&mut self) {
        self.sim.outside_the_gesture(|s| s.bomb_threat());
    }

    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = evaluateStar)]
    pub fn evaluate_star(&mut self) {
        self.sim.evaluate_star();
    }

    /// Tooling only: put the clock at `minutes`, forward or back, and run
    /// nothing: the TypeScript `sim.clock = new Clock(minutes, calendar)`
    /// that tests use to pin an hour once the crowd exists. The loop's pass
    /// memos stay as they are, as with `advanceClock`, so a pass the move
    /// skips runs once on the next tick. A literal 0 is 07:00 on day 0, as at
    /// founding. False, changing nothing, for a value that is not finite, is
    /// below 0 or is past [`MAX_TOOL_CLOCK_MINUTES`].
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = setClock)]
    pub fn set_clock(&mut self, minutes: f64) -> bool {
        if !minutes.is_finite() || !(0.0..=MAX_TOOL_CLOCK_MINUTES).contains(&minutes) {
            return false;
        }
        self.sim.clock = crate::clock::Clock::new(minutes, self.sim.clock.calendar);
        true
    }

    /// Tooling only: set a unit's state by its save name, and its occupants
    /// when given (a test holds a venue open or a condo full). False for an
    /// unknown unit or state, for "construction" and "fire" (each needs its
    /// own timer or event record, which this write cannot make), or for
    /// occupants that are not a whole number from 0 to
    /// [`MAX_TOOL_OCCUPANTS`]; nothing changes then.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = setUnitState)]
    pub fn set_unit_state(&mut self, id: f64, state: &str, occupants: Option<f64>) -> bool {
        let Some(state) = crate::tower::UnitState::from_name(state) else {
            return false;
        };
        if needs_its_own_record(state) {
            return false;
        }
        if occupants.is_some_and(|n| n.fract() != 0.0 || !(0.0..=MAX_TOOL_OCCUPANTS).contains(&n)) {
            return false;
        }
        let Some((unit, at)) = whole_id(id).and_then(|id| self.sim.tower.marked_by_id(id)) else {
            return false;
        };
        unit.set_state(at, state);
        if let Some(n) = occupants {
            unit.set_occupants(at, n as i64);
        }
        true
    }

    /// Tooling only: a tenant leaves unit `id` for `reason` (a departure
    /// cause's save name), the TypeScript `sim.vacate(u, reason)`, so a test
    /// can empty a chosen room mid-run. It is the churn pass's departure, so
    /// a sold condo is bought back. Like a fire, it is not part of an open
    /// undo step. The unit's kind is not checked. False, changing nothing,
    /// for an unknown unit or cause.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = vacateUnit)]
    pub fn vacate_unit(&mut self, id: f64, reason: &str) -> bool {
        let Some(reason) = super::port_panels::VACATE_REASONS
            .iter()
            .copied()
            .find(|known| *known == reason)
        else {
            return false;
        };
        let Some(i) =
            whole_id(id).and_then(|id| self.sim.tower.units.iter().position(|u| u.id == id))
        else {
            return false;
        };
        self.sim.outside_the_gesture(|s| s.vacate(i, reason));
        true
    }

    /// Tooling only: write unit `id`'s price as given, with no ladder snap
    /// or band clamp, or clear it with null, the TypeScript `u.rent = value`.
    /// A test uses it for a legacy off-ladder price or an unpriced room,
    /// which a load would snap onto the ladder. False, changing nothing, for
    /// an unknown unit or a price that is not finite or is below 0.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = setUnitRent)]
    pub fn set_unit_rent(&mut self, id: f64, rent: Option<f64>) -> bool {
        if rent.is_some_and(|r| !r.is_finite() || r < 0.0) {
            return false;
        }
        let Some((unit, _)) = whole_id(id).and_then(|id| self.sim.tower.marked_by_id(id)) else {
            return false;
        };
        unit.rent = rent;
        true
    }

    /// Tooling only: set a unit's live customer tally (`customersIn`), which
    /// no save carries, so a test can fill a venue to capacity mid-run, with
    /// the follow-ups a counted arrival makes (an attendance venue's occupants
    /// mirror, the meal overlay revision). False for an unknown unit or a
    /// count that is not a whole number from 0 to [`MAX_TOOL_OCCUPANTS`];
    /// nothing changes then. The unit's kind and its venue cap are not
    /// checked: any unit takes the stamp, at any count in that range.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = setCustomersIn)]
    pub fn set_customers_in(&mut self, id: f64, count: f64) -> bool {
        if count.fract() != 0.0 || !(0.0..=MAX_TOOL_OCCUPANTS).contains(&count) {
            return false;
        }
        let Some((unit, at)) = whole_id(id).and_then(|id| self.sim.tower.marked_by_id(id)) else {
            return false;
        };
        // What a counted arrival does after its increment: an attendance
        // venue mirrors the tally into its occupants, and the meal overlay moves.
        unit.set_customers_in(at, Some(count as i64));
        unit.sync_attendance_occupants(at);
        self.sim.tower.bump_meal_overlay_revision();
        true
    }

    /// Tooling only: set today's weather by its save name ("clear",
    /// "cloudy" or "rain"), the TypeScript `sim.weather = w`. No save carries
    /// it, and the next day's roll replaces it. False, changing nothing, for
    /// any other name.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = setWeather)]
    pub fn set_weather(&mut self, name: &str) -> bool {
        use crate::sim_loop::Weather;
        self.sim.weather = match name {
            "clear" => Weather::Clear,
            "cloudy" => Weather::Cloudy,
            "rain" => Weather::Rain,
            _ => return false,
        };
        true
    }

    /// Tooling only: clear every unit's four retail tallies (patronage and
    /// profit, today and yesterday), the render-only fields no economy path
    /// reads, so a test can show that clearing them changes no money.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = clearRetailTallies)]
    pub fn clear_retail_tallies(&mut self) {
        for u in self.sim.tower.units.iter_mut() {
            let t = u.extras();
            let tallied = t.patronage_today.is_some()
                || t.patronage_yest.is_some()
                || t.profit_today.is_some()
                || t.profit_yest.is_some();
            // Only a unit with a tally opens its extras: a write through
            // `extras_mut` on a unit without any boxes a record just to drop it.
            if !tallied {
                continue;
            }
            let mut tally = u.extras_mut();
            tally.patronage_today = None;
            tally.patronage_yest = None;
            tally.profit_today = None;
            tally.profit_yest = None;
        }
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

    /// The bomb search while one runs, as JSON `{ deadline, sweeping,
    /// searched, seq, lockdown }` (`sweeping` holds `{ floor, left, right }`
    /// for each floor a guard is on, `searched` the floors already clear,
    /// `lockdown` whether guards are still out so people and cars hold
    /// still), or null. The bomb's hiding place stays out. A host reads it
    /// when the frame's `bombSearchSeq` moves.
    #[wasm_bindgen(js_name = bombSearch)]
    pub fn bomb_search(&self) -> Option<String> {
        self.sim.bomb_search_view().map(|v| v.to_string())
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
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = seedElevatorTelemetry)]
    pub fn seed_elevator_telemetry(&mut self, json: &str) -> Result<(), JsError> {
        let doc: Value = serde_json::from_str(json).map_err(err)?;
        self.sim.seed_telemetry(&doc).map_err(err)
    }

    /// Move the clock by `minutes` and run nothing: the TypeScript
    /// `clock.advance(minutes)`. Whatever pass the move skips is owed and runs
    /// on the next tick, as on the TypeScript engine. Tooling only (the
    /// gallery's clock pin); no game command reaches it.
    #[cfg(feature = "tooling")]
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
    #[cfg(feature = "tooling")]
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
    /// JSON `[{ name, payload }]` (`engine-rs/src/gameplay/catalog.json`); the
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

#[cfg(feature = "tooling")]
/// The latest clock `setClock` takes, in minutes (about 1,900 years): far past
/// any game, and small enough that a tick still moves the clock.
const MAX_TOOL_CLOCK_MINUTES: f64 = 1e9;

#[cfg(feature = "tooling")]
/// The largest count `setUnitState` writes as occupants and `setCustomersIn`
/// writes as customers: the largest whole number a JavaScript number holds
/// exactly, so both engines store the same count.
const MAX_TOOL_OCCUPANTS: f64 = 9_007_199_254_740_991.0;

#[cfg(feature = "tooling")]
/// A state the engine enters only alongside a record of its own (a
/// construction timer, an active fire), which a bare state write cannot make.
fn needs_its_own_record(state: crate::tower::UnitState) -> bool {
    matches!(
        state,
        crate::tower::UnitState::Construction | crate::tower::UnitState::Fire
    )
}

#[cfg(feature = "tooling")]
/// A unit id the binding was handed as a number: whole and in range.
fn whole_id(id: f64) -> Option<i64> {
    (id.fract() == 0.0 && id.abs() < 9007199254740992.0).then_some(id as i64)
}

#[cfg(test)]
#[cfg(feature = "tooling")]
#[path = "exports_state_tests.rs"]
mod tests;
