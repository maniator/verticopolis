//! The person card (#2092): one routed person's trip as a numeric record the
//! layout names, read on demand while a player has the card open. It reads
//! `crowd::trip::trip_facts` and the person as the step left them, so it
//! computes nothing the game does not already know, and the view frame does
//! not grow.
use crate::charges::whole;
use crate::crowd::staff_shift::StaffTrip;
use crate::crowd::trip::{trip_facts, Place, Purpose};
use crate::crowd::CROWD_SECONDS_PER_MINUTE;
use crate::frame::person_state_code;
use crate::sim::Simulation;

use super::port_panels::flag;
use super::Engine;

/// `personCard`'s slots. `purpose` is a code in `personPurposes`,
/// `shiftStep` a housekeeper's step in `shiftSteps` (NaN for anyone else),
/// and each end is a code in `tripPlaces` with the room's id and kind (NaN
/// unless the end is a room) and its floor (NaN for no place). For a
/// housekeeper `from` is the housekeeping room they work from. `returning`
/// is 1 on the way back from a meal or a visit. `wait` is the current wait
/// in the crowd's own seconds (the unit of the catalog's `fedUpWait`, for the
/// mood); `waitMinutes` is that wait in game minutes and
/// `tripWaitMinutes` every wait of the trip so far, this one included.
/// `shaftId` is the next shaft the person takes, or the one they wait at or
/// ride, NaN when the trip takes none.
pub(crate) const PERSON_CARD: [&str; 20] = [
    "id",
    "stateCode",
    "floor",
    "x",
    "staff",
    "purpose",
    "returning",
    "shiftStep",
    "fromPlace",
    "fromUnit",
    "fromKind",
    "fromFloor",
    "toPlace",
    "toUnit",
    "toKind",
    "toFloor",
    "wait",
    "waitMinutes",
    "tripWaitMinutes",
    "shaftId",
];

/// A housekeeper's steps by code (`shiftStep` in `personCard`).
pub(crate) const SHIFT_STEPS: [StaffTrip; 6] = [
    StaffTrip::In,
    StaffTrip::Base,
    StaffTrip::Job,
    StaffTrip::Free,
    StaffTrip::Home,
    StaffTrip::Out,
];

pub(crate) const SHIFT_STEP_NAMES: [&str; 6] = ["in", "base", "job", "free", "home", "out"];

/// The person card's record and codes, beside the port's others.
pub(crate) fn add_person_records(layout: &mut serde_json::Value) {
    layout["records"]["personCard"] = serde_json::json!(PERSON_CARD);
    layout["personPurposes"] = serde_json::json!(Purpose::ALL.map(Purpose::name));
    layout["tripPlaces"] = serde_json::json!(Place::NAMES);
    layout["shiftSteps"] = serde_json::json!(SHIFT_STEP_NAMES);
}

/// One end's four slots: place code, room id, room kind, floor.
fn end_slots(sim: &Simulation, place: Place) -> [f64; 4] {
    let code = Place::NAMES
        .iter()
        .position(|n| *n == place.name())
        .unwrap_or(0) as f64;
    match place {
        Place::None => [code, f64::NAN, f64::NAN, f64::NAN],
        Place::Room(id) => match sim.tower.get_unit(id) {
            Some(u) => [code, id as f64, u.kind as usize as f64, u.floor as f64],
            None => [0.0, f64::NAN, f64::NAN, f64::NAN],
        },
        Place::Floor(f) | Place::Lobby(f) | Place::Metro(f) => [code, f64::NAN, f64::NAN, f as f64],
    }
}

/// Person `id`'s card, or `None` for an id that names nobody in the tower
/// now (never there, or left the building).
pub(crate) fn person_card(sim: &Simulation, id: i64) -> Option<Vec<f64>> {
    // People are pushed with a rising id and dropped with `retain`, so the
    // list stays in id order.
    let people = &sim.crowd.people;
    let p = &people[people.binary_search_by_key(&id, |p| p.id).ok()?];
    let f = trip_facts(p, &sim.tower);
    let purpose = Purpose::ALL
        .iter()
        .position(|q| *q == f.purpose)
        .unwrap_or(0);
    let shift = f
        .shift
        .and_then(|s| SHIFT_STEPS.iter().position(|t| *t == s))
        .map_or(f64::NAN, |i| i as f64);
    let mut r = Vec::with_capacity(PERSON_CARD.len());
    r.extend_from_slice(&[
        p.id as f64,
        person_state_code(p.state),
        p.floor as f64,
        p.x,
        flag(p.staff),
        purpose as f64,
        flag(f.returning),
        shift,
    ]);
    r.extend_from_slice(&end_slots(sim, f.from));
    r.extend_from_slice(&end_slots(sim, f.to));
    r.extend_from_slice(&[
        p.wait,
        p.wait / CROWD_SECONDS_PER_MINUTE,
        (p.trip_wait + p.wait) / CROWD_SECONDS_PER_MINUTE,
        p.shaft_id.map_or(f64::NAN, |s| s as f64),
    ]);
    Some(r)
}

impl Engine {
    /// [`person_card`] for a JavaScript id; empty for an id that is not a
    /// whole number or names nobody.
    pub(crate) fn port_person_card(&self, id: f64) -> Vec<f64> {
        whole(id)
            .and_then(|id| person_card(&self.sim, id))
            .unwrap_or_default()
    }
}

#[cfg(test)]
#[path = "wasm_port_person_tests.rs"]
mod tests;
