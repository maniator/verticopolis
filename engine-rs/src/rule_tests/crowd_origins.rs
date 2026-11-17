//! Everyone in the crowd who boards an elevator reaches the shaft's origin
//! rings (#477), commuters, visitors, guests and staff alike. Before, only
//! commuting office workers did: an attendance venue feeds no waiting
//! estimate, since its visitors ride as people, so a cinema's evening crowd
//! never marked the cinema's floor, and the hotspot, the Simulate origin
//! clause and Auto-tune's staging aim pointed at other floors. Staff riding a
//! service car are counted here once, as they step aboard; the dispatch no
//! longer tallies its staff callers (`dispatch_staff_tally_tests`).
use crate::clock::GameMode;
use crate::crowd::motion::advance;
use crate::crowd::spawn::make_person;
use crate::crowd::{PState, Route};
use crate::dispatch::Leaving;
use crate::facilities::Kind;
use crate::sim::Simulation;

use super::{shaft, strip_tower};

const VENUE_FLOOR: i64 = 3;
const LOBBY: i64 = 1;

/// A tower up to floor 6 with one elevator of `kind` at x 4, its one car
/// standing open at `VENUE_FLOOR`, and a person who is no commuter waiting
/// there to ride down to the lobby. Returns the shaft id and the person.
fn visitor_at_an_open_car(kind: Kind) -> (Simulation, i64, usize) {
    let mut sim = strip_tower(7, GameMode::Modern, 40, 6);
    let id = shaft(&mut sim, kind, 4, 1, 6);
    let route = Route {
        floors: vec![VENUE_FLOOR, LOBBY],
        shafts: vec![id],
    };
    let i = make_person(&mut sim.crowd, &sim.tower, route, 30.0, None);
    let p = &mut sim.crowd.people[i];
    (p.state, p.floor, p.fy, p.x) = (PState::Waiting, VENUE_FLOOR, VENUE_FLOOR as f64, 6.0);
    assert!(!p.commuter);
    let t = sim
        .tower
        .transports
        .iter_mut()
        .find(|t| t.id == id)
        .unwrap();
    (t.car_positions[0], t.car_dir[0]) = (VENUE_FLOOR as f64, 0);
    sim.crowd.open_cars = vec![(id, 0, VENUE_FLOOR, Leaving::Either)];
    (sim, id, i)
}

fn boarded_at(sim: &Simulation, id: i64, floor: i64) -> f64 {
    sim.crowd
        .elevator_boardings
        .get(&(id, floor))
        .copied()
        .unwrap_or(0.0)
}

#[test]
fn a_visitor_boarding_marks_their_floor_in_the_origin_rings() {
    let (mut sim, id, i) = visitor_at_an_open_car(Kind::ElevatorStandard);
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(sim.crowd.people[i].state, PState::Riding);
    assert_eq!(boarded_at(&sim, id, VENUE_FLOOR), 1.0);
    // The hour pass folds the boarding into the shaft's rings and clears it.
    sim.sample_elevator_util();
    assert!(sim.crowd.elevator_boardings.is_empty());
    let rings = &sim.telemetry.origins[&id];
    let marked = rings
        .weekday
        .iter()
        .chain(&rings.weekend)
        .any(|slot| slot.get(&VENUE_FLOOR) == Some(&1.0));
    assert!(marked, "the boarding left no mark on its floor: {rings:?}");
}

#[test]
fn a_service_car_rider_marks_their_floor_once_as_they_board() {
    // The dispatch's half of "once" (it tallies no staff caller) is
    // `dispatch_staff_tally_tests`.
    let (mut sim, id, i) = visitor_at_an_open_car(Kind::ElevatorService);
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(sim.crowd.people[i].state, PState::Riding);
    // Riding on, they board nobody again.
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(boarded_at(&sim, id, VENUE_FLOOR), 1.0);
}
