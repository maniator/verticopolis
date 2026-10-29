//! Stops, labels, events and the sync reads of the binding (`Engine` members).

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
