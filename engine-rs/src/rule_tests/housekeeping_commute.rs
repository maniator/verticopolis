//! A housekeeper's working day (owner, 2026-11-14): nobody appears at a
//! housekeeping room or vanishes at a hotel room. They walk in from the
//! lobby, go from one dirty room straight on to the next, come back to the
//! housekeeping room only when nothing is left, and leave through the lobby
//! when the shift is over. A game loaded mid-shift brings its crews in at the
//! next hour, and a crew whose room is gone goes home.
use std::collections::HashMap;

use crate::clock::GameMode;
use crate::crowd::staff_shift::{StaffTrip, STREET_FLOOR};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{seeded_game, MID};

const X0: i64 = MID - 20;
const HOUR: f64 = 60.0;

/// A 2-star Classic tower, floors 2 to 4 with a standard elevator from the
/// lobby to floor 2, a service elevator from the lobby to floor 4 and a
/// housekeeping room on floor 2. Returns the crew's id.
fn hotel(seed: u32) -> (Simulation, i64) {
    let mut sim = seeded_game(seed, GameMode::Classic);
    sim.star = 2;
    for floor in 2..=4 {
        for i in 0..30 {
            assert!(sim.tower.place(Kind::Floor, floor, X0 + i).ok);
        }
    }
    assert!(
        sim.build_transport(Kind::ElevatorStandard, X0 + 26, 1, 2)
            .ok
    );
    assert!(sim.build_transport(Kind::ElevatorService, X0 + 18, 1, 4).ok);
    let crew = sim.tower.place(Kind::Housekeeping, 2, X0 + 8);
    (sim, crew.unit_id.unwrap())
}

fn dirty_room(sim: &mut Simulation, floor: i64) -> i64 {
    let id = sim
        .tower
        .place(Kind::HotelSingle, floor, X0)
        .unit_id
        .unwrap();
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Dirty;
    id
}

fn state(sim: &Simulation, id: i64) -> UnitState {
    sim.tower.get_unit(id).unwrap().state
}

/// Every housekeeper's floor and trip, by id.
fn staff(sim: &Simulation) -> HashMap<i64, (i64, Option<StaffTrip>)> {
    let on_staff = sim.crowd.people.iter().filter(|p| p.staff);
    on_staff.map(|p| (p.id, (p.floor, p.staff_trip))).collect()
}

/// Ticks a minute at a time for `minutes`, checking that every housekeeper
/// who left the crowd left it from the lobby on the way out.
fn watch(sim: &mut Simulation, minutes: usize) {
    for _ in 0..minutes {
        let before = staff(sim);
        sim.tick(1.0);
        let after = staff(sim);
        for (id, (floor, trip)) in before {
            if !after.contains_key(&id) {
                assert_eq!(trip, Some(StaffTrip::Out), "{id} left on the way out");
                assert_eq!(floor, STREET_FLOOR, "{id} left from the lobby");
            }
        }
    }
}

/// Sets the clock to 1:00 PM as if the hour had already run, so the next
/// tick brings no one else in.
fn at_one_pm(sim: &mut Simulation) {
    sim.clock.minutes = 13.0 * HOUR;
    sim.last_hour = 13;
}

/// Seats the crew and keeps one housekeeper, so the test can follow her.
fn one_maid(sim: &mut Simulation) -> i64 {
    sim.seat_crews();
    let ids: Vec<i64> = staff(sim).into_keys().collect();
    let keep = *ids.iter().min().unwrap();
    sim.crowd.people.retain(|p| !p.staff || p.id == keep);
    sim.crowd.staff_count = 1;
    for n in sim.crowd.crew_roster.values_mut() {
        *n = 1;
    }
    keep
}

#[test]
fn a_maid_goes_from_one_room_straight_to_the_next() {
    let (mut sim, _) = hotel(61);
    let upper = dirty_room(&mut sim, 4);
    let lower = dirty_room(&mut sim, 3);
    let maid = one_maid(&mut sim);
    at_one_pm(&mut sim);
    sim.dispatch_housekeepers();
    let mut trips = vec![];
    for _ in 0..90 {
        sim.tick(1.0);
        let trip = staff(&sim)[&maid].1;
        if trips.last() != Some(&trip) {
            trips.push(trip);
        }
    }
    assert_eq!(state(&sim, upper), UnitState::Empty);
    assert_eq!(state(&sim, lower), UnitState::Empty);
    // Job to job with no trip home in between, then home once both are done.
    let between_rooms = trips.iter().position(|t| *t == Some(StaffTrip::Home));
    let jobs = trips.iter().filter(|t| **t == Some(StaffTrip::Job)).count();
    assert_eq!(jobs, 1, "one unbroken run of rooms: {trips:?}");
    assert_eq!(
        between_rooms,
        Some(1),
        "home only after the last room: {trips:?}"
    );
    assert_eq!(trips.last(), Some(&Some(StaffTrip::Base)));
}

#[test]
fn a_maid_with_nothing_left_rides_back_to_the_housekeeping_room() {
    let (mut sim, crew) = hotel(62);
    let room = dirty_room(&mut sim, 4);
    let maid = one_maid(&mut sim);
    at_one_pm(&mut sim);
    sim.dispatch_housekeepers();
    watch(&mut sim, 60);
    assert_eq!(state(&sim, room), UnitState::Empty);
    let p = sim.crowd.people.iter().find(|p| p.id == maid).unwrap();
    let home = sim.tower.get_unit(crew).unwrap();
    assert_eq!(p.staff_trip, Some(StaffTrip::Base));
    assert_eq!(p.floor, home.floor);
    assert_eq!(p.x, home.x as f64 + home.width as f64 / 2.0);
}

#[test]
fn the_crew_walks_in_works_and_walks_out_through_the_lobby() {
    let (mut sim, _) = hotel(63);
    let rooms = [dirty_room(&mut sim, 3), dirty_room(&mut sim, 4)];
    // 07:00 to 09:00: nobody in yet.
    sim.tick(2.0 * HOUR);
    assert!(staff(&sim).is_empty());
    // 09:00 to 18:00: in from 10:00, the rooms from noon, out at 17:00.
    watch(&mut sim, 9 * 60);
    for room in rooms {
        assert_eq!(state(&sim, room), UnitState::Empty);
    }
    assert!(
        staff(&sim).is_empty(),
        "everyone has gone home: {:?} {:?}",
        staff(&sim),
        sim.crowd
            .people
            .iter()
            .filter(|p| p.staff)
            .map(|p| (p.state, p.x, p.shaft_id))
            .collect::<Vec<_>>()
    );
    assert_eq!(sim.crowd.staff_count, 0);
    assert!(sim.crowd.crew_roster.is_empty());
}

#[test]
fn a_game_loaded_mid_shift_brings_its_crew_in_from_the_lobby() {
    let (mut sim, crew) = hotel(64);
    let room = dirty_room(&mut sim, 4);
    sim.tick(6.0 * HOUR + 30.0);
    let mut loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert!(staff(&loaded).is_empty(), "saves carry no people");
    loaded.tick(30.0);
    let arrived = loaded
        .crowd
        .people
        .iter()
        .filter(|p| p.crew_id == Some(crew));
    assert!(arrived.clone().count() > 0);
    assert!(arrived
        .clone()
        .all(|p| p.floor == STREET_FLOOR || p.staff_trip != Some(StaffTrip::In)));
    loaded.tick(HOUR);
    assert_eq!(state(&loaded, room), UnitState::Empty);
}

#[test]
fn a_crew_whose_room_is_gone_goes_home_through_the_lobby() {
    let (mut sim, crew) = hotel(65);
    sim.seat_crews();
    at_one_pm(&mut sim);
    assert!(sim.tower.remove_unit(crew).is_some());
    sim.send_idle_crews_out();
    assert!(staff(&sim).values().all(|s| s.1 == Some(StaffTrip::Out)));
    watch(&mut sim, 30);
    assert!(staff(&sim).is_empty());
}

#[test]
fn a_maid_whose_elevator_is_torn_out_stops_where_she_stands() {
    let (mut sim, _) = hotel(66);
    let room = dirty_room(&mut sim, 4);
    let maid = one_maid(&mut sim);
    at_one_pm(&mut sim);
    sim.dispatch_housekeepers();
    let service = sim
        .crowd
        .people
        .iter()
        .find(|p| p.id == maid)
        .unwrap()
        .shaft_id;
    let service = service.expect("she takes the service elevator");
    assert!(sim.tower.remove_transport(service).is_some());
    watch(&mut sim, 5);
    let p = sim.crowd.people.iter().find(|p| p.id == maid);
    let p = p.expect("she is still in the building");
    assert_eq!(p.clean_unit_id, None, "the room is handed back");
    assert_ne!(p.staff_trip, Some(StaffTrip::Job));
    assert_eq!(p.fy, p.floor as f64);
    assert_eq!(state(&sim, room), UnitState::Dirty);
}

#[test]
fn a_maid_done_with_a_room_takes_the_nearest_dirty_one_next() {
    let mut sim = seeded_game(67, GameMode::Classic);
    sim.star = 2;
    for floor in 2..=8 {
        for i in 0..30 {
            assert!(sim.tower.place(Kind::Floor, floor, X0 + i).ok);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorService, X0 + 18, 1, 8).ok);
    assert!(sim.tower.place(Kind::Housekeeping, 2, X0 + 8).ok);
    // Placed in this order, so Classic's tower order is floor 8, 3, 7.
    let top = dirty_room(&mut sim, 8);
    let low = dirty_room(&mut sim, 3);
    let near_top = dirty_room(&mut sim, 7);
    one_maid(&mut sim);
    at_one_pm(&mut sim);
    sim.dispatch_housekeepers();
    let mut cleaned = vec![];
    // Within the hour, before the next hour's top-up brings the rest of the
    // crew in.
    for _ in 0..59 {
        sim.tick(1.0);
        for id in [top, low, near_top] {
            if state(&sim, id) != UnitState::Dirty && !cleaned.contains(&id) {
                cleaned.push(id);
            }
        }
    }
    // From floor 8 she goes on to floor 7, not down to floor 3 next.
    assert_eq!(cleaned[..2], [top, near_top]);
    sim.tick(HOUR);
    assert_eq!(state(&sim, low), UnitState::Empty);
}
