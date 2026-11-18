//! An elevator shaft and a room never share a tile (4.x scope audit,
//! 2026-11-17). The 1994 game holds no room under an elevator shaft, and
//! our own `.TDT` reader calls a tower that does invalid
//! (`tdt/transports.rs`). A room is refused where an elevator runs, and an
//! elevator is refused through a room, whether it is built or extended
//! there. Stairs and escalators still stand over rooms, as in the original,
//! and an elevator still runs down into a metro station, whose platform is
//! the story above its tunnel: that is how commuters reach the trains.
//!
//! The rule is for builds only: a saved tower that already holds a room
//! under a shaft loads and plays as it did, and its shaft keeps the floors
//! it has. A build checks it (`Simulation::can_build` through
//! `Tower::can_place_room_ignoring_floor`, `Simulation::can_build_transport`
//! through [`Tower::validate_new_shaft`]), and a resize checks each floor a
//! shaft newly serves. The raw `Tower::place` and `Tower::place_transport`,
//! which stand a tower up as given, leave it out.

use super::{PlaceResult, Tower};
use crate::facilities::Kind;

/// Why a room cannot go where an elevator shaft runs.
pub(crate) const ROOM_IN_SHAFT: &str = "An elevator shaft runs through here.";

/// Why an elevator shaft cannot run through a room.
pub(crate) const SHAFT_THROUGH_ROOM: &str =
    "A room is in the way. Elevator shafts can't run through rooms.";

impl Tower {
    /// [`Tower::validate_transport`] for a shaft a build puts up: an elevator
    /// also never runs through a room on any floor it serves.
    pub(crate) fn validate_new_shaft(
        &self,
        kind: Kind,
        x: i64,
        bottom: i64,
        top: i64,
    ) -> PlaceResult {
        let v = self.validate_transport(kind, x, bottom, top);
        if !v.ok {
            return v;
        }
        let w = kind.facility().width;
        (bottom..=top)
            .find_map(|fl| self.shaft_room_reason(kind, fl, x, w))
            .map_or(v, PlaceResult::fail)
    }

    /// Why a room of `kind` cannot stand at (`floor`, `x`): an elevator shaft
    /// runs through one of its stories. The build preview asks this on every
    /// pointer move, so it walks the elevators alone from the per-revision
    /// list (`DispatchFloors::elevators`), never the flights, which Modern
    /// does not limit.
    pub(crate) fn room_span_shaft_reason(&self, kind: Kind, floor: i64, x: i64) -> Option<String> {
        if kind == Kind::Metro {
            return None;
        }
        let w = kind.facility().width;
        let floors = self.dispatch_floors();
        let blocked = (floors.elevators.iter()).any(|&i| {
            let t = &self.transports[i];
            (floor..floor + kind.floors()).any(|fl| Self::transport_overlaps(t, x, w, fl))
        });
        blocked.then(|| ROOM_IN_SHAFT.into())
    }

    /// Why a shaft of `kind` cannot run through story `floor` across the `w`
    /// tiles from `x`: an elevator never runs through a room other than a
    /// metro station. Stairs and escalators may.
    pub(crate) fn shaft_room_reason(
        &self,
        kind: Kind,
        floor: i64,
        x: i64,
        w: i64,
    ) -> Option<&'static str> {
        let blocks = |id: &i64| self.get_unit(*id).is_none_or(|u| u.kind != Kind::Metro);
        let blocked = kind.is_elevator()
            && (x..x + w).any(|tx| self.rooms.get(&(floor, tx)).is_some_and(blocks));
        blocked.then_some(SHAFT_THROUGH_ROOM)
    }
}
