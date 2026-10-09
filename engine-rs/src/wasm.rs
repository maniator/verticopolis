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
    /// `Simulation.newGame(seed, mode)`.
    #[wasm_bindgen(js_name = newGame)]
    pub fn new_game(seed: u32, mode: &str) -> Result<Engine, JsError> {
        Ok(Engine {
            sim: Simulation::new_game(seed, parse_mode(mode).map_err(err)?),
        })
    }

    /// `Simulation.deserialize(JSON.parse(text))`: a serialized game, migrated
    /// and loaded. Nothing else the import path does (the founder mark) runs.
    #[wasm_bindgen(js_name = fromSave)]
    pub fn from_save(text: &str) -> Result<Engine, JsError> {
        let raw: Value = serde_json::from_str(text).map_err(err)?;
        Ok(Engine {
            sim: crate::load::deserialize(&raw).map_err(err)?,
        })
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
