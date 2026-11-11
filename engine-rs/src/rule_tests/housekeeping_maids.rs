//! Time-simulated maids: the shift windows per mode (Classic from noon with
//! the 16:30 cutoff, Modern from 08:00), the staff network of service
//! elevators and stairs (escalators carry no staff), six maids per crew and
//! one per floor at a time cycling through a floor's rooms, the staff pool
//! sized by the built crews, and the cleaning dwell. Crew choice and order
//! on a split network are covered by `housekeeping_dispatch_tests`; the
//! morning checkout latch by `housekeeping::tests::the_morning_checkout_latches_yesterdays_shift`.
use crate::clock::GameMode;
use crate::crowd::spawn::{max_staff_for, spawn_staff, StaffSpawn};
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

fn maids(sim: &Simulation) -> usize {
    sim.crowd.people.iter().filter(|p| p.staff).count()
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
    hours(&mut sim, 4); // 07:00 to 11:00
    assert_eq!(state(&sim, room), UnitState::Dirty);
    assert_eq!(maids(&sim), 0);
    hours(&mut sim, 1); // crossing noon dispatches
    assert!(maids(&sim) > 0);
    hours(&mut sim, 1);
    assert_eq!(state(&sim, room), UnitState::Empty);
}

#[test]
fn classic_dispatch_starts_no_room_after_the_1630_cutoff() {
    let mut sim = base_tower(32, GameMode::Classic);
    dirty_room(&mut sim, 2, X0);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    sim.clock.minutes = 16.0 * HOUR + 45.0;
    sim.dispatch_housekeepers();
    assert_eq!(maids(&sim), 0);
    sim.clock.minutes = 16.0 * HOUR + 15.0;
    sim.dispatch_housekeepers();
    assert!(maids(&sim) > 0);
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
    sim.clock.minutes = 13.0 * HOUR;
    sim.dispatch_housekeepers();
    // Seven reachable dirty rooms on seven floors, six maids out.
    assert_eq!(maids(&sim) as i64, HK_MAIDS_PER_UNIT);
}

#[test]
fn one_maid_takes_a_floors_two_rooms_in_turn() {
    let mut sim = base_tower(36, GameMode::Classic);
    let a = dirty_room(&mut sim, 2, X0);
    let b = dirty_room(&mut sim, 2, X0 + 4);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    hours(&mut sim, 5);
    assert_eq!(sim.clock.hour(), 12);
    assert_eq!(maids(&sim), 1, "one maid per floor per crew");
    // Within the hour she cleans the first, is released, and the release
    // sends her straight on to the second.
    hours(&mut sim, 1);
    assert_eq!(state(&sim, a), UnitState::Empty);
    assert_eq!(state(&sim, b), UnitState::Empty);
}

#[test]
fn the_staff_pool_is_the_built_crews_and_holds_while_a_crew_burns() {
    let mut sim = base_tower(39, GameMode::Classic);
    assert_eq!(max_staff_for(&sim.tower), 0);
    let crew = place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    slab(&mut sim, 3);
    place(&mut sim, Kind::Housekeeping, 3, X0 + 8);
    assert_eq!(max_staff_for(&sim.tower), 2 * HK_MAIDS_PER_UNIT);
    sim.tower.get_unit_mut(crew).unwrap().state = UnitState::Fire;
    assert_eq!(max_staff_for(&sim.tower), 2 * HK_MAIDS_PER_UNIT);
    assert!(sim.tower.remove_unit(crew).is_some());
    assert_eq!(max_staff_for(&sim.tower), HK_MAIDS_PER_UNIT);
}

#[test]
fn an_eleventh_crew_lifts_the_pool_past_the_old_fixed_64() {
    let mut sim = base_tower(40, GameMode::Classic);
    for floor in 3..=12 {
        slab(&mut sim, floor);
    }
    for floor in 2..=12 {
        place(&mut sim, Kind::Housekeeping, floor, X0 + 8);
    }
    let pool = 11 * HK_MAIDS_PER_UNIT;
    assert_eq!(max_staff_for(&sim.tower), pool);
    let room = dirty_room(&mut sim, 2, X0);
    let x = X0 as f64;
    sim.crowd.staff_count = 64;
    let send = |sim: &mut Simulation| {
        spawn_staff(
            &mut sim.crowd,
            &sim.tower,
            2,
            2,
            x,
            room,
            HK_CLEAN_MINUTES,
            None,
        )
    };
    assert_eq!(send(&mut sim), StaffSpawn::Sent);
    assert_eq!(send(&mut sim), StaffSpawn::Sent);
    assert_eq!(sim.crowd.staff_count, pool);
    assert_eq!(send(&mut sim), StaffSpawn::Full);
}

#[test]
fn a_maid_carries_the_cleaning_hold() {
    let mut sim = base_tower(37, GameMode::Classic);
    dirty_room(&mut sim, 2, X0);
    place(&mut sim, Kind::Housekeeping, 2, X0 + 8);
    sim.clock.minutes = 13.0 * HOUR;
    sim.dispatch_housekeepers();
    let maid = sim.crowd.people.iter().find(|p| p.staff).expect("a maid");
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
