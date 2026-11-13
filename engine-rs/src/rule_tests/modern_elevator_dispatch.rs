//! Modern's smart dispatch (`rules::elevators`, `dispatch_modern.rs`), the
//! package the owner picked after the 2026-11-12 party round, on a whole
//! shaft:
//!
//! - Best car: a hall call goes to the one car best placed for it; a car
//!   already coming within Waiting Car Response floors keeps it outright.
//! - Spread homes: cars with no home idle spread up the shaft without a
//!   home being written to the schedule, and an authored home is kept.
//! - Standard Floor Departure restarts while riders arrive, up to twice the
//!   setting.
//!
//! Classic's 1994 rules, which these tests contrast, are
//! `rule_tests::classic_elevator_dispatch`.
use crate::clock::GameMode;
use crate::crowd::ElevatorCalls;
use crate::dispatch::ElevatorDispatch;
use crate::schedule::Schedule;

use super::classic_elevator_dispatch::{
    parked_car_answers, schedule, shaft_tower, stay_at_the_call, HOUR, TOP, WEEKDAY,
};

fn near(p: f64, floor: i64) -> bool {
    (p - floor as f64).abs() < 0.05
}

#[test]
fn a_car_coming_within_the_response_keeps_the_call() {
    // Car 1 is 6 floors below the call at 10, heading up with a rider for
    // the top: within a response of 8 it keeps the call, so the lobby car
    // stays parked, as in Classic.
    assert!(!parked_car_answers(GameMode::Modern, 8.0, 4.0));
    assert!(!parked_car_answers(GameMode::Classic, 8.0, 4.0));
}

#[test]
fn the_nearer_moving_car_keeps_the_call_outside_the_response_too() {
    // Outside a response of 3 Classic sends the lobby car 9 floors off;
    // Modern scores the coming car 6 floors off (one promised stop) better.
    assert!(!parked_car_answers(GameMode::Modern, 3.0, 4.0));
    assert!(parked_car_answers(GameMode::Classic, 3.0, 4.0));
}

#[test]
fn a_car_moving_away_leaves_the_call_to_the_parked_car() {
    // Car 1 is above the call and going up to the top: the lobby car goes.
    assert!(parked_car_answers(GameMode::Modern, 30.0, 14.0));
}

/// Three cars homed and parked at floors 1, 8 and 16, then a call at 14.
/// The car that leaves its home for it.
fn the_car_sent_to_floor_14(mode: GameMode) -> Vec<usize> {
    let mut s = schedule(None);
    s.home_floors = Some(vec![1, 8, 16]);
    let (mut tower, id) = shaft_tower(mode, 3, s);
    let mut d = ElevatorDispatch::new();
    for _ in 0..60 {
        d.move_cars(&mut tower, 1.0, &ElevatorCalls::default(), HOUR, WEEKDAY);
    }
    let homes = [1, 8, 16];
    let t = &tower.transports[0];
    assert!(t.car_positions.iter().zip(homes).all(|(&p, h)| near(p, h)));
    let mut calls = ElevatorCalls::default();
    calls.hall.insert(id, [(14, 1.0)].into_iter().collect());
    for _ in 0..2 {
        d.move_cars(&mut tower, 1.0, &calls, HOUR, WEEKDAY);
    }
    let t = &tower.transports[0];
    (0..3)
        .filter(|&i| !near(t.car_positions[i], homes[i]))
        .collect()
}

#[test]
fn only_the_nearest_parked_car_answers() {
    // Modern sends the car two floors off; Classic's first sweeping car,
    // thirteen floors off, claims the call first.
    assert_eq!(the_car_sent_to_floor_14(GameMode::Modern), vec![2]);
    assert_eq!(the_car_sent_to_floor_14(GameMode::Classic), vec![0]);
}

/// Four cars with `homes` idled for a while; where each one parks.
fn idle_positions(mode: GameMode, homes: Option<Vec<i64>>) -> Vec<f64> {
    let s = Schedule {
        home_floors: homes.clone(),
        ..schedule(None)
    };
    let (mut tower, _) = shaft_tower(mode, 4, s);
    let mut d = ElevatorDispatch::new();
    for _ in 0..200 {
        d.move_cars(&mut tower, 1.0, &ElevatorCalls::default(), HOUR, WEEKDAY);
    }
    let t = &tower.transports[0];
    assert!(t.car_dir.iter().all(|&d| d == 0), "parked: {:?}", t.car_dir);
    // The spread is where the cars wait, never a home written down.
    assert_eq!(t.schedule.as_ref().unwrap().home_floors, homes);
    t.car_positions.clone()
}

#[test]
fn modern_cars_with_no_home_spread_up_the_shaft() {
    let parked_at = |cars: Vec<f64>, floors: [i64; 4]| {
        assert!(
            cars.iter().zip(floors).all(|(&p, f)| near(p, f)),
            "{cars:?} against {floors:?}"
        );
    };
    // Twenty stops and four cars: the lobby, then stops 5, 10 and 15.
    parked_at(idle_positions(GameMode::Modern, None), [1, 6, 11, 16]);
    parked_at(idle_positions(GameMode::Classic, None), [1; 4]);
    // A home of its own is kept; only the unlisted cars spread.
    let homed = idle_positions(GameMode::Modern, Some(vec![TOP]));
    parked_at(homed, [TOP, 6, 11, 16]);
}

#[test]
fn a_modern_car_keeps_loading_only_up_to_twice_the_departure_wait() {
    let (once, _) = stay_at_the_call(GameMode::Modern, false);
    let (modern, modern_left) = stay_at_the_call(GameMode::Modern, true);
    let (classic, _) = stay_at_the_call(GameMode::Classic, true);
    // Riders arriving restart the wait, but the car leaves at twice the
    // setting (plus the step it arrived in), long before Classic's full car.
    assert!(modern > once, "Modern held {modern} steps, one wait {once}");
    assert!(
        modern <= 2 * once + 1,
        "Modern held {modern}, one wait {once}"
    );
    assert!(modern_left, "the Modern car departs");
    assert!(classic > modern, "Classic held {classic}, Modern {modern}");
}
