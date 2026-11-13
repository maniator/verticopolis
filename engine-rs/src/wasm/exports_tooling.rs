//! Tooling members of the binding: the bare tower edits and reads the
//! screenshot scenes and the end-to-end specs build and inspect towers with
//! (`src/game/toolingTower.ts`, #1875 step 4). None is a player command: a
//! placement here skips the charge, the star gate and the log, as the
//! TypeScript `tower.place` did, and the harness loads the tower again
//! (`restore`) before the game runs on, so the simulation rebuilds what it
//! derives from the tower.

use wasm_bindgen::prelude::*;

#[cfg(feature = "tooling")]
use super::parse_kind;
use super::Engine;
#[cfg(feature = "tooling")]
use crate::tower::PlaceResult;

#[cfg(feature = "tooling")]
/// A placement's result as TypeScript's `PlaceResult` spells it: `{ ok,
/// reason?, unitId? }` for a room or a structure tile, with `transportId`
/// in place of `unitId` for a shaft.
fn place_json(r: PlaceResult, id_key: &str) -> String {
    let mut v = serde_json::json!({ "ok": r.ok });
    if let Some(reason) = r.reason {
        v["reason"] = serde_json::Value::String(reason);
    }
    if let Some(id) = r.unit_id {
        v[id_key] = id.into();
    }
    v.to_string()
}

#[cfg(feature = "tooling")]
/// The refusal for a kind the catalog does not name, as `build` gives it.
fn unknown_kind() -> String {
    place_json(
        PlaceResult {
            ok: false,
            reason: Some(super::facade_commands::UNKNOWN_FACILITY.to_string()),
            unit_id: None,
        },
        "unitId",
    )
}

#[wasm_bindgen]
impl Engine {
    /// Tooling only: `placeBare(kind, floor, x)`, the TypeScript `tower.place`, the bare placement with
    /// no charge, star gate or log line. JSON `{ ok, reason?, unitId? }`.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = placeBare)]
    pub fn place_bare(&mut self, kind: &str, floor: i32, x: i32) -> String {
        let Ok(kind) = parse_kind(kind) else {
            return unknown_kind();
        };
        place_json(self.sim.tower.place(kind, floor.into(), x.into()), "unitId")
    }

    /// Tooling only: `placeTransportBare(kind, x, bottom, top)`, the
    /// TypeScript `tower.placeTransport`, the bare
    /// shaft placement. JSON `{ ok, reason?, transportId? }`.
    #[cfg(feature = "tooling")]
    #[wasm_bindgen(js_name = placeTransportBare)]
    pub fn place_transport_bare(&mut self, kind: &str, x: i32, bottom: i32, top: i32) -> String {
        let Ok(kind) = parse_kind(kind) else {
            return unknown_kind();
        };
        let r = self
            .sim
            .tower
            .place_transport(kind, x.into(), bottom.into(), top.into());
        place_json(r, "transportId")
    }

    /// Tooling only: unit `id` serialized as the save would, or null.
    #[wasm_bindgen(js_name = unitRecord)]
    pub fn unit_record(&self, id: i32) -> Option<String> {
        self.sim
            .tower
            .get_unit(id.into())
            .map(|u| u.serialize().to_string())
    }

    /// Tooling only: shaft `id` serialized as the save would, or null.
    #[wasm_bindgen(js_name = transportRecord)]
    pub fn transport_record(&self, id: i32) -> Option<String> {
        self.sim
            .tower
            .get_transport(id.into())
            .map(|t| t.serialize().to_string())
    }

    /// Tooling only: the room covering a tile (structure excluded),
    /// serialized as the save would, or null.
    #[wasm_bindgen(js_name = roomAt)]
    pub fn room_at(&self, floor: i32, x: i32) -> Option<String> {
        self.sim
            .tower
            .room_at(floor.into(), x.into())
            .map(|u| u.serialize().to_string())
    }

    /// Tooling only: the kind of the structure tile (a floor or a lobby) at
    /// a tile, or null.
    #[wasm_bindgen(js_name = structureKindAt)]
    pub fn structure_kind_at(&self, floor: i32, x: i32) -> Option<String> {
        self.sim
            .tower
            .structure_kind_at(floor.into(), x.into())
            .map(|k| k.facility().key.to_string())
    }

    /// Tooling only: whether `floor` carries a lobby.
    #[wasm_bindgen(js_name = floorHasLobby)]
    pub fn floor_has_lobby(&self, floor: i32) -> bool {
        self.sim.tower.floor_has_lobby(floor.into())
    }

    /// Tooling only: whether a shaft or a stair reaches `floor` from the
    /// ground lobby.
    #[wasm_bindgen(js_name = isFloorServed)]
    pub fn is_floor_served(&self, floor: i32) -> bool {
        self.sim.tower.is_floor_served(floor.into())
    }

    /// Tooling only: the highest floor anything stands on.
    #[wasm_bindgen(js_name = highestFloor)]
    pub fn highest_floor(&self) -> f64 {
        self.sim.highest_floor() as f64
    }
}

#[cfg(test)]
#[cfg(feature = "tooling")]
#[path = "exports_tooling_tests.rs"]
mod tests;
