//! A service car's riders are the crowd's own callers, who count in the
//! origin tally as they step aboard (`Crowd::elevator_boardings`), so the
//! dispatch tallies none of them (#477). Before, a service car that came
//! back to a staff call nobody answered tallied the same callers again on
//! every arrival, and a passenger car's estimate tally is unchanged.

use crate::crowd::ElevatorCalls;
use crate::dispatch::ElevatorDispatch;
use crate::facilities::Kind;
use crate::tower::Tower;

const TOP: i64 = 6;
const STAFF_FLOOR: i64 = 4;
const HOUR: i64 = 12;
const WEEKDAY: bool = false;

/// A lobby and floors to `TOP` with one elevator of `kind` over them.
fn one_shaft(kind: Kind) -> (Tower, i64) {
    let mut tower = Tower::new();
    for x in 0..40 {
        assert!(tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=TOP {
        for x in 0..40 {
            assert!(tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = tower
        .place_transport(kind, 4, 1, TOP)
        .unit_id
        .expect("the shaft is placed");
    (tower, id)
}

/// Runs one-minute steps with `calls` standing the whole time, as a staff
/// call does when the crowd's callers never step aboard.
fn run(d: &mut ElevatorDispatch, tower: &mut Tower, calls: &ElevatorCalls, steps: usize) {
    for _ in 0..steps {
        d.move_cars(tower, 1.0, calls, HOUR, WEEKDAY);
    }
}

#[test]
fn a_service_car_tallies_none_of_the_staff_it_answers() {
    let (mut tower, id) = one_shaft(Kind::ElevatorService);
    let mut calls = ElevatorCalls::default();
    calls
        .hall
        .get_or_insert_with(id, Default::default)
        .insert(STAFF_FLOOR, 3.0.into());
    let mut d = ElevatorDispatch::new();
    run(&mut d, &mut tower, &calls, 60);
    let t = &tower.transports[0];
    // The car answered the call: it carried load and counted rides.
    assert!(t.rides > 0, "the service car never stopped for the call");
    assert!(
        d.drain_boardings().get(&id).is_none_or(|m| m.is_empty()),
        "the dispatch tallied the crowd's staff callers"
    );
}

#[test]
fn a_passenger_car_still_tallies_the_estimate_it_boards() {
    let (mut tower, id) = one_shaft(Kind::ElevatorStandard);
    let mut d = ElevatorDispatch::new();
    d.waiting.insert(STAFF_FLOOR, 5.0);
    run(&mut d, &mut tower, &ElevatorCalls::default(), 30);
    assert_eq!(d.drain_boardings()[&id][&STAFF_FLOOR], 5.0);
}
