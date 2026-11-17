//! The elevator advice's roomy shaft (#2251): the passenger elevator with
//! the most free car slots on the floor, or none when every one is full.

use super::tenant_tests::{served_tower, tenant, C};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::tower::UnitState;

#[test]
fn the_elevator_advice_names_the_shaft_with_the_most_room() {
    let mut sim = served_tower(GameMode::Modern, 5);
    let id = tenant(&mut sim, Kind::Office, 3, 10, UnitState::Empty, 1.0);
    let u = sim.tower.get_unit(id).unwrap().clone();
    let roomy = |sim: &mut crate::sim::Simulation| {
        let g = sim.gripe_facts(&u, "congestion", None, None, None);
        assert_eq!(g.binding, Some("elevator"));
        g.roomy_shaft
            .map(|s| (s.kind, s.bottom, s.top, s.cars, s.max_cars))
    };
    // The only elevator here already runs 8 of 8 cars.
    assert_eq!(roomy(&mut sim), None);
    // A staff-only service shaft carries no tenants, so it is not offered.
    assert!(sim.build_transport(Kind::ElevatorService, C + 40, 1, 5).ok);
    assert_eq!(roomy(&mut sim), None);
    // Two standard shafts with room: the one with fewer cars wins.
    assert!(sim.build_transport(Kind::ElevatorStandard, C + 60, 1, 5).ok);
    assert!(sim.build_transport(Kind::ElevatorStandard, C + 80, 2, 4).ok);
    let wide = sim.tower.transports[2].id;
    assert!(sim.tower.set_cars(wide, 3));
    assert_eq!(roomy(&mut sim), Some(("elevatorStandard", 2, 4, 1, 8)));
    // A shaft that skips the floor is not offered either.
    let narrow = sim.tower.transports[3].id;
    assert!(sim.tower.set_stop(narrow, 3, false));
    assert_eq!(roomy(&mut sim), Some(("elevatorStandard", 1, 5, 3, 8)));
}
