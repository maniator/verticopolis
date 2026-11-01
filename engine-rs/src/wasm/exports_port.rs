//! The port members of `Engine`: the view, commands, files, edits and life.

use wasm_bindgen::prelude::*;

/// The engine's port (facade slice 7, the owner's 2026-10-28 redesign): the
/// game calls these on `Engine` directly, every argument a number and every
/// answer a number or a record of numbers, with no JSON. A command answers
/// its result record (status, the balance's change, its own slots); a
/// refusal's text is `lastReason()`. The logic is in `wasm_port.rs`.
use super::{port, Engine};

// This low-frequency inspector API deliberately returns a keyed JS object.
// JSON.parse is an existing wasm-bindgen import; no new crates or runtime
// types are required. Frame and crowd buffers remain compact numeric records.
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = JSON, js_name = parse)]
    fn parse_service_diagnostics_json(text: &str) -> JsValue;
}

#[wasm_bindgen]
impl Engine {
    // The view's layout (facade slice 6a, #1213) as JSON: the version,
    // every slot and width of the dynamic frame and the structural snapshot
    // by name, the kind, state, weather, mode and calendar codes
    // (`view::layout_json`), and the port's records and codes
    // (`port::exported_layout`). A host checks it on load and refuses a
    // version or width it does not know. An instance member, so `Engine`
    // itself satisfies the port's interface.
    #[wasm_bindgen(js_name = viewLayout)]
    pub fn instance_view_layout(&self) -> String {
        port::exported_layout().to_string()
    }
    #[wasm_bindgen(js_name = lastReason)]
    pub fn last_reason(&self) -> Option<String> {
        self.last_reason_text()
    }
    #[wasm_bindgen(js_name = buildAt)]
    pub fn build_at(&mut self, kind: f64, floor: f64, x: f64) -> Vec<f64> {
        self.port_build(kind, floor, x)
    }
    #[wasm_bindgen(js_name = paintTiles)]
    pub fn paint_tiles(&mut self, kind: f64, floor: f64, tiles: &[f64]) -> Vec<f64> {
        self.port_paint(kind, floor, tiles)
    }
    #[wasm_bindgen(js_name = buildShaft)]
    pub fn build_shaft(&mut self, kind: f64, x: f64, bottom: f64, top: f64) -> Vec<f64> {
        self.port_build_shaft(kind, x, bottom, top)
    }
    pub fn demolish(&mut self, id: f64, bulldoze: bool) -> Vec<f64> {
        self.port_demolish(id, bulldoze)
    }
    #[wasm_bindgen(js_name = demolishTile)]
    pub fn demolish_tile(&mut self, floor: f64, x: f64, bulldoze: bool) -> Vec<f64> {
        self.port_demolish_tile(floor, x, bulldoze)
    }
    #[wasm_bindgen(js_name = changeCars)]
    pub fn change_cars(&mut self, id: f64, add: bool) -> Vec<f64> {
        self.port_cars(id, add)
    }
    #[wasm_bindgen(js_name = extendShaft)]
    pub fn extend_shaft(&mut self, id: f64, up: bool, target_floor: f64) -> Vec<f64> {
        self.port_extend(id, up, target_floor)
    }
    #[wasm_bindgen(js_name = bookExterminator)]
    pub fn book_exterminator(&mut self) -> Vec<f64> {
        self.port_book_exterminator()
    }
    #[wasm_bindgen(js_name = setCamera)]
    pub fn set_camera(&mut self, tile: f64, floor: f64, zoom: f64) -> Vec<f64> {
        self.port_set_camera(tile, floor, zoom)
    }
    #[wasm_bindgen(js_name = setFilm)]
    pub fn set_film(&mut self, id: f64, policy: f64) -> Vec<f64> {
        self.port_set_film(id, policy)
    }
    #[wasm_bindgen(js_name = quoteBuild)]
    pub fn quote_build(&mut self, kind: f64, floor: f64, x: f64) -> Vec<f64> {
        self.port_quote_build(kind, floor, x).to_vec()
    }
    #[wasm_bindgen(js_name = quoteShaft)]
    pub fn quote_shaft(&mut self, kind: f64, x: f64, bottom: f64, top: f64) -> Vec<f64> {
        vec![self.port_quote_shaft(kind, x, bottom, top)]
    }
    #[wasm_bindgen(js_name = quoteRentBatch)]
    pub fn quote_rent_batch(&mut self, kind: f64, target: f64, only_default: bool) -> Vec<f64> {
        self.port_quote_rent_batch(kind, target, only_default)
            .to_vec()
    }
    #[wasm_bindgen(js_name = statsStrip)]
    pub fn stats_strip(&self) -> Vec<f64> {
        self.sim.tower_stats_record().to_vec()
    }
    pub fn hotspot(&self) -> Vec<f64> {
        self.port_hotspot().to_vec()
    }
    pub fn onboarding(&self) -> f64 {
        self.port_onboarding()
    }
    #[wasm_bindgen(js_name = evaluatedTower)]
    pub fn evaluated_tower(&self) -> bool {
        self.port_evaluated_tower()
    }
    // The panel queries (`wasm_port_panels.rs`): the overlay's cells, the
    // crew coverage and the unit and shaft cards, each a record the layout
    // names.
    #[wasm_bindgen(js_name = heatCells)]
    pub fn heat_cells(&self, mode: f64) -> Vec<f64> {
        self.port_heat_cells(mode)
    }
    #[wasm_bindgen(js_name = crewCoverage)]
    pub fn crew_coverage(&self) -> Vec<f64> {
        self.port_crew_coverage()
    }
    #[wasm_bindgen(js_name = unitCard)]
    pub fn unit_card(&mut self, id: f64) -> Vec<f64> {
        self.port_unit_card(id)
    }
    #[wasm_bindgen(js_name = shaftCard)]
    pub fn shaft_card(&self, id: f64) -> Vec<f64> {
        self.port_shaft_card(id)
    }
    #[wasm_bindgen(js_name = statsSheet)]
    pub fn stats_sheet(&mut self) -> Vec<f64> {
        self.port_stats_sheet()
    }
    #[wasm_bindgen(js_name = serviceDiagnostics)]
    pub fn service_diagnostics(&self, id: f64) -> JsValue {
        match self.port_service_diagnostics(id) {
            Some(text) => parse_service_diagnostics_json(&text),
            None => JsValue::UNDEFINED,
        }
    }

    #[wasm_bindgen(js_name = unitFacts)]
    pub fn unit_facts(&mut self, id: f64) -> Vec<f64> {
        self.port_unit_facts(id)
    }
    // The render queries (`wasm_port_render.rs`).
    pub fn congestion(&mut self) -> f64 {
        self.port_congestion()
    }
    #[wasm_bindgen(js_name = queueView)]
    pub fn queue_view(&mut self) -> Vec<f64> {
        self.port_queue_view()
    }
    #[wasm_bindgen(js_name = parkingSet)]
    pub fn parking_set(&self) -> Vec<f64> {
        self.port_parking_set()
    }
    #[wasm_bindgen(js_name = parkingUsage)]
    pub fn parking_usage(&self, spots: f64) -> f64 {
        self.port_parking_usage(spots)
    }
    #[wasm_bindgen(js_name = recyclingFill)]
    pub fn recycling_fill(&self) -> f64 {
        self.port_recycling_fill()
    }
    #[wasm_bindgen(js_name = recyclingCapacity)]
    pub fn recycling_capacity(&self) -> f64 {
        self.port_recycling_capacity()
    }
    #[wasm_bindgen(js_name = positionReachable)]
    pub fn position_reachable(&mut self, floor: f64, x: f64) -> bool {
        self.port_position_reachable(floor, x)
    }
}

/// The port's file members (`wasm_port_files.rs`).
#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(js_name = loadVctower)]
    pub fn load_vctower(&mut self, text: &str) -> Vec<f64> {
        self.port_load_vctower(text)
    }
    #[wasm_bindgen(js_name = exportVctower)]
    pub fn export_vctower(&mut self, app_version: &str, saved_at_ms: f64) -> Option<String> {
        self.port_export_vctower(app_version, saved_at_ms)
    }
    #[wasm_bindgen(js_name = loadTdt)]
    pub fn load_tdt(&mut self, bytes: &[u8], filename: &str) -> Vec<f64> {
        self.port_load_tdt(bytes, filename)
    }
    #[wasm_bindgen(js_name = tdtNote)]
    pub fn tdt_note(&self, i: f64) -> Option<String> {
        self.port_tdt_note(i)
    }
    #[wasm_bindgen(js_name = tdtTowerName)]
    pub fn tdt_tower_name(&self) -> Option<String> {
        self.port_tdt_tower_name()
    }
    #[wasm_bindgen(js_name = adoptTdt)]
    pub fn adopt_tdt(&mut self) -> Vec<f64> {
        self.port_adopt_tdt()
    }
    #[wasm_bindgen(js_name = tdtExport)]
    pub fn tdt_export(&mut self) -> Vec<f64> {
        self.port_tdt_export()
    }
    #[wasm_bindgen(js_name = tdtFile)]
    pub fn tdt_file(&mut self) -> Option<Vec<u8>> {
        self.port_tdt_file()
    }
}

/// The port's editing commands (`wasm_port_edit.rs`): named apart from the
/// legacy exports the conformance suites still call, which keep their old
/// answers until the callers move.
#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(js_name = markStop)]
    pub fn mark_stop(&mut self, id: f64, floor: f64, stop: bool) -> Vec<f64> {
        self.port_mark_stop(id, floor, stop)
    }
    #[wasm_bindgen(js_name = expressStops)]
    pub fn express_stops(&mut self, id: f64) -> Vec<f64> {
        self.port_express_stops(id)
    }
    #[wasm_bindgen(js_name = dropStops)]
    pub fn drop_stops(&mut self, id: f64) -> Vec<f64> {
        self.port_drop_stops(id)
    }
    #[wasm_bindgen(js_name = stepRent)]
    pub fn step_rent(&mut self, id: f64, dir: f64) -> Vec<f64> {
        self.port_step_rent(id, dir)
    }
    #[wasm_bindgen(js_name = noRate)]
    pub fn no_rate(&mut self, id: f64) -> Vec<f64> {
        self.port_no_rate(id)
    }
    #[wasm_bindgen(js_name = setRent)]
    pub fn set_rent(&mut self, id: f64, target: f64) -> Vec<f64> {
        self.port_set_rent(id, target)
    }
    #[wasm_bindgen(js_name = rentBatch)]
    pub fn rent_batch(&mut self, kind: f64, target: f64, only_default: bool) -> Vec<f64> {
        self.port_rent_batch(kind, target, only_default)
    }
    #[wasm_bindgen(js_name = rerollUnit)]
    pub fn reroll_unit(&mut self, id: f64) -> Vec<f64> {
        self.port_reroll_unit(id)
    }
    #[wasm_bindgen(js_name = answerChoice)]
    pub fn answer_choice(&mut self, accept: bool) -> Vec<f64> {
        self.port_answer_choice(accept)
    }
    #[wasm_bindgen(js_name = chooseAutoBridge)]
    pub fn choose_auto_bridge(&mut self, value: bool) -> Vec<f64> {
        self.port_choose_auto_bridge(value)
    }
    #[wasm_bindgen(js_name = flipAutoBridge)]
    pub fn flip_auto_bridge(&mut self) -> Vec<f64> {
        self.port_flip_auto_bridge()
    }
    #[wasm_bindgen(js_name = startExtend)]
    pub fn start_extend(&mut self, id: f64) -> Vec<f64> {
        self.port_start_extend(id)
    }
    #[wasm_bindgen(js_name = stopExtend)]
    pub fn stop_extend(&mut self) -> Vec<f64> {
        self.port_stop_extend()
    }
    #[wasm_bindgen(js_name = labelUnit)]
    pub fn label_unit(&mut self, id: f64, text: &str) -> Vec<f64> {
        self.port_label_unit(id, text)
    }
    #[wasm_bindgen(js_name = nameTower)]
    pub fn name_tower(&mut self, text: Option<String>) -> Vec<f64> {
        self.port_name_tower(text)
    }
}

/// The port's lifecycle, events, log and text getters (`wasm_port_life.rs`).
#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(js_name = loadSave)]
    pub fn load_save(&mut self, text: &str) -> Vec<f64> {
        self.port_load_save(text)
    }
    pub fn restore(&mut self, text: &str) -> Vec<f64> {
        self.port_restore(text)
    }
    #[wasm_bindgen(js_name = foundTower)]
    pub fn found_tower(
        &mut self,
        seed: f64,
        mode: f64,
        calendar: f64,
        unbridged: bool,
    ) -> Vec<f64> {
        self.port_found(seed, mode, calendar, unbridged)
    }
    pub fn generation(&self) -> f64 {
        self.generation as f64
    }
    pub fn advance(
        &mut self,
        owed: f64,
        dt_ms: f64,
        minutes_per_second: f64,
        steady_clock: bool,
        step: bool,
    ) -> Vec<f64> {
        self.port_advance(owed, dt_ms, minutes_per_second, steady_clock, step)
    }
    #[wasm_bindgen(js_name = undoSignature)]
    pub fn undo_signature(&self) -> String {
        self.port_undo_signature()
    }
    #[wasm_bindgen(js_name = drainEvents)]
    pub fn drain_events(&mut self) -> Vec<f64> {
        self.port_drain_events()
    }
    #[wasm_bindgen(js_name = eventText)]
    pub fn event_text(&self, i: f64) -> Option<String> {
        self.port_event_text(i)
    }
    #[wasm_bindgen(js_name = setBackdrop)]
    pub fn set_backdrop(&mut self, on: bool) {
        self.port_set_backdrop(on)
    }
    #[wasm_bindgen(js_name = unitMetaChanged)]
    pub fn unit_meta_changed(&self, since: f64) -> Vec<f64> {
        self.port_unit_meta_changed(since)
    }
    #[wasm_bindgen(js_name = unitLabel)]
    pub fn unit_label(&self, id: f64) -> Option<String> {
        self.port_unit_label(id)
    }
    #[wasm_bindgen(js_name = unitSubtype)]
    pub fn unit_subtype(&self, id: f64) -> Option<String> {
        self.port_unit_subtype(id)
    }
    #[wasm_bindgen(js_name = logAfter)]
    pub fn log_after(&self, seq: f64) -> Vec<f64> {
        self.port_log_after(seq)
    }
    #[wasm_bindgen(js_name = logText)]
    pub fn log_text(&self, seq: f64) -> Option<String> {
        self.port_log_text(seq)
    }
    #[wasm_bindgen(js_name = logLine)]
    pub fn log_line(&mut self, text: &str, kind: f64) -> Vec<f64> {
        self.port_log_line(text, kind)
    }
    #[wasm_bindgen(js_name = scheduleShaft)]
    pub fn schedule_shaft(&mut self, id: f64, slots: &[f64]) -> Vec<f64> {
        self.port_schedule_shaft(id, slots)
    }
    #[wasm_bindgen(js_name = shaftSchedule)]
    pub fn shaft_schedule(&self, id: f64) -> Vec<f64> {
        self.port_shaft_schedule(id)
    }
    pub fn founder(&self) -> bool {
        self.port_founder()
    }
}
