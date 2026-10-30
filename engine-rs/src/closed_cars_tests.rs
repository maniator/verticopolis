//! The closed cars come out ascending whatever order the shafts were saved in,
//! since the crowd binary-searches them (#1545 review).

use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::schedule::Schedule;
use crate::sim::Simulation;

#[test]
fn closed_cars_are_ascending_for_shafts_saved_out_of_id_order() {
    let mut sim = Simulation::new_game(11, GameMode::Classic);
    sim.money = 1.0e9;
    sim.star = 5;
    for x in 150..230 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for x in 151..229 {
        assert!(sim.build(Kind::Floor, 2, x).ok);
    }
    for x in [152, 170] {
        assert!(sim.build_transport(Kind::ElevatorService, x, 1, 2).ok);
    }
    let ids: Vec<i64> = sim.tower.transports.iter().map(|t| t.id).collect();
    for id in &ids {
        assert!(sim.set_cars(*id, 3));
    }
    for t in &mut sim.tower.transports {
        t.schedule = Some(Schedule {
            weekday: Some(vec![1; 24]),
            weekend: Some(vec![1; 24]),
            waiting_car_response: None,
            standard_floor_departure: None,
            home_floors: None,
        });
    }
    // The saved order puts the higher id first.
    sim.tower.transports.reverse();
    sim.tower.reindex();
    assert!(ids[0] < ids[1]);
    assert_eq!(sim.tower.transports[0].id, ids[1]);
    sim.elevators
        .move_cars(&mut sim.tower, 1.0, &ElevatorCalls::default(), 12, false);
    let want = [(ids[0], 1), (ids[0], 2), (ids[1], 1), (ids[1], 2)];
    assert_eq!(sim.elevators.closed_cars(), want);
    let mut crowd_list = Vec::new();
    sim.elevators.swap_closed_cars(&mut crowd_list);
    for car in want {
        assert!(crowd_list.binary_search(&car).is_ok(), "{car:?}");
    }
}
