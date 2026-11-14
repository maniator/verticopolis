//! Classic dispatch follows the 1994 Elevator window's two settings as the
//! SimTower wiki's Elevators page describes them (`rules::elevators`):
//!
//! - Waiting Car Response: a parked car stays put while a car of its shaft,
//!   already moving toward the call, is within that many floors; a moving car
//!   farther off than that leaves the call to the parked car.
//! - Standard Floor Departure: a car loading at a floor boards whoever
//!   arrives while it waits and starts the wait over, until nobody new comes
//!   or it is full. A Modern car restarts the wait too, but only up to twice
//!   the setting.
//!
//! Modern's best-car dispatch, which folds Waiting Car Response into its
//! choice, is `rule_tests::modern_elevator_dispatch`.
use std::collections::{BTreeSet, HashMap};

use crate::clock::GameMode;
use crate::crowd::ElevatorCalls;
use crate::dispatch::ElevatorDispatch;
use crate::facilities::Kind;
use crate::schedule::Schedule;
use crate::tower::Tower;

pub(super) const TOP: i64 = 20;
pub(super) const HOUR: i64 = 12;
pub(super) const WEEKDAY: bool = false;
const CALL_FLOOR: i64 = 10;

/// A standard elevator over floors 1 to `TOP` with `cars` cars, the given
/// schedule, in a tower of the given mode with nobody in it.
pub(super) fn shaft_tower(mode: GameMode, cars: i64, schedule: Schedule) -> (Tower, i64) {
    let mut tower = Tower::new();
    tower.mode = mode;
    for x in 0..40 {
        assert!(tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=TOP {
        for x in 0..40 {
            assert!(tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let r = tower.place_transport(Kind::ElevatorStandard, 4, 1, TOP);
    let id = r.unit_id.expect("the shaft is placed");
    tower.set_cars(id, cars);
    tower.transports[0].schedule = Some(schedule);
    (tower, id)
}

pub(super) fn schedule(response: Option<f64>) -> Schedule {
    Schedule {
        weekday: None,
        weekend: None,
        waiting_car_response: response,
        standard_floor_departure: None,
        home_floors: Some(vec![1, 1]),
        held_back: None,
    }
}

/// Car 0 parked at the lobby; car 1 at floor `from` heading up to its rider's
/// floor `TOP`; a hall call at `CALL_FLOOR`. Whether car 0 leaves the lobby
/// within a few steps.
pub(super) fn parked_car_answers(mode: GameMode, response: f64, from: f64) -> bool {
    parked_car_answers_calls(mode, response, from, &[CALL_FLOOR])
}

/// `parked_car_answers` with a hall call at each of `call_floors`.
fn parked_car_answers_calls(mode: GameMode, response: f64, from: f64, call_floors: &[i64]) -> bool {
    let (mut tower, id) = shaft_tower(mode, 2, schedule(Some(response)));
    let t = &mut tower.transports[0];
    t.car_positions = vec![1.0, from];
    t.car_dir = vec![0, 1];
    let mut calls = ElevatorCalls::default();
    let hall = call_floors.iter().map(|&f| (f, 1.0)).collect();
    calls.hall.insert(id, hall);
    let rider = HashMap::from([(1, BTreeSet::from([TOP]))]);
    calls.cab.insert(id, rider);
    let mut d = ElevatorDispatch::new();
    for _ in 0..3 {
        d.move_cars(&mut tower, 1.0, &calls, HOUR, WEEKDAY);
    }
    tower.transports[0].car_positions[0] > 1.05
}

#[test]
fn a_parked_car_leaves_a_call_to_a_moving_car_within_the_response() {
    // Car 1 is 6 floors below the call and heading up: a response of 8
    // covers it, so the lobby car stays parked.
    assert!(!parked_car_answers(GameMode::Classic, 8.0, 4.0));
}

#[test]
fn a_parked_car_answers_when_the_moving_car_is_farther_than_the_response() {
    // The same moving car is outside a response of 3, so the lobby car goes.
    assert!(parked_car_answers(GameMode::Classic, 3.0, 4.0));
}

#[test]
fn a_moving_car_past_the_call_does_not_cover_it() {
    // Car 1 is above the call and still going up, so it never comes back
    // for it: the lobby car answers whatever the response.
    assert!(parked_car_answers(GameMode::Classic, 30.0, 14.0));
}

#[test]
fn a_parked_car_answers_an_uncovered_call_beyond_a_covered_one() {
    // Car 1 at floor 9 heading up covers the call at 10 under a response of
    // 2, but not the call at 15: the lobby car passes over 10 and goes.
    assert!(parked_car_answers_calls(
        GameMode::Classic,
        2.0,
        9.0,
        &[CALL_FLOOR, 15]
    ));
    assert!(!parked_car_answers_calls(
        GameMode::Classic,
        2.0,
        9.0,
        &[CALL_FLOOR]
    ));
}

/// One car sent to floor `CALL_FLOOR`, where, if `newcomers`, one more
/// caller joins every step the car stands there (otherwise the one caller
/// just keeps waiting). The longest run of steps it spends on that floor, and
/// whether it ever left again.
pub(super) fn stay_at_the_call(mode: GameMode, newcomers: bool) -> (usize, bool) {
    let mut s = schedule(None);
    s.home_floors = Some(vec![1]);
    let (mut tower, id) = shaft_tower(mode, 1, s);
    let mut calls = ElevatorCalls::default();
    calls.hall.insert(id, HashMap::from([(CALL_FLOOR, 1.0)]));
    let mut d = ElevatorDispatch::new();
    let (mut run, mut longest, mut arrived, mut left) = (0, 0, false, false);
    for _ in 0..120 {
        d.move_cars(&mut tower, 0.5, &calls, HOUR, WEEKDAY);
        let on_floor = (tower.transports[0].car_positions[0] - CALL_FLOOR as f64).abs() < 0.05;
        if on_floor {
            if newcomers {
                *calls
                    .hall
                    .get_mut(&id)
                    .unwrap()
                    .get_mut(&CALL_FLOOR)
                    .unwrap() += 1.0;
            }
            arrived = true;
            run += 1;
            longest = longest.max(run);
        } else {
            left |= arrived;
            run = 0;
        }
    }
    (longest, left)
}

#[test]
fn a_classic_car_keeps_loading_while_riders_arrive_and_leaves_when_full() {
    let (classic, classic_left) = stay_at_the_call(GameMode::Classic, true);
    let (modern, _) = stay_at_the_call(GameMode::Modern, true);
    assert!(
        classic > modern,
        "Classic held {classic} steps, Modern {modern}"
    );
    // One rider a step fills the 21-place car, so it does leave.
    assert!(classic_left, "a full Classic car departs");
    assert!(classic <= 21 * 2 + 2, "held {classic} half-minute steps");
}

#[test]
fn a_caller_who_was_already_waiting_does_not_restart_the_wait() {
    // The same caller still standing there is nobody new: the car leaves
    // after one wait in either mode.
    let (classic, classic_left) = stay_at_the_call(GameMode::Classic, false);
    let (modern, _) = stay_at_the_call(GameMode::Modern, false);
    assert_eq!(classic, modern);
    assert!(classic_left);
}
