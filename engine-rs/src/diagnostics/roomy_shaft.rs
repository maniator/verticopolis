//! The elevator a crowded floor can take more cars on (#2251). When a
//! floor's congestion is bound by its elevators, the cheapest fix is often a
//! car on a shaft that already stops there: each shaft holds up to
//! `Kind::max_cars` cars, and a new shaft costs more and draws on the
//! tower's shaft limit. The tenant card's advice names the shaft with the
//! most room, or says every shaft here is full, so it can suggest cars before
//! a parallel shaft.

use serde::Serialize;

use crate::sim::Simulation;

/// A passenger elevator that stops on the floor and has room for more cars.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomyShaft {
    /// The shaft's kind key.
    pub kind: &'static str,
    pub bottom: i64,
    pub top: i64,
    pub cars: i64,
    pub max_cars: i64,
}

impl Simulation {
    /// The passenger elevator stopping on `floor` with the most free car
    /// slots (the fewest cars against its limit, then the lowest id), or
    /// `None` when every one that stops there is full or none does. Staff-only
    /// shafts carry no tenants, so they are left out. One pass over the
    /// tower's transports.
    pub(super) fn roomy_elevator_at(&self, floor: i64) -> Option<RoomyShaft> {
        self.tower
            .transports
            .iter()
            .filter(|t| t.kind.is_elevator() && !t.kind.is_staff_only_transport())
            .filter(|t| t.stops_at(floor) && t.cars < t.kind.max_cars())
            .min_by_key(|t| (t.cars - t.kind.max_cars(), t.id))
            .map(|t| RoomyShaft {
                kind: t.kind.as_str(),
                bottom: t.bottom,
                top: t.top,
                cars: t.cars,
                max_cars: t.kind.max_cars(),
            })
    }
}
