//! The elevator dispatcher run on a bare tower, with no simulation around
//! it: a car climbs to statistical demand, idle cars park at the lobby, a
//! real waiting person is served with no statistical demand, and a car's own
//! rider destination is served even when another car claims the floor.
//!
//! The suite's economy half is covered by the catalog charge tests:
//! quarterly rent from occupied offices by
//! `catalog::charge_tests::each_rent_cadence_collects_the_quoted_price`, a
//! player-set rent by
//! `catalog::charge_tests::every_offered_price_is_the_one_collected`, car
//! and service upkeep by
//! `catalog::charge_tests::a_maintenance_period_charges_the_quoted_upkeep`,
//! and the unsold condo's hold tax and overhead (a sold one exempt) by
//! `catalog::charge_tests::overhead_and_the_condo_hold_tax_follow_the_quote`.
use std::collections::{BTreeSet, HashMap};

use crate::crowd::ElevatorCalls;
use crate::dispatch::ElevatorDispatch;
use crate::facilities::Kind;
use crate::tower::{Tower, UnitState};

/// The rush factor the TypeScript suite drove the dispatcher with.
const RUSH: f64 = 1.45;
/// A weekday afternoon hour: no schedule is set, so any hour reads the same.
const HOUR: i64 = 12;
const WEEKDAY: bool = false;

/// A lobby and floors 2 to `top`, 40 tiles wide, with one standard
/// elevator at x 4 serving every floor. Returns the tower and the shaft id.
fn tower_with_elevator(top: i64) -> (Tower, i64) {
    let mut tower = Tower::new();
    for x in 0..40 {
        assert!(tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=top {
        for x in 0..40 {
            assert!(tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let shaft = tower.place_transport(Kind::ElevatorStandard, 4, 1, top);
    assert!(shaft.ok, "{:?}", shaft.reason);
    (tower, shaft.unit_id.unwrap())
}

/// `dispatch.update(tower, dt, rush, calls)`: the waiting estimate, then
/// the car moves.
fn update(d: &mut ElevatorDispatch, tower: &mut Tower, calls: &ElevatorCalls) {
    d.accumulate(tower, 1.0, RUSH);
    d.move_cars(tower, 1.0, calls, HOUR, WEEKDAY);
}

fn shaft(tower: &Tower, id: i64) -> &crate::tower::Transport {
    tower.get_transport(id).unwrap()
}

fn at(pos: f64, floor: i64) -> bool {
    (pos - floor as f64).abs() < 0.05
}

#[test]
fn a_car_climbs_toward_a_floor_with_waiting_passengers() {
    let (mut tower, id) = tower_with_elevator(10);
    let office = tower.place(Kind::Office, 8, 10).unit_id.unwrap();
    let u = tower.get_unit_mut(office).unwrap();
    u.state = UnitState::Occupied;
    u.occupants = 6;
    let mut d = ElevatorDispatch::new();
    let none = ElevatorCalls::default();
    let mut highest = 1.0_f64;
    for _ in 0..400 {
        update(&mut d, &mut tower, &none);
        for &p in &shaft(&tower, id).car_positions {
            highest = highest.max(p);
        }
    }
    assert!(highest > 6.0, "the highest car reached {highest}");
    let loads = shaft(&tower, id).car_load.clone().unwrap_or_default();
    assert!(loads.iter().any(|&n| n > 0.0), "nobody boarded: {loads:?}");
}

#[test]
fn idle_cars_park_at_the_lobby_with_no_demand() {
    let (mut tower, id) = tower_with_elevator(10);
    let mut d = ElevatorDispatch::new();
    let none = ElevatorCalls::default();
    for _ in 0..300 {
        update(&mut d, &mut tower, &none);
    }
    let t = shaft(&tower, id);
    assert!(
        t.car_positions
            .iter()
            .all(|p| (p - t.bottom as f64).abs() < 0.5),
        "{:?}",
        t.car_positions
    );
    assert!(t.car_dir.iter().all(|&d| d == 0), "{:?}", t.car_dir);
}

#[test]
fn a_real_waiting_person_is_served_with_no_statistical_demand() {
    let (mut tower, id) = tower_with_elevator(10);
    let mut calls = ElevatorCalls::default();
    calls.hall.insert(id, HashMap::from([(7, 1.0)]));
    let mut d = ElevatorDispatch::new();
    let mut served = false;
    for _ in 0..100 {
        update(&mut d, &mut tower, &calls);
        served = shaft(&tower, id).car_positions.iter().any(|&p| at(p, 7));
        if served {
            break;
        }
    }
    assert!(served, "no car reached the caller on floor 7");
}

#[test]
fn a_cars_own_rider_stop_is_served_when_another_car_claims_the_floor() {
    let (mut tower, id) = tower_with_elevator(10);
    tower.set_cars(id, 2);
    // Car 1 carries a rider bound for floor 9, which is also a hall call that
    // car 0 (moved first each step) would otherwise claim every step.
    let mut calls = ElevatorCalls::default();
    calls.hall.insert(id, HashMap::from([(9, 1.0)]));
    calls
        .cab
        .insert(id, HashMap::from([(1, BTreeSet::from([9]))]));
    let mut d = ElevatorDispatch::new();
    let mut delivered = false;
    for _ in 0..100 {
        update(&mut d, &mut tower, &calls);
        delivered = at(shaft(&tower, id).car_positions[1], 9);
        if delivered {
            break;
        }
    }
    assert!(delivered, "car 1 never reached its rider's floor");
}
