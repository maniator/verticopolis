//! Build, edit and price commands of the binding (`Engine` members).

use wasm_bindgen::prelude::*;

use super::{build_result, can_build_json, err, facade_commands, parse_kind, Engine};

#[wasm_bindgen]
impl Engine {
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

    /// `paintBrush(kind, floor, tiles)` with the tiles as JSON text: JSON
    /// `{ placed, reason? }`, the floor and lobby brush (`brush.rs`) in one
    /// call. Every argument is read raw, so a malformed brush is refused
    /// with "That request is not valid." as TypeScript refuses it.
    #[wasm_bindgen(js_name = paintBrush)]
    pub fn paint_brush(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "string")] kind: JsValue,
        #[wasm_bindgen(unchecked_param_type = "number")] floor: JsValue,
        #[wasm_bindgen(unchecked_param_type = "string")] tiles: JsValue,
    ) -> String {
        self.paint_brush_checked(kind.as_string(), floor.as_f64(), tiles.as_string())
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
}
