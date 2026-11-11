//! The congestion gripe names the transport that is really crowded (#699)
//! and the shaft that binds the floor's reading (#701). The engine answers
//! with the binding class and whether a passenger elevator stops on the
//! floor; `src/ui/tenantDiagnosticCopy.ts` turns those two facts into the
//! words ("crowded stairs", "add cars", "jammed by the other floors").
//! Already pinned: a stairs-only floor, the cross-loaded stair link and the
//! transportless fallback by
//! `churn::tests::the_congestion_note_names_the_binding_transport`; the
//! walkway and escalator classes on a skipped stop by
//! `diagnostics::tenant_tests::walkway_bindings_name_their_class_and_the_elevator_stop`.
//! This file holds the skip seam turning back, the service elevator, the
//! tie that keeps the elevator, and the escalator and walkway binders beside
//! an elevator.
use crate::churn::CongestionBindingClass as Binding;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{lay_row, put, seat, MID as C};

/// The serving-kinds flag the copy branches on for a walkway binder.
fn elevator_stops(sim: &Simulation, floor: i64) -> bool {
    sim.serving_transport_kinds_at(floor).0
}

/// A lobby and floors 2..=top with an occupied office on floor 2 and no
/// transport yet.
fn bare_office(seed: u32, mode: GameMode, top: i64) -> Simulation {
    let mut sim = Simulation::new_game(seed, mode);
    sim.money = 1e9;
    sim.star = 3;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=top {
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

/// Occupied offices on floor 3, loading the walkway chain that continues
/// up from floor 2.
fn populate_floor_3(sim: &mut Simulation, xs: [i64; 3]) {
    for x in xs {
        let id = put(sim, Kind::Office, 3, x);
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
}

#[test]
fn an_elevator_that_skips_the_floor_does_not_count_until_it_stops_again() {
    let mut sim = bare_office(3, GameMode::Classic, 3);
    shaft(&mut sim, Kind::Stairs, C, 1, 2);
    let lift = shaft(&mut sim, Kind::ElevatorStandard, C + 20, 1, 3);
    assert_eq!(sim.binding_transport_class_at(2), Binding::Elevator);
    assert!(sim.tower.set_stop(lift, 2, false));
    assert_eq!(sim.binding_transport_class_at(2), Binding::Stairs);
    assert!(!elevator_stops(&sim, 2));
    assert!(sim.tower.set_stop(lift, 2, true));
    assert_eq!(sim.binding_transport_class_at(2), Binding::Elevator);
}

#[test]
fn a_staff_only_service_elevator_does_not_turn_the_stairs_into_elevators() {
    let mut sim = bare_office(4, GameMode::Classic, 2);
    shaft(&mut sim, Kind::Stairs, C, 1, 2);
    shaft(&mut sim, Kind::ElevatorService, C + 20, 1, 2);
    assert_eq!(sim.binding_transport_class_at(2), Binding::Stairs);
    assert!(!elevator_stops(&sim, 2));
}

#[test]
fn escalators_alone_and_beside_stairs_name_their_own_class() {
    // Modern, since Classic refuses escalators on office floors.
    let mut sim = bare_office(5, GameMode::Modern, 2);
    shaft(&mut sim, Kind::Escalator, C, 1, 2);
    assert_eq!(sim.binding_transport_class_at(2), Binding::Escalator);
    shaft(&mut sim, Kind::Stairs, C + 20, 1, 2);
    assert_eq!(sim.binding_transport_class_at(2), Binding::Walkways);
}

#[test]
fn a_tie_between_the_stairs_and_the_elevator_keeps_the_elevator() {
    // The cross-loaded layout with floor 3 empty: every shaft on floor 2
    // carries only floor 2's share, so the ratios tie.
    let mut sim = bare_office(8, GameMode::Classic, 3);
    shaft(&mut sim, Kind::ElevatorStandard, C + 20, 1, 2);
    shaft(&mut sim, Kind::Stairs, C, 1, 2);
    shaft(&mut sim, Kind::Stairs, C, 2, 3);
    let att = sim.spatial_congestion_attribution_by_floor()[&2];
    assert!(att.elevator > 0.0, "the attribution is present");
    assert!((att.stairs.max(att.escalator) - att.elevator).abs() <= 1e-9);
    assert_eq!(sim.binding_transport_class_at(2), Binding::Elevator);
    // The same layout with floor 3 populated binds on the stairs by a wide
    // margin, so the tie above is the only thing keeping the elevator.
    populate_floor_3(&mut sim, [C - 30, C - 21, C - 12]);
    let att = sim.spatial_congestion_attribution_by_floor()[&2];
    assert!(att.stairs > att.elevator + 1e-3);
    assert_eq!(sim.binding_transport_class_at(2), Binding::Stairs);
    assert!(
        elevator_stops(&sim, 2),
        "the jammed-by-other-floors wording"
    );
}

#[test]
fn a_cross_loaded_escalator_chain_binds_beside_an_elevator() {
    let mut sim = bare_office(9, GameMode::Modern, 3);
    shaft(&mut sim, Kind::ElevatorStandard, C + 20, 1, 2);
    shaft(&mut sim, Kind::Escalator, C, 1, 2);
    shaft(&mut sim, Kind::Escalator, C, 2, 3);
    populate_floor_3(&mut sim, [C - 30, C - 21, C - 12]);
    assert_eq!(sim.binding_transport_class_at(2), Binding::Escalator);
    assert!(elevator_stops(&sim, 2));
}

#[test]
fn tied_stair_and_escalator_chains_bind_together_beside_an_elevator() {
    let mut sim = Simulation::new_game(10, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 3;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=3 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    shaft(&mut sim, Kind::ElevatorStandard, C + 30, 1, 2);
    shaft(&mut sim, Kind::Escalator, C, 1, 2);
    shaft(&mut sim, Kind::Escalator, C, 2, 3);
    shaft(&mut sim, Kind::Stairs, C - 20, 1, 2);
    shaft(&mut sim, Kind::Stairs, C - 20, 2, 3);
    let office = put(&mut sim, Kind::Office, 2, C - 40);
    seat(&mut sim, office, UnitState::Occupied, 1.0);
    populate_floor_3(&mut sim, [C - 40, C - 31, C - 12]);
    assert_eq!(sim.binding_transport_class_at(2), Binding::Walkways);
    assert!(elevator_stops(&sim, 2));
}
