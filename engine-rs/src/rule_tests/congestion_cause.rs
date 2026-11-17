//! The transports behind a floor's congestion reading
//! (`Simulation::congestion_cause`): what the Traffic readout points at when
//! the player taps it. The shaft with the highest estimate, or every
//! passenger elevator on the floor when the floor's real commute wait sets
//! the reading.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{lay_row, put, seat, MID as C};

/// A lobby and floors 2 and 3 with an occupied office on floor 2.
fn office_on_two() -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=3 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    let office = put(&mut sim, Kind::Office, 2, C - 30);
    seat(&mut sim, office, UnitState::Occupied, 1.0);
    sim
}

fn shaft(sim: &mut Simulation, kind: Kind, x: i64, bottom: i64, top: i64) -> i64 {
    let r = sim.build_transport(kind, x, bottom, top);
    assert!(r.ok, "{kind:?} at {x}: {:?}", r.reason);
    sim.tower.transports.last().unwrap().id
}

#[test]
fn the_transport_with_the_highest_estimate_is_the_cause() {
    let mut sim = office_on_two();
    let lift = shaft(&mut sim, Kind::ElevatorStandard, C + 20, 1, 2);
    assert_eq!(sim.congestion_cause(2), vec![lift], "the elevator alone");
    shaft(&mut sim, Kind::Stairs, C, 1, 2);
    let upper = shaft(&mut sim, Kind::Stairs, C, 2, 3);
    // Floor 3's offices load only the upper flight, which floor 2 shares,
    // so that flight reads highest on floor 2 and is the one pointed at.
    for x in [C - 30, C - 21, C - 12] {
        let id = put(&mut sim, Kind::Office, 3, x);
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    assert_eq!(sim.congestion_cause(2), vec![upper]);
}

#[test]
fn transports_tied_for_the_highest_estimate_are_all_the_cause() {
    // With floor 2 the only one loaded, every transport there carries the
    // same share of it by capacity, so their readings tie.
    let mut sim = office_on_two();
    let stairs = shaft(&mut sim, Kind::Stairs, C, 1, 2);
    let lift = shaft(&mut sim, Kind::ElevatorStandard, C + 20, 1, 3);
    assert_eq!(sim.congestion_cause(2), vec![stairs, lift]);
}

#[test]
fn a_real_wait_points_at_every_elevator_on_the_floor_and_not_the_stairs() {
    let mut sim = office_on_two();
    shaft(&mut sim, Kind::Stairs, C, 1, 2);
    let first = shaft(&mut sim, Kind::ElevatorStandard, C + 20, 1, 3);
    let second = shaft(&mut sim, Kind::ElevatorStandard, C + 30, 1, 2);
    let above = shaft(&mut sim, Kind::ElevatorStandard, C + 40, 1, 3);
    assert!(sim.tower.set_stop(above, 2, false));
    sim.crowd.commute_wait_by_floor.insert(2, 10_000.0);
    assert_eq!(sim.congestion_cause(2), vec![first, second]);
}

#[test]
fn a_floor_with_no_reading_has_no_cause() {
    let mut sim = office_on_two();
    shaft(&mut sim, Kind::ElevatorStandard, C + 20, 1, 3);
    assert!(sim.congestion_cause(3).is_empty(), "nobody on floor 3");
    assert!(sim.congestion_cause(40).is_empty(), "off the tower");
}
