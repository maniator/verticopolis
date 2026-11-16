//! The passes that walked every transport on each step or each HUD read now
//! read lists kept per tower revision, because Modern sets no limit on
//! stairs and escalators (owner, 2026-11-16) and a tower may hold thousands
//! of flights. The car mover and the hourly sample walk the elevators alone,
//! and the congestion reading folds a per-floor table. Each list must match
//! a fresh build after every kind of transport edit.

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::{Tower, UnitState};

/// A Modern tower with a lobby and floors 2 to 6.
fn tower() -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 5;
    for x in 150..230 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=6 {
        for x in 151..229 {
            assert!(sim.build(Kind::Floor, floor, x).ok);
        }
    }
    sim
}

/// Builds a transport and returns its id.
fn placed(sim: &mut Simulation, kind: Kind, x: i64, bottom: i64, top: i64) -> i64 {
    let r = sim.build_transport(kind, x, bottom, top);
    assert!(r.ok, "{kind:?} {bottom}-{top} at {x}: {:?}", r.reason);
    sim.tower.transports.last().expect("just built").id
}

/// The elevators' places in the list, as a walk over every transport finds them.
fn walked_elevators(tower: &Tower) -> Vec<usize> {
    let all = tower.transports.iter().enumerate();
    all.filter(|(_, t)| t.kind.is_elevator())
        .map(|(i, _)| i)
        .collect()
}

fn assert_elevator_list(sim: &Simulation) {
    let listed = sim.tower.dispatch_floors().elevators.clone();
    assert_eq!(listed, walked_elevators(&sim.tower));
}

#[test]
fn the_elevator_list_follows_every_transport_edit() {
    let mut sim = tower();
    let first = placed(&mut sim, Kind::ElevatorStandard, 152, 1, 6);
    assert_elevator_list(&sim);
    let stairs = placed(&mut sim, Kind::Stairs, 170, 1, 2);
    placed(&mut sim, Kind::Escalator, 190, 2, 3);
    placed(&mut sim, Kind::ElevatorService, 210, 1, 6);
    assert_elevator_list(&sim);
    assert_eq!(sim.tower.dispatch_floors().elevators, vec![0, 3]);
    // Removing a shaft and a flight moves the later shaft down the list,
    // and the next step's car mover reads the new place.
    assert!(sim.tower.remove_transport(first).is_some());
    assert!(sim.tower.remove_transport(stairs).is_some());
    assert_elevator_list(&sim);
    assert_eq!(sim.tower.dispatch_floors().elevators, vec![1]);
    sim.tick(60.0);
    let again = placed(&mut sim, Kind::ElevatorExpress, 152, 1, 6);
    assert_elevator_list(&sim);
    assert!(sim.tower.transports.iter().any(|t| t.id == again));
}

/// The congestion reading from the memo, then from a memo cleared as a load
/// clears it: the two must agree.
fn assert_congestion_fresh(sim: &Simulation) -> Vec<(i64, f64)> {
    let (ratio, attribution) = sim.spatial_congestion_with_attribution();
    *sim.tower.memo.borrow_mut() = Default::default();
    let (fresh_ratio, fresh_attribution) = sim.spatial_congestion_with_attribution();
    let cached: Vec<(i64, f64)> = ratio.into_iter().collect();
    assert_eq!(cached, fresh_ratio.into_iter().collect::<Vec<_>>());
    let pairs = |m: indexmap::IndexMap<_, _>| m.into_iter().collect::<Vec<_>>();
    assert_eq!(pairs(attribution), pairs(fresh_attribution));
    cached
}

#[test]
fn the_congestion_table_matches_a_fresh_build_after_every_edit() {
    let mut sim = tower();
    for floor in 3..=5 {
        assert!(sim.build(Kind::Office, floor, 160).ok);
    }
    let shaft = placed(&mut sim, Kind::ElevatorStandard, 152, 1, 6);
    for _ in 0..6 {
        sim.tick(60.0);
    }
    for floor in 3..=5 {
        let id = sim.tower.unit_at(floor, 160).expect("an office").id;
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    let before = assert_congestion_fresh(&sim);
    assert!(before.iter().any(|(_, c)| *c > 0.0), "{before:?}");
    let stairs = placed(&mut sim, Kind::Stairs, 180, 3, 4);
    assert_congestion_fresh(&sim);
    // More cars carry more: the cached table takes the new capacity.
    assert!(sim.tower.set_cars(shaft, 4));
    let more_cars = assert_congestion_fresh(&sim);
    assert_ne!(more_cars, before);
    assert!(sim.tower.set_stop(shaft, 4, false));
    assert_congestion_fresh(&sim);
    assert!(sim.tower.resize_transport(shaft, 1, 5).ok);
    assert_congestion_fresh(&sim);
    assert!(sim.tower.remove_transport(stairs).is_some());
    assert_congestion_fresh(&sim);
}
