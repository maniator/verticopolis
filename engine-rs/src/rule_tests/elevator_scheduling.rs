//! The authored elevator schedule in dispatch (#305 phase 2): idle cars
//! home at their authored floor, a 0-active hour parks the fleet without
//! stranding its floors, each day type runs its own row, a longer Standard
//! Floor Departure holds a car longer, the plain SCAN profile's reach (span
//! less Waiting Car Response) holds a parked car from a far call but not a
//! near one while Modern answers it, an off-shaft home clamps to the shaft,
//! and a scheduled shaft runs the same every time.
//!
//! The TypeScript case "ignores the schedule when no clock is supplied" is
//! n/a in Rust: `ElevatorDispatch::move_cars` always takes the hour and day
//! type, so there is no clockless call. The step-for-step match against a
//! reference dispatcher, schedules included, is
//! `dispatch_tests::dispatch_matches_the_hashed_reference_step_for_step`;
//! staff riding a parked car is
//! `housekeeping_dispatch_tests::maids_never_board_a_car_the_schedule_has_parked`.
use std::collections::HashMap;

use crate::clock::GameMode;
use crate::crowd::ElevatorCalls;
use crate::dispatch::{DispatchRules, ElevatorDispatch};
use crate::facilities::Kind;
use crate::schedule::{Schedule, SCHEDULE_HOURS};
use crate::tower::{Tower, Transport};

const TOP: i64 = 20;
const HOUR: i64 = 17;
const WEEKDAY: bool = false;
const WEEKEND: bool = true;

/// A schedule with nothing authored.
fn blank() -> Schedule {
    Schedule {
        weekday: None,
        weekend: None,
        waiting_car_response: None,
        standard_floor_departure: None,
        home_floors: None,
    }
}

/// A row that reads `value` at every hour.
fn flat(value: i64) -> Option<Vec<i64>> {
    Some(vec![value; SCHEDULE_HOURS])
}

/// Floors 1 to `TOP`, 40 tiles wide, one standard elevator with `cars` cars
/// and `schedule` on it. Returns the tower and the shaft id.
fn scheduled(cars: i64, schedule: Option<Schedule>) -> (Tower, i64) {
    let mut tower = Tower::new();
    for x in 0..40 {
        assert!(tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=TOP {
        for x in 0..40 {
            assert!(tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let r = tower.place_transport(Kind::ElevatorStandard, 4, 1, TOP);
    assert!(r.ok, "{:?}", r.reason);
    let id = r.unit_id.unwrap();
    tower.set_cars(id, cars);
    assert_eq!(tower.get_transport(id).unwrap().cars, cars);
    tower.transports[0].schedule = schedule;
    (tower, id)
}

/// A standing hall call on each floor.
fn hall_calls(id: i64, floors: &[i64]) -> ElevatorCalls {
    let mut calls = ElevatorCalls::default();
    calls.hall.insert(
        id,
        floors.iter().map(|&f| (f, 1.0)).collect::<HashMap<_, _>>(),
    );
    calls
}

fn run(
    d: &mut ElevatorDispatch,
    tower: &mut Tower,
    calls: &ElevatorCalls,
    steps: usize,
    weekend: bool,
) {
    for _ in 0..steps {
        d.move_cars(tower, 1.0, calls, HOUR, weekend);
    }
}

fn shaft(tower: &Tower) -> &Transport {
    &tower.transports[0]
}

fn near(p: f64, floor: i64, tolerance: f64) -> bool {
    (p - floor as f64).abs() < tolerance
}

#[test]
fn idle_cars_home_at_the_authored_floor_and_unscheduled_ones_at_the_lobby() {
    let homed = Schedule {
        home_floors: Some(vec![18, 18, 18]),
        ..blank()
    };
    let (mut tower, _) = scheduled(3, Some(homed));
    let (mut baseline, _) = scheduled(3, None);
    let none = ElevatorCalls::default();
    run(
        &mut ElevatorDispatch::new(),
        &mut tower,
        &none,
        200,
        WEEKDAY,
    );
    run(
        &mut ElevatorDispatch::new(),
        &mut baseline,
        &none,
        200,
        WEEKDAY,
    );
    let t = shaft(&tower);
    assert!(
        t.car_positions.iter().all(|&p| near(p, 18, 0.05)),
        "{:?}",
        t.car_positions
    );
    assert!(t.car_dir.iter().all(|&d| d == 0), "parked: {:?}", t.car_dir);
    let b = shaft(&baseline);
    assert!(
        b.car_positions.iter().all(|&p| near(p, b.bottom, 0.5)),
        "{:?}",
        b.car_positions
    );
}

#[test]
fn a_zero_active_hour_parks_the_fleet_without_stranding_its_floors() {
    let off = Schedule {
        weekday: flat(0),
        ..blank()
    };
    let (mut tower, id) = scheduled(3, Some(off));
    let calls = hall_calls(id, &[14]);
    run(
        &mut ElevatorDispatch::new(),
        &mut tower,
        &calls,
        300,
        WEEKDAY,
    );
    let t = shaft(&tower);
    assert!(
        t.car_positions.iter().all(|&p| p < 3.0),
        "{:?}",
        t.car_positions
    );
    assert!(t.car_dir.iter().all(|&d| d == 0));
    // The floor still counts as served for routing.
    assert!(tower.served_floors().contains(&14));
    // The same hour at a full fleet serves the call: the parking was the
    // schedule, not the tower.
    tower.transports[0].schedule = Some(Schedule {
        weekday: flat(3),
        ..blank()
    });
    let mut live = ElevatorDispatch::new();
    let mut served = false;
    for _ in 0..300 {
        live.move_cars(&mut tower, 1.0, &calls, HOUR, WEEKDAY);
        served = shaft(&tower)
            .car_positions
            .iter()
            .any(|&p| near(p, 14, 0.5));
        if served {
            break;
        }
    }
    assert!(served);
}

#[test]
fn a_weekday_runs_the_weekday_row_and_a_weekend_the_weekend_row() {
    let away = |weekend: bool| -> usize {
        let s = Schedule {
            weekday: flat(1),
            weekend: flat(3),
            home_floors: Some(vec![1, 1, 1]),
            ..blank()
        };
        let (mut tower, id) = scheduled(3, Some(s));
        let calls = hall_calls(id, &[8, 13, 18]);
        run(
            &mut ElevatorDispatch::new(),
            &mut tower,
            &calls,
            250,
            weekend,
        );
        shaft(&tower)
            .car_positions
            .iter()
            .filter(|&&p| p > 3.0)
            .count()
    };
    assert_eq!(away(WEEKDAY), 1, "one car on shift");
    assert!(away(WEEKEND) > 1, "the fuller weekend fleet spreads out");
}

#[test]
fn a_longer_standard_floor_departure_holds_a_car_longer() {
    let held = |departure: f64| -> usize {
        let s = Schedule {
            standard_floor_departure: Some(departure),
            ..blank()
        };
        let (mut tower, id) = scheduled(1, Some(s));
        let calls = hall_calls(id, &[6, 14]);
        let mut d = ElevatorDispatch::new();
        let mut held = 0;
        let mut prev = shaft(&tower).car_positions[0];
        for _ in 0..200 {
            d.move_cars(&mut tower, 1.0, &calls, HOUR, WEEKDAY);
            let pos = shaft(&tower).car_positions[0];
            let at_stop = near(pos, 6, 0.05) || near(pos, 14, 0.05);
            if at_stop && (pos - prev).abs() < 0.01 {
                held += 1;
            }
            prev = pos;
        }
        held
    };
    let (long, none) = (held(60.0), held(0.0));
    assert!(long > none, "{long} held steps against {none}");
}

/// Two cars homed at floor 10 and parked there, then a call at floor 2, in
/// a Modern tower, under the plain SCAN profile (`plain`) the reference
/// dispatcher pins or Modern's own rules. Classic reads the setting as the
/// 1994 game does: `rule_tests::classic_elevator_dispatch`.
fn reaches_a_far_call(response: Option<f64>, plain: bool) -> bool {
    let s = Schedule {
        home_floors: Some(vec![10, 10]),
        waiting_car_response: response,
        ..blank()
    };
    let (mut tower, id) = scheduled(2, Some(s));
    tower.mode = GameMode::Modern;
    let mut d = ElevatorDispatch::new();
    d.profile = plain.then(DispatchRules::plain_scan);
    run(&mut d, &mut tower, &ElevatorCalls::default(), 60, WEEKDAY);
    assert!(shaft(&tower)
        .car_positions
        .iter()
        .all(|&p| near(p, 10, 0.05)));
    let calls = hall_calls(id, &[2]);
    for _ in 0..200 {
        d.move_cars(&mut tower, 1.0, &calls, HOUR, WEEKDAY);
        if shaft(&tower).car_positions.iter().any(|&p| near(p, 2, 0.5)) {
            return true;
        }
    }
    false
}

#[test]
fn plain_scan_a_high_waiting_car_response_holds_parked_cars_from_a_far_call() {
    // Reach is span 19 less the response 15, so 4 floors: the call 8 away
    // waits; with no response set the call is answered.
    assert!(!reaches_a_far_call(Some(15.0), true));
    assert!(reaches_a_far_call(None, true));
}

#[test]
fn modern_answers_a_far_call_whatever_the_response() {
    // Modern retired the reach: the best car goes, response or not.
    assert!(reaches_a_far_call(Some(15.0), false));
    assert!(reaches_a_far_call(None, false));
}

#[test]
fn a_held_far_call_does_not_mask_a_near_call_the_other_way() {
    let s = Schedule {
        home_floors: Some(vec![10]),
        waiting_car_response: Some(15.0),
        ..blank()
    };
    let (mut tower, id) = scheduled(1, Some(s));
    // The reach exists only in the plain SCAN profile.
    let mut d = ElevatorDispatch::new();
    d.profile = Some(DispatchRules::plain_scan());
    run(&mut d, &mut tower, &ElevatorCalls::default(), 60, WEEKDAY);
    assert!(near(shaft(&tower).car_positions[0], 10, 0.05));
    // Floor 15 is 5 above (held); floor 8 is 2 below (in reach).
    let calls = hall_calls(id, &[15, 8]);
    let mut reached = false;
    for _ in 0..200 {
        d.move_cars(&mut tower, 1.0, &calls, HOUR, WEEKDAY);
        reached = near(shaft(&tower).car_positions[0], 8, 0.5);
        if reached {
            break;
        }
    }
    assert!(reached);
}

#[test]
fn a_home_above_the_shaft_clamps_to_the_top_and_the_car_parks() {
    let s = Schedule {
        home_floors: Some(vec![100]),
        ..blank()
    };
    let (mut tower, _) = scheduled(1, Some(s));
    run(
        &mut ElevatorDispatch::new(),
        &mut tower,
        &ElevatorCalls::default(),
        200,
        WEEKDAY,
    );
    let t = shaft(&tower);
    assert!(
        near(t.car_positions[0], t.top, 0.05),
        "{:?}",
        t.car_positions
    );
    assert_eq!(t.car_dir[0], 0);
}

#[test]
fn a_scheduled_tower_runs_the_same_every_time() {
    let once = || {
        let s = Schedule {
            weekday: flat(2),
            weekend: flat(1),
            home_floors: Some(vec![12, 12, 3]),
            waiting_car_response: Some(4.0),
            standard_floor_departure: Some(20.0),
        };
        let (mut tower, id) = scheduled(3, Some(s));
        let calls = hall_calls(id, &[6, 14, 18]);
        run(
            &mut ElevatorDispatch::new(),
            &mut tower,
            &calls,
            150,
            WEEKDAY,
        );
        let t = shaft(&tower);
        (
            t.car_positions
                .iter()
                .map(|p| p.to_bits())
                .collect::<Vec<_>>(),
            t.car_dir.clone(),
            t.car_load.clone(),
        )
    };
    assert_eq!(once(), once());
}
