//! Elevator doors: people step on and off only a car that has stopped at
//! their floor, as in the 1994 original, never one passing the floor; and a
//! car lands on the stop it heads for instead of gliding past it.
//!
//! Before this rule a person boarded any car within a quarter floor of them
//! and a rider stepped off any car within a fifth of a floor of their floor
//! (or one that crossed it), so on busy towers most boardings were onto
//! moving cars. And a car that ended a move within 0.05 of its target never
//! arrived: the stop search looks past a stop that near, so the car turned
//! away or ran on without dwelling.
use std::collections::{BTreeSet, HashMap};

use crate::clock::GameMode;
use crate::crowd::motion::advance;
use crate::crowd::spawn::make_person;
use crate::crowd::{ElevatorCalls, PState, Route};
use crate::dispatch::ElevatorDispatch;
use crate::facilities::Kind;
use crate::sim::Simulation;

use super::{shaft, strip_tower};

/// A 40-wide tower up to floor 6 with one standard elevator at x 4 (one car,
/// parked at the lobby) and a person routed from floor `from` to floor `to`
/// on it, already waiting at the shaft. Returns the shaft id and the
/// person's index.
fn tower_with_rider(from: i64, to: i64) -> (Simulation, i64, usize) {
    let mut sim = strip_tower(7, GameMode::Classic, 40, 6);
    let id = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 6);
    let route = Route {
        floors: vec![from, to],
        shafts: vec![id],
    };
    let i = make_person(&mut sim.crowd, &sim.tower, route, 30.0, None);
    let p = &mut sim.crowd.people[i];
    (p.state, p.floor, p.fy, p.x) = (PState::Waiting, from, from as f64, 6.0);
    (sim, id, i)
}

fn place_car(sim: &mut Simulation, id: i64, pos: f64, dir: i64) {
    let t = sim
        .tower
        .transports
        .iter_mut()
        .find(|t| t.id == id)
        .unwrap();
    t.car_positions[0] = pos;
    t.car_dir[0] = dir;
}

/// A cab call to `floor` for car 0 of shaft `id`, and nothing else.
fn cab_call(id: i64, floor: i64) -> ElevatorCalls {
    let mut calls = ElevatorCalls::default();
    let cab = HashMap::from([(0, BTreeSet::from([floor]))]);
    calls.cab.insert(id, cab);
    calls
}

#[test]
fn nobody_boards_a_car_passing_their_floor() {
    let (mut sim, id, i) = tower_with_rider(3, 6);
    // The car is a tenth of a floor past floor 3 on its way up, doors shut.
    place_car(&mut sim, id, 3.1, 1);
    sim.crowd.open_cars.clear();
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(sim.crowd.people[i].state, PState::Waiting);
    // The same car standing at floor 3 with its doors open takes them.
    place_car(&mut sim, id, 3.0, 1);
    sim.crowd.open_cars = vec![(id, 0, 3)];
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(sim.crowd.people[i].state, PState::Riding);
}

#[test]
fn a_car_open_at_another_floor_takes_nobody() {
    let (mut sim, id, i) = tower_with_rider(3, 6);
    place_car(&mut sim, id, 3.0, 0);
    // Listed open at floor 4: a stale or mismatched entry boards nobody here.
    sim.crowd.open_cars = vec![(id, 0, 4)];
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(sim.crowd.people[i].state, PState::Waiting);
}

#[test]
fn a_rider_stays_aboard_a_car_passing_their_floor() {
    let (mut sim, id, i) = tower_with_rider(1, 4);
    sim.crowd.open_cars = vec![(id, 0, 1)];
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(sim.crowd.people[i].state, PState::Riding);
    // The car runs through floor 4 without stopping: a hundredth short of
    // it, exactly on it, then just past it, doors shut every time.
    sim.crowd.open_cars.clear();
    for pos in [3.99, 4.0, 4.1] {
        place_car(&mut sim, id, pos, 1);
        advance(&mut sim.crowd, 0.1, &mut sim.tower);
        assert_eq!(sim.crowd.people[i].state, PState::Riding, "at {pos}");
    }
    // It stops at floor 4 and opens: the rider steps off there.
    place_car(&mut sim, id, 4.0, -1);
    sim.crowd.open_cars = vec![(id, 0, 4)];
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    let p = &sim.crowd.people[i];
    assert_eq!(p.state, PState::ToDest);
    assert_eq!((p.floor, p.fy), (4, 4.0));
}

#[test]
fn the_dispatch_opens_arriving_dwelling_and_parked_cars_only() {
    let (mut sim, id, _) = tower_with_rider(1, 5);
    let mut d = ElevatorDispatch::new();
    // Parked at the lobby with nothing to do: open there.
    d.move_cars(&mut sim.tower, 0.1, &ElevatorCalls::default(), 9, false);
    assert_eq!(d.open_cars(), [(id, 0, 1)]);
    // A cab call to 5: the car leaves, doors shut while it travels.
    let calls = cab_call(id, 5);
    d.move_cars(&mut sim.tower, 1.0, &calls, 9, false);
    assert!(sim.tower.get_transport(id).unwrap().car_positions[0] > 1.0);
    assert!(d.open_cars().is_empty());
    let mut arrived = false;
    for _ in 0..20 {
        d.move_cars(&mut sim.tower, 1.0, &calls, 9, false);
        if sim.tower.get_transport(id).unwrap().car_positions[0] == 5.0 {
            arrived = true;
            break;
        }
    }
    assert!(arrived, "the car reached floor 5");
    assert_eq!(d.open_cars(), [(id, 0, 5)], "open on arrival");
    // Still dwelling a short step later: still open.
    d.move_cars(&mut sim.tower, 0.1, &calls, 9, false);
    assert_eq!(sim.tower.get_transport(id).unwrap().car_positions[0], 5.0);
    assert_eq!(d.open_cars(), [(id, 0, 5)], "open while it dwells");
}

#[test]
fn a_car_ending_a_move_a_hair_short_of_its_stop_lands_on_it() {
    let (mut sim, id, _) = tower_with_rider(2, 3);
    // Heading up for a cab stop at 3, with a hall call behind it at 2 that
    // would turn it around if it ever looked past 3.
    place_car(&mut sim, id, 2.9, 1);
    let mut calls = cab_call(id, 3);
    calls.hall.insert(id, HashMap::from([(2, 3.0)]));
    let mut d = ElevatorDispatch::new();
    // A step that covers 0.06 of the 0.1 left: moved by that much, the car
    // would stop 0.04 short, inside the search's reach, and never arrive.
    d.move_cars(&mut sim.tower, 0.075, &calls, 9, false);
    let t = sim.tower.get_transport(id).unwrap();
    assert_eq!(t.car_positions[0], 3.0, "landed on its stop");
    assert_eq!(d.open_cars(), [(id, 0, 3)]);
}

#[test]
fn a_parked_car_left_off_its_floor_settles_there_and_takes_riders() {
    // A save from before cars landed on their stops can hold a parked car a
    // hair above its home floor. Left there, its doors would open at floor 1
    // while it stood at 1.04, and the person waiting at floor 1 would never
    // board.
    let (mut sim, id, i) = tower_with_rider(1, 5);
    place_car(&mut sim, id, 1.04, 0);
    let mut d = ElevatorDispatch::new();
    d.move_cars(&mut sim.tower, 0.1, &ElevatorCalls::default(), 9, false);
    let t = sim.tower.get_transport(id).unwrap();
    assert_eq!(t.car_positions[0], 1.0, "settled on its home floor");
    d.swap_open_cars(&mut sim.crowd.open_cars);
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(sim.crowd.people[i].state, PState::Riding);
}
