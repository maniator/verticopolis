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
            held_back: None,
            auto_tune: false,
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

/// Three shafts saved in a rotated order: the door lists come out in id
/// order every step, through the per-revision id order of the shafts
/// (#2060), with no sort of the lists themselves.
#[test]
fn both_door_lists_are_ascending_for_three_shafts_saved_out_of_order() {
    let mut sim = Simulation::new_game(11, GameMode::Classic);
    sim.money = 1.0e9;
    sim.star = 5;
    for x in 150..230 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=4 {
        for x in 151..229 {
            assert!(sim.build(Kind::Floor, floor, x).ok);
        }
    }
    for x in [152, 170, 190] {
        assert!(sim.build_transport(Kind::ElevatorService, x, 1, 4).ok);
    }
    let ids: Vec<i64> = sim.tower.transports.iter().map(|t| t.id).collect();
    assert!(ids.is_sorted());
    assert!(sim.tower.dispatch_floors().elevators_by_id.is_empty());
    for (k, id) in ids.iter().enumerate() {
        assert!(sim.set_cars(*id, 2 + k as i64));
    }
    for t in &mut sim.tower.transports {
        t.schedule = Some(Schedule {
            weekday: Some(vec![1; 24]),
            weekend: Some(vec![1; 24]),
            waiting_car_response: None,
            standard_floor_departure: None,
            home_floors: None,
            held_back: None,
            auto_tune: false,
        });
    }
    // Saved as the second, third, then first shaft.
    sim.tower.transports.rotate_left(1);
    sim.tower.reindex();
    assert_eq!(sim.tower.dispatch_floors().elevators_by_id, [2, 0, 1]);
    let want_closed = [
        (ids[0], 1),
        (ids[1], 1),
        (ids[1], 2),
        (ids[2], 1),
        (ids[2], 2),
        (ids[2], 3),
    ];
    let mut opened_in = std::collections::BTreeSet::new();
    for _ in 0..30 {
        for floor in 1..=4 {
            sim.elevators.waiting.insert(floor, 2.0);
        }
        sim.elevators
            .move_cars(&mut sim.tower, 0.5, &ElevatorCalls::default(), 12, false);
        assert_eq!(sim.elevators.closed_cars(), want_closed);
        let open = sim.elevators.open_cars();
        assert!(open.is_sorted(), "{open:?}");
        opened_in.extend(open.iter().map(|c| c.0));
    }
    assert_eq!(
        opened_in.len(),
        3,
        "every shaft opened a car: {opened_in:?}"
    );
}
