//! A Modern office worker out for dinner or a movie when office hours are
//! over goes home from the venue (#2481). Taking them back to the desk kept
//! them there until the office's next hourly pass, and an evening movie
//! could take them out again, so a few left after midnight. During office
//! hours the outing still ends back at the desk, and Classic offices, which
//! count by the clock, keep the round trip.
use crate::clock::{CalendarKind, Clock, GameMode};
use crate::crowd::commuters::desks;
use crate::crowd::motion::advance;
use crate::crowd::spawn::add;
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::office_commute::occupants;
use super::{at_time, room, served_tower, LEFT};

const OFFICE_FLOOR: i64 = 5;
const VENUE_FLOOR: i64 = 3;
const LOBBY: i64 = 1;
/// An office's workers.
const STAFF: i64 = 6;

/// A served tower with a rented office on floor 5, its workers at their
/// desks by 10:30 on a Monday, and a fast food on floor 3.
fn tower_at_work(mode: GameMode) -> (Simulation, i64, i64) {
    let mut sim = served_tower(mode, CalendarKind::RealWorld, 6);
    let office = room(
        &mut sim,
        Kind::Office,
        OFFICE_FLOOR,
        LEFT + 10,
        UnitState::Occupied,
    );
    let venue = room(
        &mut sim,
        Kind::FastFood,
        VENUE_FLOOR,
        LEFT + 40,
        UnitState::Occupied,
    );
    at_time(&mut sim, 0, 6);
    for _ in 0..(4 * 60 + 30) {
        sim.tick(1.0);
    }
    assert_eq!(occupants(&sim, office), STAFF, "{mode:?}: at work");
    (sim, office, venue)
}

/// Puts one of the office's workers at the venue, about to finish, as a
/// dinner trip leaves them, and sets the step's clock to `hour` on Monday.
/// Answers the person's id.
fn finishing_dinner(sim: &mut Simulation, office: i64, venue: i64, hour: i64) -> i64 {
    sim.clock = Clock::new((hour * 60) as f64, sim.clock.calendar);
    sim.crowd.hour = Some(hour);
    sim.crowd.weekend = false;
    let (ox, vx) = (
        sim.tower.get_unit(office).unwrap().x,
        sim.tower.get_unit(venue).unwrap().x,
    );
    let i = add(
        &mut sim.crowd,
        &sim.tower,
        OFFICE_FLOOR,
        VENUE_FLOOR,
        Some(ox),
        Some(vx),
    )
    .unwrap();
    let p = &mut sim.crowd.people[i];
    (p.floor, p.x, p.state) = (VENUE_FLOOR, vx as f64, PState::Dwelling);
    (p.meal_venue_id, p.origin_unit_id) = (Some(venue), Some(office));
    p.dwell_seconds_left = Some(0.5);
    sim.tower.get_unit_mut(office).unwrap().out_for_meal = Some(1);
    sim.crowd.people[i].id
}

fn person(sim: &Simulation, id: i64) -> &crate::crowd::Person {
    sim.crowd.people.iter().find(|p| p.id == id).unwrap()
}

fn out_for_meal(sim: &Simulation, office: i64) -> i64 {
    sim.tower
        .get_unit(office)
        .unwrap()
        .out_for_meal
        .unwrap_or(0)
}

#[test]
fn after_office_hours_a_modern_worker_goes_home_from_dinner() {
    let (mut sim, office, venue) = tower_at_work(GameMode::Modern);
    let id = finishing_dinner(&mut sim, office, venue, 20);
    advance(&mut sim.crowd, 1.0, &mut sim.tower);
    let p = person(&sim, id);
    assert_eq!(p.floors.last(), Some(&LOBBY), "heads for the lobby");
    assert_eq!(p.origin_unit_id, None);
    assert!(p.returning);
    // The worker no longer counts at the office, nor as out from it.
    assert_eq!(out_for_meal(&sim, office), 0);
    assert_eq!(occupants(&sim, office), STAFF - 1);
    assert_eq!(desks(&sim.crowd)[&office].inside, STAFF - 1);
    // They walk out through the lobby and leave the tower there.
    let mut last_floor = None;
    for _ in 0..120 {
        match sim.crowd.people.iter().find(|p| p.id == id) {
            Some(p) => last_floor = Some(p.floor),
            None => break,
        }
        sim.tick(0.5);
    }
    assert!(
        sim.crowd.people.iter().all(|p| p.id != id),
        "left the tower"
    );
    assert_eq!(last_floor, Some(LOBBY));
}

#[test]
fn on_a_weekend_a_modern_worker_goes_home_from_dinner_too() {
    let (mut sim, office, venue) = tower_at_work(GameMode::Modern);
    let id = finishing_dinner(&mut sim, office, venue, 12);
    sim.crowd.weekend = true;
    advance(&mut sim.crowd, 1.0, &mut sim.tower);
    assert_eq!(person(&sim, id).floors.last(), Some(&LOBBY));
    assert_eq!(occupants(&sim, office), STAFF - 1);
}

#[test]
fn during_office_hours_the_outing_ends_back_at_the_desk() {
    let (mut sim, office, venue) = tower_at_work(GameMode::Modern);
    let id = finishing_dinner(&mut sim, office, venue, 12);
    advance(&mut sim.crowd, 1.0, &mut sim.tower);
    let p = person(&sim, id);
    assert_eq!(p.floors.last(), Some(&OFFICE_FLOOR), "back to the office");
    assert_eq!(p.origin_unit_id, Some(office));
    assert_eq!(out_for_meal(&sim, office), 1, "still out until back");
    assert_eq!(occupants(&sim, office), STAFF);
    assert_eq!(desks(&sim.crowd)[&office].inside, STAFF);
}

#[test]
fn a_classic_office_keeps_the_round_trip_after_hours() {
    let (mut sim, office, venue) = tower_at_work(GameMode::Classic);
    let id = finishing_dinner(&mut sim, office, venue, 20);
    advance(&mut sim.crowd, 1.0, &mut sim.tower);
    let p = person(&sim, id);
    assert_eq!(p.floors.last(), Some(&OFFICE_FLOOR), "back to the office");
    assert_eq!(p.origin_unit_id, Some(office));
    assert_eq!(out_for_meal(&sim, office), 1);
}

#[test]
fn a_sales_call_that_runs_past_office_hours_still_ends_at_the_desk() {
    let (mut sim, office, _) = tower_at_work(GameMode::Modern);
    sim.clock = Clock::new((17 * 60) as f64, sim.clock.calendar);
    sim.crowd.hour = Some(17);
    sim.crowd.weekend = false;
    let ox = sim.tower.get_unit(office).unwrap().x;
    let i = add(
        &mut sim.crowd,
        &sim.tower,
        OFFICE_FLOOR,
        LOBBY,
        Some(ox),
        None,
    )
    .unwrap();
    let p = &mut sim.crowd.people[i];
    (p.floor, p.state, p.routine) = (LOBBY, PState::Dwelling, Some("salesCall"));
    (p.origin_unit_id, p.dwell_seconds_left) = (Some(office), Some(0.5));
    let id = p.id;
    sim.tower.get_unit_mut(office).unwrap().out_for_meal = Some(1);
    advance(&mut sim.crowd, 1.0, &mut sim.tower);
    let p = person(&sim, id);
    assert_eq!(p.floors.last(), Some(&OFFICE_FLOOR), "back to the office");
    assert_eq!(p.origin_unit_id, Some(office));
    assert_eq!(occupants(&sim, office), STAFF);
}
