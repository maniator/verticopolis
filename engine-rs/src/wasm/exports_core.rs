//! Lifecycle, state reads and the first commands of the binding (`Engine` members).

use wasm_bindgen::prelude::*;

use crate::canonical::{canonical_json, digest};
use crate::load_stream::parse_mode;
use crate::sim::Simulation;
use crate::snapshot::state_view;

use super::{apply_markers, err, Engine};

#[wasm_bindgen]
impl Engine {
    /// `serialize()`, byte for byte, which also becomes the base the next
    /// `saveDelta` is taken against (#1045, `crate::save_delta`).
    #[wasm_bindgen(js_name = serializeForSync)]
    pub fn serialize_for_sync(&mut self) -> String {
        self.mirror.full(&self.sim)
    }

    /// What moved in the save since the last sync: `{ units, rest }` as JSON
    /// text (the changed unit records, and every other top-level key).
    /// `undefined` when units were added, removed or reordered, or no full
    /// save was taken yet: the host then takes a full one.
    #[wasm_bindgen(js_name = saveDelta)]
    pub fn save_delta(&mut self) -> Option<String> {
        self.mirror.delta(&mut self.sim)
    }

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
        Ok(Engine::of(Simulation::new_game_with(
            seed,
            mode,
            calendar,
            start_unbridged.unwrap_or(false),
        )))
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
        Ok(Engine::of(sim))
    }

    /// The import path for a `.vctower` file: decode, migrate and load, then
    /// mark a save from before 2.0 as a founder's tower. `mode`, when given,
    /// overwrites the save's mode before loading, as a scenario start does.
    #[wasm_bindgen(js_name = fromVctower)]
    pub fn from_vctower(text: &str, mode: Option<String>) -> Result<Engine, JsError> {
        // Decoded, then read as `fromSave` reads a save, with the mode set.
        let sim = crate::load_stream::load_vctower_text(text, mode.as_deref()).map_err(err)?;
        Ok(Engine::of(sim))
    }

    /// `serialize()` as JSON text.
    pub fn serialize(&self) -> String {
        self.sim.save_text()
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
}
