//! The estimate seats (#2397): the estimate's part of each car's notional
//! load, which the busy meter reads beside the crowd's own riders so that
//! everyone aboard counts once. The cars move exactly as before; these
//! tests read only the seats and what the meter makes of them.

use serde_json::json;

use super::{share, Cars};
use crate::clock::GameMode;
use crate::crowd::{Crowd, ElevatorCalls};
use crate::dispatch::ElevatorDispatch;
use crate::facilities::Kind;
use crate::tower::Tower;

const TOP: i64 = 20;
const FLOOR: i64 = 11;
/// The estimate a test puts on a floor: well under a car's capacity.
const RIDERS: f64 = 5.0;

/// An elevator of `kind` over floors 1 to `TOP` with two cars, idled in
/// Modern until both have parked. Returns the tower, the shaft id and its
/// dispatcher.
fn parked(kind: Kind) -> (Tower, i64, ElevatorDispatch) {
    let mut tower = Tower::new();
    tower.mode = GameMode::Modern;
    for x in 0..40 {
        assert!(tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=TOP {
        for x in 0..40 {
            assert!(tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = tower.place_transport(kind, 4, 1, TOP).unit_id.unwrap();
    tower.set_cars(id, 2);
    let mut d = ElevatorDispatch::new();
    for _ in 0..200 {
        step(&mut d, &mut tower, &ElevatorCalls::default());
    }
    assert!(tower.transports[0].car_dir.iter().all(|&x| x == 0));
    (tower, id, d)
}

fn step(d: &mut ElevatorDispatch, tower: &mut Tower, calls: &ElevatorCalls) {
    d.move_cars(tower, 1.0, calls, 12, false);
}

/// Car 1 standing at `FLOOR` with its doors open and its wait running, as a
/// car that has just arrived going up, having seen no crowd caller there.
fn dwelling_at_the_floor(tower: &mut Tower, id: i64, d: &mut ElevatorDispatch) {
    let t = &mut tower.transports[0];
    (t.car_positions[1], t.car_dir[1]) = (FLOOR as f64, 1);
    d.car_dwell.get_mut(&id).unwrap()[1] = 0.8;
    d.cars.get_mut(&id).unwrap().seen[1] = 0.0;
}

/// `callers` of the crowd waiting at `FLOOR`, and a rider already in car 1
/// bound for the top, so the car leaves once its doors close instead of
/// parking (a parked car empties its load).
fn crowd_calls(id: i64, callers: f64) -> ElevatorCalls {
    let mut calls = ElevatorCalls::default();
    let hall = [(FLOOR, callers.into())].into_iter().collect();
    calls.hall.insert(id, hall);
    let cab = [(1, [TOP].into_iter().collect())].into_iter().collect();
    calls.cab.insert(id, cab);
    calls
}

fn load(tower: &Tower, car: usize) -> f64 {
    tower.transports[0].car_load.as_ref().unwrap()[car]
}

#[test]
fn a_dwelling_car_seats_the_estimate_and_leaves_the_crowd_newcomers_to_the_crowd() {
    let (mut tower, id, mut d) = parked(Kind::ElevatorStandard);
    dwelling_at_the_floor(&mut tower, id, &mut d);
    d.waiting.insert(FLOOR, RIDERS);
    step(&mut d, &mut tower, &crowd_calls(id, 3.0));
    // Standard Floor Departure boards both: the car's load holds all eight,
    // as it always has, and its seats only the estimate's five.
    assert_eq!(load(&tower, 1), RIDERS + 3.0);
    assert_eq!(d.estimate_seats(id).unwrap()[1], RIDERS);
    // The three callers step aboard as people; the meter counts each once.
    let mut crowd = Crowd::new(1);
    crowd.car_riders.insert((id, 1), 3);
    let aboard = d.riders_aboard(&tower.transports[0], &crowd);
    assert_eq!(aboard, RIDERS + 3.0, "each of the eight counted once");
}

#[test]
fn a_car_sold_and_bought_back_between_steps_gives_up_its_seats() {
    let (mut tower, id, mut d) = parked(Kind::ElevatorStandard);
    dwelling_at_the_floor(&mut tower, id, &mut d);
    d.waiting.insert(FLOOR, RIDERS);
    step(&mut d, &mut tower, &crowd_calls(id, 0.0));
    assert_eq!(d.estimate_seats(id).unwrap()[1], RIDERS);
    // Paused, the player sells the loaded car and buys it back: the shaft
    // keeps two cars and the new one comes empty.
    tower.set_cars(id, 1);
    tower.set_cars(id, 2);
    assert_eq!(load(&tower, 1), 0.0);
    dwelling_at_the_floor(&mut tower, id, &mut d);
    step(&mut d, &mut tower, &crowd_calls(id, 3.0));
    assert_eq!(load(&tower, 1), 3.0, "only the crowd's newcomers board");
    assert_eq!(d.estimate_seats(id).unwrap()[1], 0.0);
    let mut crowd = Crowd::new(1);
    crowd.car_riders.insert((id, 1), 3);
    assert_eq!(d.riders_aboard(&tower.transports[0], &crowd), 3.0);
}

#[test]
fn a_staff_car_seats_nobody_for_the_estimate() {
    let (mut tower, id, mut d) = parked(Kind::ElevatorService);
    dwelling_at_the_floor(&mut tower, id, &mut d);
    step(&mut d, &mut tower, &crowd_calls(id, 4.0));
    assert_eq!(load(&tower, 1), 4.0, "the staff callers fill the load");
    assert_eq!(d.estimate_seats(id).unwrap(), &[0.0, 0.0]);
    let mut crowd = Crowd::new(1);
    crowd.car_riders.insert((id, 1), 4);
    assert_eq!(d.riders_aboard(&tower.transports[0], &crowd), 4.0);
}

#[test]
fn a_car_that_answers_the_estimate_seats_everyone_it_boards() {
    let (mut tower, id, mut d) = parked(Kind::ElevatorStandard);
    d.waiting.insert(FLOOR, RIDERS);
    for _ in 0..40 {
        step(&mut d, &mut tower, &ElevatorCalls::default());
        if d.waiting_at(FLOOR) == 0.0 {
            break;
        }
    }
    assert_eq!(d.waiting_at(FLOOR), 0.0, "a car came and boarded them");
    let seats = d.estimate_seats(id).unwrap();
    let loads = tower.transports[0].car_load.as_ref().unwrap();
    assert_eq!(seats, loads.as_slice(), "the whole load is the estimate's");
    let aboard = d.riders_aboard(&tower.transports[0], &Crowd::new(1));
    assert_eq!(aboard, loads.iter().sum::<f64>());
}

#[test]
fn seats_keep_their_share_of_the_load_as_riders_leave_at_a_stop() {
    assert_eq!(share(5.0, 8.0, 4.0), 2.5);
    assert_eq!(
        share(8.0, 8.0, 4.0),
        4.0,
        "an estimate-only car keeps it all"
    );
    assert_eq!(share(0.0, 8.0, 4.0), 0.0);
    assert_eq!(share(3.0, 0.0, 0.0), 0.0, "an empty car seats nobody");
    assert_eq!(share(9.0, 8.0, 4.0), 4.0, "never more than the load");
}

#[test]
fn a_car_that_parks_empties_its_seats() {
    let (mut tower, id, mut d) = parked(Kind::ElevatorStandard);
    d.waiting.insert(FLOOR, RIDERS);
    for _ in 0..40 {
        step(&mut d, &mut tower, &ElevatorCalls::default());
    }
    for _ in 0..200 {
        step(&mut d, &mut tower, &ElevatorCalls::default());
    }
    assert!(tower.transports[0].car_dir.iter().all(|&x| x == 0));
    assert_eq!(d.estimate_seats(id).unwrap(), &[0.0, 0.0]);
}

#[test]
fn a_shaft_that_gains_or_loses_a_car_keeps_the_seats_of_the_cars_it_keeps() {
    // `Tower::set_cars` keeps the kept cars' loads and starts a new car
    // empty; the seats follow the load's length the same way.
    let mut seats = Some(vec![2.0, 1.0]);
    let grown = Cars::seats(&mut seats, &[2.0, 3.0, 0.0], false).to_vec();
    assert_eq!(grown, vec![2.0, 1.0, 0.0]);
    assert_eq!(Cars::seats(&mut seats, &[2.0], false), &[2.0]);
}

#[test]
fn a_car_the_schedule_stands_down_empty_gives_up_its_seats() {
    let (mut tower, id, mut d) = parked(Kind::ElevatorStandard);
    tower.transports[0].car_load = Some(vec![0.0, 3.0]);
    d.cars.get_mut(&id).unwrap().seats = Some(vec![0.0, 3.0]);
    let t = &mut tower.transports[0];
    t.schedule = Some(crate::schedule::Schedule {
        weekday: Some(vec![1; 24]),
        weekend: None,
        waiting_car_response: None,
        standard_floor_departure: None,
        home_floors: None,
        held_back: None,
        auto_tune: false,
    });
    step(&mut d, &mut tower, &ElevatorCalls::default());
    assert!(d.closed_cars().contains(&(id, 1)));
    assert_eq!(load(&tower, 1), 0.0);
    assert_eq!(d.estimate_seats(id).unwrap()[1], 0.0);
}

#[test]
fn the_meter_never_reads_more_estimate_seats_than_a_cars_load() {
    let (tower, id, mut d) = parked(Kind::ElevatorStandard);
    // Seats left over while the shaft's load starts again from empty.
    d.cars.get_mut(&id).unwrap().seats = Some(vec![4.0, 2.0]);
    assert_eq!(d.riders_aboard(&tower.transports[0], &Crowd::new(1)), 0.0);
}

#[test]
fn a_car_the_seats_do_not_list_yet_seats_nobody_for_the_estimate() {
    let (mut tower, id, mut d) = parked(Kind::ElevatorStandard);
    // Seats known for car 0 only, as for a car the shaft just gained: the
    // meter counts none for car 1, as the cars' next move starts it empty.
    tower.transports[0].car_load = Some(vec![1.0, 5.0]);
    d.cars.get_mut(&id).unwrap().seats = Some(vec![1.0]);
    assert_eq!(d.riders_aboard(&tower.transports[0], &Crowd::new(1)), 1.0);
}

#[test]
fn a_shaft_first_seen_takes_a_passenger_cars_load_and_a_staff_cars_none() {
    assert_eq!(Cars::seats(&mut None, &[4.0, 1.0], false), &[4.0, 1.0]);
    assert_eq!(Cars::seats(&mut None, &[4.0, 1.0], true), &[0.0, 0.0]);
}

#[test]
fn a_save_keeps_the_seats_and_one_from_before_them_still_loads() {
    let (mut tower, id, mut d) = parked(Kind::ElevatorStandard);
    dwelling_at_the_floor(&mut tower, id, &mut d);
    d.waiting.insert(FLOOR, RIDERS);
    step(&mut d, &mut tower, &crowd_calls(id, 3.0));
    let saved = d.save_json();
    let mut back = ElevatorDispatch::new();
    back.restore(&saved, &tower);
    assert_eq!(back.estimate_seats(id), d.estimate_seats(id));
    // A save from before the seats were kept: the cars' timers load, and
    // the seats wait for the cars' first move to take them from the load.
    let mut old = saved.clone();
    old["cars"][0]
        .as_object_mut()
        .unwrap()
        .remove("estimateSeats");
    let mut before = ElevatorDispatch::new();
    before.restore(&old, &tower);
    assert_eq!(before.car_dwell.get(&id), d.car_dwell.get(&id));
    assert_eq!(before.estimate_seats(id), None);
}

#[test]
fn a_saved_seat_never_outnumbers_its_cars_load() {
    let (tower, id, _) = parked(Kind::ElevatorStandard);
    let cars = json!([{
        "shaftId": id,
        "dwell": [0.0, 0.0],
        "seen": [0.0, 0.0],
        "held": [0.0, 0.0],
        "estimateSeats": [30.0, -2.0],
    }]);
    let mut d = ElevatorDispatch::new();
    d.restore(&json!({ "cars": cars }), &tower);
    // The parked cars carry nothing, so neither seat survives.
    assert_eq!(d.estimate_seats(id), Some(&[0.0, 0.0][..]));
}
