//! The core simulation suite, hotel housekeeping: checkout leaves a room
//! dirty, a crew cleans it only once a maid has walked over and worked the
//! room, a kept hotel never seeds cockroaches, a crew built after checkout
//! works that day, maids need a staff route (no leg cap, a service car
//! before stairs), the shift report names rooms left unserved, staff calls
//! reach only the shaft the maid uses, and tenants never ride a service
//! car. Each crew's dispatch order and reach is also in
//! `housekeeping_dispatch_tests`; the service car missing from the tenant
//! floor lists in `dispatch_tests::the_served_list_follows_stairs_past_the_elevators_and_skips_service_cars`.
use crate::clock::GameMode;
use crate::crowd::spawn::{spawn_staff, StaffSpawn};
use crate::crowd::PState;
use crate::dispatch::ElevatorDispatch;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::seeded_game;
use super::simulation_economy::{hours, X0};

/// A seeded game with floor 2 over the lobby and a passenger shaft to it,
/// at two stars.
fn hotel_tower(seed: u32) -> Simulation {
    let mut sim = seeded_game(seed, GameMode::Classic);
    for i in 0..24 {
        sim.tower.place(Kind::Floor, 2, X0 + i);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, X0, 1, 2).ok);
    sim.star = 2;
    sim
}

fn floors(sim: &mut Simulation, range: std::ops::RangeInclusive<i64>) {
    for floor in range {
        for i in 0..24 {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
}

fn room(sim: &mut Simulation, kind: Kind, floor: i64, x: i64, state: UnitState) -> i64 {
    let id = sim.tower.place(kind, floor, x).unit_id.unwrap();
    sim.tower.get_unit_mut(id).unwrap().state = state;
    id
}

fn state(sim: &Simulation, id: i64) -> UnitState {
    sim.tower.get_unit(id).unwrap().state
}

fn logged(sim: &Simulation, needle: &str) -> bool {
    sim.log.iter().any(|e| e.text.contains(needle))
}

#[test]
fn checkout_leaves_the_room_dirty_with_no_crew() {
    let mut sim = hotel_tower(4);
    let id = room(&mut sim, Kind::HotelDouble, 2, X0, UnitState::Asleep);
    hours(&mut sim, 24);
    assert_eq!(state(&sim, id), UnitState::Dirty);
    let dirty = sim
        .tower
        .units
        .iter()
        .filter(|u| u.state == UnitState::Dirty)
        .count();
    assert_eq!(dirty, 1);
}

#[test]
fn a_crew_cleans_only_after_a_maid_walks_over_and_works_the_room() {
    let mut sim = hotel_tower(12);
    let id = room(&mut sim, Kind::HotelDouble, 2, X0, UnitState::Dirty);
    assert!(sim.tower.place(Kind::Housekeeping, 2, X0 + 8).ok);
    // Through the Classic noon shift start: a maid is out, the room is not
    // done yet.
    hours(&mut sim, 5);
    assert_eq!(state(&sim, id), UnitState::Dirty);
    assert!(sim.crowd.people.iter().any(|p| p.staff));
    hours(&mut sim, 1);
    assert_eq!(state(&sim, id), UnitState::Empty);
}

#[test]
fn a_kept_hotel_never_seeds_cockroaches() {
    let mut sim = hotel_tower(21);
    room(&mut sim, Kind::HotelSingle, 2, X0, UnitState::Asleep);
    room(&mut sim, Kind::HotelSingle, 2, X0 + 4, UnitState::Asleep);
    assert!(sim.tower.place(Kind::Housekeeping, 2, X0 + 8).ok);
    hours(&mut sim, 24 * 3);
    assert!(!logged(&sim, "Cockroaches"));
}

#[test]
fn a_crew_built_after_checkout_works_the_same_day() {
    let mut sim = hotel_tower(22);
    let id = room(&mut sim, Kind::HotelDouble, 2, X0, UnitState::Dirty);
    hours(&mut sim, 3);
    assert_eq!(state(&sim, id), UnitState::Dirty);
    assert!(sim.tower.place(Kind::Housekeeping, 2, X0 + 8).ok);
    hours(&mut sim, 3);
    assert_eq!(state(&sim, id), UnitState::Empty);
}

#[test]
fn maids_need_a_staff_route_and_a_passenger_car_is_not_one() {
    let mut sim = hotel_tower(8);
    floors(&mut sim, 3..=5);
    let shaft = sim.tower.transports[0].id;
    assert!(sim.tower.resize_transport(shaft, 1, 5).ok);
    let id = room(&mut sim, Kind::HotelDouble, 5, X0, UnitState::Dirty);
    assert!(sim.tower.place(Kind::Housekeeping, 2, X0 + 8).ok);
    hours(&mut sim, 25);
    assert_eq!(state(&sim, id), UnitState::Dirty);
    assert!(logged(&sim, "Housekeeping can't reach"));
    assert!(sim.build_transport(Kind::ElevatorService, X0 + 14, 2, 5).ok);
    hours(&mut sim, 20);
    assert_ne!(state(&sim, id), UnitState::Dirty);
}

#[test]
fn a_long_stair_chain_is_a_staff_route_with_no_leg_cap() {
    let mut sim = hotel_tower(23);
    floors(&mut sim, 2..=14);
    for floor in 1..=13 {
        assert!(
            sim.tower
                .place_transport(Kind::Stairs, X0 + (floor % 3) * 8, floor, floor + 1)
                .ok
        );
    }
    assert!(sim.tower.staff_connected(1, 14));
    assert!(sim
        .crowd
        .staff_route(&sim.tower, 1, 14, None, None)
        .is_some());
}

#[test]
fn maids_ride_the_service_car_before_equal_stairs() {
    let mut sim = hotel_tower(41);
    floors(&mut sim, 3..=5);
    assert!(sim.tower.place_transport(Kind::Stairs, X0 + 6, 2, 3).ok);
    let service = sim
        .tower
        .place_transport(Kind::ElevatorService, X0 + 16, 2, 5)
        .unit_id
        .unwrap();
    let route = sim.crowd.staff_route(&sim.tower, 2, 3, None, None).unwrap();
    assert_eq!(route.shafts[0], service);
}

#[test]
fn the_next_checkout_reports_rooms_a_shift_left_unserved() {
    let mut sim = hotel_tower(42);
    for x in (X0 + 40..X0 + 60).chain((X0 - 60..X0).rev()) {
        sim.tower.place(Kind::Lobby, 1, x);
    }
    for i in -60..60 {
        sim.tower.place(Kind::Floor, 2, X0 + i);
    }
    assert!(sim.tower.place(Kind::Housekeeping, 2, X0 - 60).ok);
    let mut placed = 0;
    let mut x = X0 - 50;
    while placed < 24 && x + 4 <= X0 + 60 {
        if sim.tower.place(Kind::HotelSingle, 2, x).ok {
            placed += 1;
        }
        x += 4;
    }
    assert_eq!(placed, 24);
    for u in sim
        .tower
        .units
        .iter_mut()
        .filter(|u| u.kind == Kind::HotelSingle)
    {
        u.state = UnitState::Dirty;
    }
    hours(&mut sim, 25);
    assert!(logged(&sim, "went unserved"));
}

#[test]
fn a_staff_call_reaches_only_the_shaft_the_maid_uses() {
    let mut sim = hotel_tower(31);
    floors(&mut sim, 3..=5);
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorService, X0 + 6, 1, 5)
            .ok
    );
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorService, X0 + 12, 1, 5)
            .ok
    );
    assert!(sim.tower.place(Kind::Housekeeping, 3, X0 + 8).ok);
    let sent = spawn_staff(
        &mut sim.crowd,
        &sim.tower,
        3,
        5,
        (X0 + 2) as f64,
        12345,
        8.0,
        None,
    );
    assert!(matches!(sent, StaffSpawn::Sent));
    let maid = sim.crowd.people.iter_mut().find(|p| p.staff).unwrap();
    maid.state = PState::Waiting;
    let used = maid.shaft_id.unwrap();
    let calls = sim.crowd.elevator_calls(&sim.tower);
    assert_eq!(calls.hall.keys().copied().collect::<Vec<_>>(), vec![used]);
    let services: Vec<i64> = sim
        .tower
        .transports
        .iter()
        .filter(|t| t.kind == Kind::ElevatorService)
        .map(|t| t.id)
        .collect();
    let other = *services.iter().find(|&&id| id != used).unwrap();
    sim.tower.set_cars(used, 1);
    sim.tower.set_cars(other, 1);
    let mut dispatch = ElevatorDispatch::new();
    for _ in 0..4 {
        let calls = sim.crowd.elevator_calls(&sim.tower);
        dispatch.move_cars(&mut sim.tower, 2.0, &calls, 1, false);
    }
    let car = |id: i64| {
        sim.tower
            .transports
            .iter()
            .find(|t| t.id == id)
            .unwrap()
            .car_positions[0]
    };
    assert!(car(used) > 1.0);
    assert!((car(other) - 1.0).abs() < 0.01);
}

#[test]
fn tenants_never_route_over_a_service_car() {
    let mut sim = hotel_tower(9);
    floors(&mut sim, 3..=5);
    assert!(sim.build_transport(Kind::ElevatorService, X0 + 14, 1, 5).ok);
    assert!(sim.crowd.route(&sim.tower, 1, 5, None, None).is_none());
    assert!(!sim.tower.is_floor_served(5));
    let shaft = sim.tower.transports[0].id;
    assert!(sim.tower.resize_transport(shaft, 1, 5).ok);
    assert!(sim.crowd.route(&sim.tower, 1, 5, None, None).is_some());
    assert!(sim.tower.is_floor_served(5));
}
