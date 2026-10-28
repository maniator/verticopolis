use super::*;
use crate::clock::GameMode;
use crate::crowd::{PState, Person, STRESS_WAIT};
use crate::facilities::{Kind, FACILITIES};
use crate::sim::Simulation;

fn code(kind: Kind) -> f64 {
    FACILITIES.iter().position(|f| f.kind == kind).unwrap() as f64
}

/// A lobby and three floors over x 150..230, an office, a standard
/// elevator over floors 1 to 4 that skips floor 3, a service elevator and
/// stairs.
fn built() -> Engine {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    e.sim.star = 2;
    for x in 150..230 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=4 {
            assert!(e.sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    assert!(e.sim.tower.place(Kind::Office, 2, 160).ok);
    for (kind, x, top) in [
        (Kind::ElevatorStandard, 155.0, 4.0),
        (Kind::ElevatorService, 190.0, 4.0),
        (Kind::Stairs, 210.0, 2.0),
    ] {
        let r = e.port_build_shaft(code(kind), x, 1.0, top);
        assert_eq!(r[0], 1.0, "{kind:?}: {:?}", e.last_reason_text());
    }
    let lift = shaft(&e, Kind::ElevatorStandard);
    assert_eq!(e.port_mark_stop(lift as f64, 3.0, false)[0], 1.0);
    e
}

fn shaft(e: &Engine, kind: Kind) -> i64 {
    e.sim
        .tower
        .transports
        .iter()
        .find(|t| t.kind == kind)
        .unwrap()
        .id
}

fn waiter(id: i64, shaft: i64, floor: i64, wait: f64, staff: bool) -> Person {
    Person {
        id,
        seed: 0,
        state: PState::Waiting,
        floor,
        fy: floor as f64,
        x: 0.0,
        floors: vec![floor],
        origin_floor: floor,
        shafts: vec![shaft],
        leg: 0,
        shaft_id: Some(shaft),
        car_index: None,
        dest_x: 0.0,
        wait,
        trip_wait: 0.0,
        age: 0.0,
        linger: 0.0,
        staff,
        clean_unit_id: None,
        meal_venue_id: None,
        venue_unit_id: None,
        counted_hotel_guest: false,
        origin_unit_id: None,
        dwell_seconds_left: None,
        returning: false,
        routine: None,
        linger_for: None,
    }
}

#[test]
fn the_queue_view_counts_each_landing_and_car() {
    let mut e = built();
    let lift = shaft(&e, Kind::ElevatorStandard);
    let service = shaft(&e, Kind::ElevatorService);
    let stairs = shaft(&e, Kind::Stairs);
    e.sim.crowd.people = vec![
        waiter(1, lift, 2, 5.0, false),
        waiter(2, lift, 2, STRESS_WAIT, false),
        waiter(3, lift, 1, STRESS_WAIT / 2.0, false),
        // A skipped floor, a tenant at the staff shaft and a stair leg queue
        // nowhere.
        waiter(4, lift, 3, 0.0, false),
        waiter(5, service, 2, 0.0, false),
        waiter(6, stairs, 1, 0.0, false),
        waiter(7, service, 4, 0.0, true),
    ];
    e.sim.crowd.car_riders.insert((lift, 0), 3);
    let cars_of = |kind| e.sim.tower.get_transport(shaft(&e, kind)).unwrap().cars;
    let (lift_cars, service_cars) = (
        cars_of(Kind::ElevatorStandard),
        cars_of(Kind::ElevatorService),
    );
    let r = e.port_queue_view();
    let mut want = vec![3.0, (lift_cars + service_cars) as f64];
    want.extend_from_slice(&[lift as f64, 2.0, 2.0, 2.0]);
    want.extend_from_slice(&[lift as f64, 1.0, 1.0, 1.0]);
    want.extend_from_slice(&[service as f64, 4.0, 1.0, 0.0]);
    for i in 0..lift_cars {
        want.extend_from_slice(&[lift as f64, i as f64, if i == 0 { 3.0 } else { 0.0 }]);
    }
    for i in 0..service_cars {
        want.extend_from_slice(&[service as f64, i as f64, 0.0]);
    }
    assert_eq!(r, want);
}

#[test]
fn the_queue_view_is_kept_until_the_crowd_steps() {
    let mut e = built();
    let lift = shaft(&e, Kind::ElevatorStandard);
    e.sim.crowd.people = vec![waiter(1, lift, 2, 0.0, false)];
    let first = e.port_queue_view();
    assert_eq!(first[0], 1.0);
    // The same step and revision answer the kept record, as the crowd's own
    // projection does.
    e.sim.crowd.people.clear();
    assert_eq!(e.port_queue_view(), first);
    e.sim.crowd.step += 1;
    assert_eq!(e.port_queue_view()[0], 0.0);
}

#[test]
fn the_fills_and_the_parking_set_read_the_simulation() {
    let mut e = built();
    assert_eq!(e.port_congestion().to_bits(), e.sim.congestion().to_bits());
    assert_eq!(e.port_recycling_fill(), e.sim.recycling_fill());
    assert_eq!(e.port_parking_set(), vec![0.0]);
    for spots in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(e.port_parking_usage(spots), 0.0, "{spots}");
    }
    e.sim.star = 3;
    assert_eq!(e.port_parking_usage(4.0), e.sim.parking_usage(4.0));
}

#[test]
fn reachability_takes_whole_tiles() {
    let mut e = built();
    assert!(e.port_position_reachable(1.0, 160.0));
    assert_eq!(
        e.port_position_reachable(2.0, 160.0),
        e.sim.position_reachable(2, 160)
    );
    for (floor, x) in [(1.5, 160.0), (2.0, f64::NAN), (f64::INFINITY, 160.0)] {
        assert!(!e.port_position_reachable(floor, x), "{floor} {x}");
    }
}
