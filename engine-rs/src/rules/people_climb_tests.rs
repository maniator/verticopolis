//! How fast people ride escalators and climb stairs. A Modern escalator is
//! slower than any Modern car and stairs are slower again; Classic keeps the
//! speeds it had until they are checked against the 1994 game.

use crate::clock::{CalendarKind, GameMode};
use crate::crowd::{motion, spawn, PState};
use crate::facilities::Kind;
use crate::rule_tests::shaft;
use crate::sim::Simulation;

/// Crowd seconds per step of the motion pass the tests drive.
const STEP: f64 = 0.05;

/// The crowd seconds one rider spends on a single flight of `kind` from
/// the lobby to floor 2, from the step they start climbing to the step they
/// step off.
fn one_flight_seconds(mode: GameMode, kind: Kind) -> f64 {
    let mut sim = Simulation::new(1, mode, CalendarKind::RealWorld, false);
    for x in 0..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok, "lobby at {x}");
        assert!(sim.tower.place(Kind::Floor, 2, x).ok, "floor at {x}");
    }
    let flight = shaft(&mut sim, kind, 16, 1, 2);
    let Simulation {
        ref mut crowd,
        ref mut tower,
        ..
    } = sim;
    let i = spawn::add(crowd, tower, 1, 2, Some(4), Some(4)).expect("a route up");
    assert_eq!(crowd.people[i].shafts, vec![flight]);
    let mut climbing = 0.0;
    for _ in 0..10_000 {
        let was_climbing = crowd.people[i].state == PState::Climbing;
        motion::advance(crowd, STEP, tower);
        if was_climbing {
            climbing += STEP;
            if crowd.people[i].floor == 2 {
                return climbing;
            }
        }
    }
    panic!("{mode:?} {kind:?}: the rider never reached floor 2");
}

/// Crowd seconds a car of `kind` takes per floor in `mode`.
fn car_seconds_per_floor(mode: GameMode, kind: Kind) -> f64 {
    crate::crowd::RIDE_SECONDS_PER_FLOOR / mode.speed_of(kind)
}

#[test]
fn a_modern_escalator_is_slower_than_any_car_and_stairs_slower_again() {
    let escalator = one_flight_seconds(GameMode::Modern, Kind::Escalator);
    let stairs = one_flight_seconds(GameMode::Modern, Kind::Stairs);
    for car in [Kind::ElevatorStandard, Kind::ElevatorExpress] {
        let car_floor = car_seconds_per_floor(GameMode::Modern, car);
        assert!(escalator > car_floor, "{car:?}: {escalator} vs {car_floor}");
    }
    assert!(
        stairs > escalator,
        "stairs {stairs} vs escalator {escalator}"
    );
}

#[test]
fn classic_keeps_its_climbing_speeds() {
    // 1 / 1.3 and 1 / 0.85 crowd seconds a floor, to within a step.
    let escalator = one_flight_seconds(GameMode::Classic, Kind::Escalator);
    let stairs = one_flight_seconds(GameMode::Classic, Kind::Stairs);
    assert!(
        (escalator - 1.0 / 1.3).abs() <= STEP,
        "escalator {escalator}"
    );
    assert!((stairs - 1.0 / 0.85).abs() <= STEP, "stairs {stairs}");
}
