//! Time-simulated maids: the shift windows per mode (Classic from noon with
//! the 16:30 cutoff, Modern from 08:00), the staff network of service
//! elevators and stairs (escalators carry no staff), six maids per crew and
//! one per floor at a time cycling through a floor's rooms, the crew that
//! walks in from the lobby at the start of the shift, and the cleaning
//! dwell. Crew choice and order
//! on a split network are covered by `housekeeping_dispatch_tests`; the
//! morning checkout latch by `housekeeping::tests::the_morning_checkout_latches_yesterdays_shift`.
use crate::clock::GameMode;
use crate::crowd::staff_shift::{StaffTrip, STREET_FLOOR};
use crate::crowd::CROWD_SECONDS_PER_MINUTE;
use crate::facilities::Kind;
use crate::housekeeping::{HK_CLEAN_MINUTES, HK_MAIDS_PER_UNIT};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{seeded_game, MID};

const X0: i64 = MID - 20;
const HOUR: f64 = 60.0;

/// A 2-star tower opening at 07:00 with a floor-2 slab and a standard
/// elevator from the lobby.
fn base_tower(seed: u32, mode: GameMode) -> Simulation {
    let mut sim = seeded_game(seed, mode);
    sim.star = 2;
    slab(&mut sim, 2);
    assert!(
        sim.build_transport(Kind::ElevatorStandard, X0 + 26, 1, 2)
            .ok
    );
    sim
}

fn slab(sim: &mut Simulation, floor: i64) {
    for i in 0..30 {
        assert!(sim.tower.place(Kind::Floor, floor, X0 + i).ok);
    }
}

fn place(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let r = sim.tower.place(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor}/{x}: {:?}", r.reason);
    r.unit_id.unwrap()
}

fn dirty_room(sim: &mut Simulation, floor: i64, x: i64) -> i64 {
    let id = place(sim, Kind::HotelSingle, floor, x);
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Dirty;
    id
}

fn state(sim: &Simulation, id: i64) -> UnitState {
    sim.tower.get_unit(id).unwrap().state
}

/// Housekeepers in the building.
fn maids(sim: &Simulation) -> usize {
    sim.crowd.people.iter().filter(|p| p.staff).count()
}

/// Housekeepers out on a room.
fn at_work(sim: &Simulation) -> usize {
    let on_a_room = |p: &&crate::crowd::Person| p.clean_unit_id.is_some();
    sim.crowd.people.iter().filter(on_a_room).count()
}

fn hours(sim: &mut Simulation, n: usize) {
    for _ in 0..n {
        sim.tick(HOUR);
    }
}

#[test]
fn classic_maids_start_at_noon_and_not_at_the_morning_checkout() {
    let mut sim = base_tower(31, GameMode::Classic);
    let room = dirty_room(&mut sim, 2, X0);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    hours(&mut sim, 2); // 07:00 to 09:00
    assert_eq!(maids(&sim), 0);
    hours(&mut sim, 2); // the crew comes in at 10:00, two hours early
    assert!(maids(&sim) > 0);
    assert_eq!(at_work(&sim), 0, "and waits for noon");
    assert_eq!(state(&sim, room), UnitState::Dirty);
    hours(&mut sim, 1); // crossing noon dispatches
    assert!(at_work(&sim) > 0);
    hours(&mut sim, 1);
    assert_eq!(state(&sim, room), UnitState::Empty);
}

#[test]
fn classic_dispatch_starts_no_room_after_the_1630_cutoff() {
    let mut sim = base_tower(32, GameMode::Classic);
    dirty_room(&mut sim, 2, X0);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    sim.seat_crews();
    sim.clock.minutes = 16.0 * HOUR + 45.0;
    sim.dispatch_housekeepers();
    assert_eq!(at_work(&sim), 0);
    sim.clock.minutes = 16.0 * HOUR + 15.0;
    sim.dispatch_housekeepers();
    assert_eq!(at_work(&sim), 1);
}

#[test]
fn modern_maids_start_at_eight() {
    let mut sim = base_tower(33, GameMode::Modern);
    let room = dirty_room(&mut sim, 2, X0);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    hours(&mut sim, 1);
    assert!(maids(&sim) > 0);
    hours(&mut sim, 1);
    assert_eq!(state(&sim, room), UnitState::Empty);
}

#[test]
fn an_escalator_carries_no_staff_and_stairs_do() {
    let mut sim = base_tower(34, GameMode::Classic);
    slab(&mut sim, 3);
    let room = dirty_room(&mut sim, 3, X0);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    assert!(sim.tower.place_transport(Kind::Escalator, X0 + 18, 2, 3).ok);
    assert!(!sim.tower.staff_connected(2, 3));
    hours(&mut sim, 7); // 07:00 to 14:00, through the shift
    assert_eq!(state(&sim, room), UnitState::Dirty);
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.contains("Housekeeping can't reach")));
    assert!(sim.tower.place_transport(Kind::Stairs, X0, 2, 3).ok);
    assert!(sim.tower.staff_connected(2, 3));
    hours(&mut sim, 2);
    assert_eq!(state(&sim, room), UnitState::Empty);
}

#[test]
fn a_crew_fields_at_most_six_maids_one_per_floor() {
    let mut sim = base_tower(35, GameMode::Classic);
    for floor in 3..=9 {
        slab(&mut sim, floor);
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorService, X0 + 18, 1, 9)
            .ok
    );
    for floor in 2..=8 {
        dirty_room(&mut sim, floor, X0);
    }
    place(&mut sim, Kind::Housekeeping, 9, X0 + 8);
    sim.seat_crews();
    sim.clock.minutes = 13.0 * HOUR;
    sim.dispatch_housekeepers();
    // Seven reachable dirty rooms on seven floors, six maids out.
    assert_eq!(at_work(&sim) as i64, HK_MAIDS_PER_UNIT);
}

#[test]
fn one_maid_takes_a_floors_two_rooms_in_turn() {
    let mut sim = base_tower(36, GameMode::Classic);
    let a = dirty_room(&mut sim, 2, X0);
    let b = dirty_room(&mut sim, 2, X0 + 4);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    hours(&mut sim, 5);
    assert_eq!(sim.clock.hour(), 12);
    // The crew walks in at noon and one maid at a time works the floor: she
    // cleans the first room and goes straight on to the second.
    for _ in 0..60 {
        sim.tick(1.0);
        assert!(at_work(&sim) <= 1, "one maid per floor per crew");
    }
    assert_eq!(state(&sim, a), UnitState::Empty);
    assert_eq!(state(&sim, b), UnitState::Empty);
}

#[test]
fn the_crew_walks_in_from_the_lobby_at_the_start_of_the_shift() {
    let mut sim = base_tower(39, GameMode::Classic);
    let crew = place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    sim.clock.minutes = 12.0 * HOUR;
    sim.bring_in_crews();
    let staff: Vec<_> = sim.crowd.people.iter().filter(|p| p.staff).collect();
    assert_eq!(staff.len() as i64, HK_MAIDS_PER_UNIT);
    for p in &staff {
        assert_eq!(p.floor, STREET_FLOOR, "they start in the lobby");
        assert_eq!(p.crew_id, Some(crew));
        assert_eq!(p.staff_trip, Some(StaffTrip::In));
    }
    // A second call at the next hour tops the crew up and adds no one.
    sim.bring_in_crews();
    assert_eq!(maids(&sim) as i64, HK_MAIDS_PER_UNIT);
    assert_eq!(sim.crowd.crew_roster.get(&crew), Some(&HK_MAIDS_PER_UNIT));
}

#[test]
fn a_crew_the_lobby_cannot_reach_stays_home_with_a_note() {
    let mut sim = base_tower(40, GameMode::Classic);
    slab(&mut sim, 3);
    place(&mut sim, Kind::Housekeeping, 3, X0 + 8);
    sim.clock.minutes = 12.0 * HOUR;
    sim.bring_in_crews();
    sim.bring_in_crews();
    assert_eq!(maids(&sim), 0);
    let notes = sim
        .log
        .iter()
        .filter(|e| e.text.contains("can't get from the lobby"));
    assert_eq!(notes.count(), 1, "one note a day");
}

#[test]
fn a_maid_carries_the_cleaning_hold() {
    let mut sim = base_tower(37, GameMode::Classic);
    dirty_room(&mut sim, 2, X0);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    sim.seat_crews();
    sim.clock.minutes = 13.0 * HOUR;
    sim.dispatch_housekeepers();
    let maid = sim.crowd.people.iter().find(|p| p.clean_unit_id.is_some());
    let maid = maid.expect("a maid on the room");
    assert_eq!(
        maid.linger_for,
        Some(HK_CLEAN_MINUTES * CROWD_SECONDS_PER_MINUTE)
    );
}

#[test]
fn a_room_turns_over_only_when_the_dwell_completes() {
    let mut sim = base_tower(38, GameMode::Classic);
    let room = dirty_room(&mut sim, 2, X0);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    hours(&mut sim, 5);
    assert!(maids(&sim) > 0);
    // Three minutes covers the walk but not the dwell.
    sim.tick(3.0);
    assert!(maids(&sim) > 0);
    assert_eq!(state(&sim, room), UnitState::Dirty);
    for _ in 0..5 {
        sim.tick(3.0);
    }
    assert_eq!(state(&sim, room), UnitState::Empty);
}
