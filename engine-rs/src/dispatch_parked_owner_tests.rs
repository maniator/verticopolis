//! A Modern car parked on a called stop owns the call (`BestCars`), so no
//! other car comes for it: it boards the statistical estimate there itself,
//! opening and dwelling as a car that arrives does. Classic keeps its sweep,
//! which only looks ahead of a parked car.

use crate::clock::GameMode;
use crate::crowd::ElevatorCalls;
use crate::dispatch::ElevatorDispatch;
use crate::facilities::Kind;
use crate::schedule::Schedule;
use crate::tower::Tower;

const TOP: i64 = 20;
const HOUR: i64 = 12;
const WEEKDAY: bool = false;
/// The estimate a test puts on a floor: well under a car's capacity.
const RIDERS: f64 = 5.0;

/// A standard elevator over floors 1 to `TOP` with `cars` cars, the homes
/// `homes` and `on_shift` cars on shift all day, idled until every car has
/// parked. Returns the tower, the shaft id and its dispatcher.
fn parked_shaft(
    mode: GameMode,
    cars: i64,
    homes: Option<Vec<i64>>,
    on_shift: Option<i64>,
) -> (Tower, i64, ElevatorDispatch) {
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
    let id = tower
        .place_transport(Kind::ElevatorStandard, 4, 1, TOP)
        .unit_id
        .expect("the shaft is placed");
    tower.set_cars(id, cars);
    tower.transports[0].schedule = Some(Schedule {
        weekday: on_shift.map(|n| vec![n; 24]),
        weekend: None,
        waiting_car_response: None,
        standard_floor_departure: None,
        home_floors: homes,
        held_back: None,
    });
    let mut d = ElevatorDispatch::new();
    for _ in 0..200 {
        step(&mut d, &mut tower, &ElevatorCalls::default());
    }
    let t = &tower.transports[0];
    assert!(t.car_dir.iter().all(|&x| x == 0), "parked: {:?}", t.car_dir);
    (tower, id, d)
}

fn step(d: &mut ElevatorDispatch, tower: &mut Tower, calls: &ElevatorCalls) {
    d.move_cars(tower, 1.0, calls, HOUR, WEEKDAY);
}

fn at(tower: &Tower, car: usize) -> f64 {
    tower.transports[0].car_positions[car]
}

/// Puts `RIDERS` on `floor` and runs `steps` one-minute steps with no crowd.
/// Returns the estimate left there.
fn estimate_left_after(
    d: &mut ElevatorDispatch,
    tower: &mut Tower,
    floor: i64,
    steps: usize,
) -> f64 {
    d.waiting.insert(floor, RIDERS);
    for _ in 0..steps {
        step(d, tower, &ElevatorCalls::default());
    }
    d.waiting_at(floor)
}

#[test]
fn a_modern_car_parked_at_its_spread_stop_boards_the_estimate_there() {
    // Two cars with no homes: car 0 at the lobby, car 1 spread to floor 11.
    let (mut tower, id, mut d) = parked_shaft(GameMode::Modern, 2, None, None);
    assert_eq!((at(&tower, 0), at(&tower, 1)), (1.0, 11.0));
    let rides = tower.transports[0].rides;
    assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 1), 0.0);
    let t = &tower.transports[0];
    // It boarded where it stands, with its doors open for a dwell, and
    // counted the ride, the load and the origin tally.
    assert_eq!(t.rides, rides + 1);
    assert_eq!(t.car_load.as_ref().unwrap()[1], RIDERS);
    assert!(d.car_dwell[&id][1] > 0.0);
    assert!(d.open_cars().contains(&(id, 1, 11)));
    assert_eq!(d.drain_boardings()[&id][&11], RIDERS);
    // The lobby car stayed home.
    assert_eq!(at(&tower, 0), 1.0);
}

#[test]
fn a_modern_car_parked_at_its_own_home_boards_the_estimate_there() {
    let homes = Some(vec![1, 11]);
    let (mut tower, _, mut d) = parked_shaft(GameMode::Modern, 2, homes, None);
    assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 1), 0.0);
    assert_eq!(at(&tower, 0), 1.0);
    // Left alone for a while it settles back on its home.
    assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 40), 0.0);
    assert_eq!(tower.transports[0].car_dir[1], 0);
    assert_eq!(at(&tower, 1), 11.0);
}

#[test]
fn classic_sends_the_lobby_car_as_before() {
    for homes in [None, Some(vec![1, 11])] {
        let (mut tower, _, mut d) = parked_shaft(GameMode::Classic, 2, homes, None);
        // Nothing boards in the first step: car 0 leaves the lobby for it
        // and car 1 stays parked.
        assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 1), RIDERS);
        assert!(at(&tower, 0) > 1.0);
        assert_eq!(tower.transports[0].car_dir[1], 0);
        // The lobby car gets there and takes them.
        assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 40), 0.0);
    }
}

#[test]
fn a_lone_modern_car_boards_the_estimate_on_its_floor() {
    // One car: the owner is the only car on shift.
    let (mut tower, _, mut d) = parked_shaft(GameMode::Modern, 1, Some(vec![11]), None);
    assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 1), 0.0);
    // Classic's sweep never looks behind a parked car, so its lone car
    // leaves the estimate on its own floor as it always has.
    let (mut tower, _, mut d) = parked_shaft(GameMode::Classic, 1, Some(vec![11]), None);
    assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 40), RIDERS);
}

#[test]
fn the_modern_lobby_car_boards_the_lobby_estimate() {
    let (mut tower, id, mut d) = parked_shaft(GameMode::Modern, 2, None, None);
    assert_eq!(estimate_left_after(&mut d, &mut tower, 1, 1), 0.0);
    assert_eq!(tower.transports[0].car_load.as_ref().unwrap()[0], RIDERS);
    assert!(d.open_cars().contains(&(id, 0, 1)));
    // The car spread to floor 11 is not sent down for it.
    assert_eq!(at(&tower, 1), 11.0);
}

#[test]
fn a_stood_down_car_on_the_floor_boards_nobody_and_an_on_shift_car_comes() {
    // Only car 0 is on shift; car 1 is stood down and parked at its home 11.
    let homes = Some(vec![1, 11]);
    let (mut tower, id, mut d) = parked_shaft(GameMode::Modern, 2, homes, Some(1));
    assert_eq!(at(&tower, 1), 11.0);
    assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 1), RIDERS);
    assert!(at(&tower, 0) > 1.0, "the on-shift car answers");
    assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 40), 0.0);
    let t = &tower.transports[0];
    assert_eq!(t.car_load.as_ref().unwrap()[1], 0.0);
    assert!(d.closed_cars().contains(&(id, 1)));
}

#[test]
fn a_car_dwelling_at_the_floor_takes_the_estimate_as_an_arrival() {
    // Car 1 is not parked: it has just arrived at 11 going up and dwells.
    let (mut tower, id, mut d) = parked_shaft(GameMode::Modern, 2, None, None);
    tower.transports[0].car_dir[1] = 1;
    d.car_dwell.get_mut(&id).unwrap()[1] = 0.8;
    let rides = tower.transports[0].rides;
    assert_eq!(estimate_left_after(&mut d, &mut tower, 11, 1), 0.0);
    // Standard Floor Departure's arrivals board them: no new ride, and the
    // lobby car stays home.
    assert_eq!(tower.transports[0].rides, rides);
    assert_eq!(d.drain_boardings()[&id][&11], RIDERS);
    assert_eq!(at(&tower, 0), 1.0);
}

#[test]
fn a_crowd_call_alone_leaves_the_parked_car_open_without_a_dwell() {
    // The crowd boards an open parked car itself, so a call with no
    // estimate behind it changes nothing: no dwell, no ride, no load.
    let (mut tower, id, mut d) = parked_shaft(GameMode::Modern, 2, None, None);
    let rides = tower.transports[0].rides;
    let mut calls = ElevatorCalls::default();
    calls.hall.insert(id, [(11, 1.0)].into_iter().collect());
    step(&mut d, &mut tower, &calls);
    let t = &tower.transports[0];
    assert_eq!((t.car_dir[1], t.rides), (0, rides));
    assert_eq!(d.car_dwell[&id][1], 0.0);
    assert!(d.open_cars().contains(&(id, 1, 11)));
    assert_eq!(at(&tower, 0), 1.0);
}

#[test]
fn a_car_coming_within_the_response_keeps_the_call_over_a_parked_one() {
    // Car 1 is parked at 11; car 0 is heading up from floor 8 with a rider
    // for the top. Within a response of 4 the coming car owns the call, so
    // the parked car leaves the estimate to it.
    let homes = Some(vec![1, 11]);
    let (mut tower, id, mut d) = parked_shaft(GameMode::Modern, 2, homes, None);
    let t = &mut tower.transports[0];
    t.schedule.as_mut().unwrap().waiting_car_response = Some(4.0);
    (t.car_positions[0], t.car_dir[0]) = (8.0, 1);
    let mut calls = ElevatorCalls::default();
    calls
        .cab
        .insert(id, [(0, [TOP].into_iter().collect())].into_iter().collect());
    d.waiting.insert(11, RIDERS);
    step(&mut d, &mut tower, &calls);
    assert_eq!(d.waiting_at(11), RIDERS);
    assert_eq!(tower.transports[0].car_dir[1], 0);
    // Car 0 arrives within a few steps and boards them.
    for _ in 0..4 {
        step(&mut d, &mut tower, &calls);
    }
    assert_eq!(d.waiting_at(11), 0.0);
    assert_eq!(tower.transports[0].car_load.as_ref().unwrap()[1], 0.0);
}
