//! The port members of `Engine`: the facade answers, panels and root reads.

use wasm_bindgen::prelude::*;

/// The command answers the Rust-backed facade reads (slice 6d, #1216); the
/// logic is in `wasm_facade_commands.rs`.
use super::{err, Engine};

#[wasm_bindgen]
impl Engine {
    /// `buildSkyBridge(floor, x)` (Modern): lays the whole sky bridge a
    /// click at the cell asks for, every missing tile of the gap between
    /// two sky lobbies, or nothing, in look `look` (an index into the
    /// catalog's `rules.skyBridge.looks`; the glass skywalk when omitted).
    /// `[status, delta, tiles]`.
    #[wasm_bindgen(js_name = buildSkyBridge)]
    pub fn build_sky_bridge(&mut self, floor: f64, x: f64, look: f64) -> Vec<f64> {
        self.port_build_skybridge(floor, x, look)
    }

    /// `restyleSkyBridge(floor, x, look)` (Modern): dresses the whole sky
    /// bridge at the cell in look `look`, an index into the catalog's
    /// `rules.skyBridge.looks`. Free. `[status, delta]`.
    #[wasm_bindgen(js_name = restyleSkyBridge)]
    pub fn restyle_sky_bridge(&mut self, floor: f64, x: f64, look: f64) -> Vec<f64> {
        self.port_restyle_skybridge(floor, x, look)
    }

    /// `skyBridgeLooks()`: every sky bridge as `[floor, from, to, look]`,
    /// four numbers each, `from..to` its columns and `look` an index into the
    /// catalog's `rules.skyBridge.looks`. Read once per layout change.
    #[wasm_bindgen(js_name = skyBridgeLooks)]
    pub fn sky_bridge_looks(&self) -> Vec<f64> {
        self.port_skybridge_looks()
    }

    /// `quoteSkyBridge(floor, x)` (Modern): `[ok, cost, from, to]`, the
    /// tiles `from..to` a click would lay and their full price, for the
    /// tool's ghost; a refusal's text is `lastReason()`.
    #[wasm_bindgen(js_name = quoteSkyBridge)]
    pub fn quote_sky_bridge(&mut self, floor: f64, x: f64) -> Vec<f64> {
        self.port_quote_skybridge(floor, x).to_vec()
    }

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

/// The renderer-facing view (facade slice 6a, #1213): one-line wrappers over
/// `crate::view`, which documents each layout. Their notes, and
/// `viewLayout`'s above, are plain comments: wasm-bindgen copies doc
/// comments into the generated `src/engineBinding/engine.d.ts`, which the 500-line
/// ceiling holds.
#[wasm_bindgen]
impl Engine {
    // The recycling card from one read (#1745): `[population, capacity,
    // fill, demandMet]`, the population the centers serve (the one the
    // verdict and the fill use), what they can process, the bins' fill
    // from 0 to 1, and 1 when the demand is met or 0.
    #[wasm_bindgen(js_name = recyclingCard)]
    pub fn recycling_card(&mut self) -> Vec<f64> {
        self.port_recycling_card()
    }

    // The structural snapshot (`view::structure_view`): the floor bounds,
    // the mode and calendar, rooms by slot, floor and lobby tiles as runs,
    // transports with their skipped floors. Read again when the frame
    // header's tower revision moves.
    #[wasm_bindgen(js_name = viewStructure)]
    pub fn view_structure(&self) -> Vec<f64> {
        crate::view::structure_view(&self.sim)
    }

    // The dynamic frame (`view::ViewReader::frame`): the header, the
    // people, the rooms whose fields changed since the last call (every room
    // when `full` is `true`, on the first call, or after a structural
    // change, with the header's full flag set) and the cars. One reader per
    // engine, so one caller: the header's frame number tells it when it
    // missed a frame. Read raw: only a JS `true` asks for a full frame.
    #[wasm_bindgen(js_name = viewFrame)]
    pub fn view_frame(
        &self,
        #[wasm_bindgen(unchecked_param_type = "boolean")] full: JsValue,
    ) -> Vec<f64> {
        crate::view::view_frame(&self.sim, full.as_bool() == Some(true))
    }

    // The people window of the frame above (`view::PeopleWindow`): from the
    // next `viewFrame` on, its people are only those within floors
    // `floorLo..=floorHi` and tiles `xLo..=xHi`, padded so every rider of a
    // car on screen comes along. A number that is not finite, or an empty
    // range, clears it, and every person goes again. The camera only: the
    // game steps every person whatever it is, and nothing saves it.
    #[wasm_bindgen(js_name = setPeopleWindow)]
    pub fn set_people_window(&self, floor_lo: f64, floor_hi: f64, x_lo: f64, x_hi: f64) {
        let window = crate::view::PeopleWindow::new(floor_lo, floor_hi, x_lo, x_hi);
        crate::view::set_people_window(&self.sim, window);
    }

    // The labels and subtypes changed after the meta revision `since`, as
    // JSON `{ revision, full, units: [[id, label, subtype], ...] }`
    // (`view::meta_since`). Read raw: a `since` of 0, or of anything but a
    // whole JS number from the log's reach up to the current revision
    // (`undefined` from untyped JavaScript among them), gets a full listing.
    #[wasm_bindgen(js_name = unitMetaSince)]
    pub fn unit_meta_since(
        &self,
        #[wasm_bindgen(unchecked_param_type = "number")] since: JsValue,
    ) -> String {
        let since = crate::view::whole_revision(since.as_f64());
        crate::view::meta_since(&self.sim.tower, since).to_string()
    }

    // The tower signature (`Simulation::tower_signature`) as a `bigint`: two
    // reads are equal when the fields the tower half of `towerStateSig`
    // reads are equal, and differ when they differ (but for a 64-bit
    // collision). Undo reads it, beside money, at a gesture's capture and
    // commit; it walks every unit, so it is too slow to read each frame.
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

    /// The ids of the transports behind one floor's congestion reading
    /// (`Simulation::congestion_cause`), in the tower's transport order:
    /// what the Traffic readout points at when the player taps it. Empty for
    /// a floor with no reading and for one that is not a whole number. It
    /// builds the reading, so it is a read for a tap, not a frame.
    #[wasm_bindgen(js_name = congestionCause)]
    pub fn congestion_cause(&self, floor: f64) -> Vec<f64> {
        self.port_congestion_cause(floor)
    }

    /// The stretch of floor the waiting line at elevator `shaft` on `floor`
    /// covers, `[from, to]` in tiles with `from <= to`: from the shaft face
    /// it starts at to the rider standing farthest from it. Lines run beside the
    /// shaft across any shaft next to it, so this tells a frontend which
    /// riders stand in which line. Empty when nobody waits there, the shaft
    /// is not an elevator or the floor is not a whole number. One pass over
    /// the crowd, so it is a read for a tap, not a frame.
    #[wasm_bindgen(js_name = queueLine)]
    pub fn queue_line(&self, shaft: f64, floor: f64) -> Vec<f64> {
        self.port_queue_line(shaft, floor)
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

/// Facade slice 7a (#1217): what a host with no TypeScript tower reads once
/// per engine, beside the view's structure and frame.
#[wasm_bindgen]
impl Engine {
    /// The camera the save carries, as JSON text, or undefined when there is
    /// none. Read on a new engine; `setView` is how it changes.
    pub fn view(&self) -> Option<String> {
        self.sim.view.as_ref().map(|v| v.to_string())
    }

    /// The tower's name, or undefined when it has none (the save then leaves
    /// the key out). Read on a new engine; `setTowerName` is how it changes.
    #[wasm_bindgen(js_name = towerName)]
    pub fn tower_name(&self) -> Option<String> {
        self.sim.tower.tower_name.clone()
    }

    /// The file name a `.TDT` export of this tower downloads as: A to Z and
    /// 0 to 9 from its name, upper-cased and cut to 8 characters, and
    /// `TOWER1.TDT` for a name with none or a DOS device name (#1676).
    #[wasm_bindgen(js_name = tdtFilename)]
    pub fn tdt_filename(&self) -> String {
        self.port_tdt_filename()
    }
}

/// The binary `.vctower` file members (`wasm_port_files.rs`).
#[wasm_bindgen]
impl Engine {
    /// `loadVctower` for a file's bytes: a binary file (`VCTOWER2`) is read as
    /// it is, any other as its UTF-8 text.
    #[wasm_bindgen(js_name = loadVctowerBytes)]
    pub fn load_vctower_bytes(&mut self, bytes: &[u8]) -> Vec<f64> {
        self.port_load_vctower_bytes(bytes)
    }
    /// The tower as a binary `.vctower` file, stamped as `exportVctower`
    /// stamps it; undefined, with the reason in `lastReason()`, on a refusal.
    #[wasm_bindgen(js_name = exportVctowerBytes)]
    pub fn export_vctower_bytes(&mut self, app_version: &str, saved_at_ms: f64) -> Option<Vec<u8>> {
        self.port_export_vctower_bytes(app_version, saved_at_ms)
    }
    /// The closed code of the last refused tower file read or write, one of
    /// `too_large`, `not_tower`, `damaged`, `newer_version`, `not_save`,
    /// `unreadable`, `modern` or `refused`; undefined when the last one
    /// worked. Only the file members set or clear it. Unlike `lastReason()`
    /// it never quotes the file, so a host may send it as analytics (#2075).
    #[wasm_bindgen(js_name = lastRefusalCode)]
    pub fn last_refusal_code(&self) -> Option<String> {
        self.port_last_refusal_code()
    }
}
