//! The Modern router (`expected_time`): riders take the quickest expected
//! trip, lines included, and spread across ways up as lines grow; Classic
//! keeps the fewest-rides search and ignores the lines.

use super::*;
use crate::clock::{CalendarKind, GameMode};
use crate::rule_tests::shaft;
use crate::sim::Simulation;

const WIDTH: i64 = 40;

/// A lobby on floors 1 and 15, plain floors between and up to `top`, over
/// 40 columns.
fn tower(mode: GameMode, top: i64) -> Simulation {
    let mut sim = Simulation::new(1, mode, CalendarKind::RealWorld, false);
    for floor in 1..=top {
        let kind = if floor == 1 || floor == 15 {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        for x in 0..WIDTH {
            assert!(sim.tower.place(kind, floor, x).ok, "{kind:?} {floor} {x}");
        }
    }
    sim
}

/// The shaft a rider from floor 1 to `to` takes first, routed now.
fn first_shaft(sim: &mut Simulation, to: i64) -> i64 {
    let r = sim
        .crowd
        .route(&sim.tower, 1, to, None, None)
        .expect("a route");
    r.shafts[0]
}

#[test]
fn a_long_line_at_the_express_sends_riders_to_the_local() {
    let mut sim = tower(GameMode::Modern, 15);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 15);
    sim.crowd.begin_step();
    // With no line, the express is quicker: it does not stop on the way.
    assert_eq!(first_shaft(&mut sim, 15), express);
    // Riders routed in the same step join its line until the local wins.
    let picks: Vec<i64> = (0..400).map(|_| first_shaft(&mut sim, 15)).collect();
    let to_local = picks.iter().filter(|&&s| s == local).count();
    assert!(to_local > 0, "nobody took the local");
    assert!(to_local < picks.len(), "nobody took the express");
    // The next step counts the lines from the people actually waiting
    // (none here), so the express is back to the quickest.
    sim.crowd.begin_step();
    assert_eq!(first_shaft(&mut sim, 15), express);
}

#[test]
fn the_line_motion_counted_last_step_is_the_line_the_router_sees() {
    let mut sim = tower(GameMode::Modern, 15);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 15);
    // Two hundred riders already standing at the express on the lobby.
    for _ in 0..200 {
        let i = crate::crowd::spawn::add(&mut sim.crowd, &sim.tower, 1, 15, Some(30), None)
            .expect("a rider");
        let p = &mut sim.crowd.people[i];
        p.state = crate::crowd::PState::Waiting;
        p.shaft_id = Some(express);
        p.shafts = vec![express];
        p.floors = vec![1, 15];
        p.x = 5.0;
    }
    // A step that has not counted them yet still sends the next rider up
    // the express.
    sim.crowd.shaft_lines = Default::default();
    sim.crowd.begin_step();
    assert_eq!(first_shaft(&mut sim, 15), express);
    // The motion slice counts the line, and the next step's router reads it.
    crate::crowd::motion::advance(&mut sim.crowd, 0.01, &mut sim.tower);
    sim.crowd.begin_step();
    assert_eq!(first_shaft(&mut sim, 15), local);
}

#[test]
fn twin_shafts_share_the_riders_and_skip_the_one_standing_down() {
    let mut sim = tower(GameMode::Modern, 12);
    let a = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 12);
    let b = shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 12);
    assert!(sim.tower.set_cars(a, 8));
    assert!(sim.tower.set_cars(b, 8));
    sim.crowd.begin_step();
    let picks: Vec<i64> = (0..40).map(|_| first_shaft(&mut sim, 12)).collect();
    let to_a = picks.iter().filter(|&&s| s == a).count();
    assert!(
        (18..=22).contains(&to_a),
        "{to_a} of 40 took the first twin"
    );
    // With seven of the first twin's cars stood down, the next riders go to
    // the second until its line is the longer wait.
    sim.crowd.closed_cars = (1..8).map(|car| (a, car)).collect();
    sim.crowd.begin_step();
    let picks: Vec<i64> = (0..10).map(|_| first_shaft(&mut sim, 12)).collect();
    assert!(picks.iter().all(|&s| s == b), "{picks:?}");
}

#[test]
fn a_tower_edit_mid_step_keeps_the_lines_already_joined() {
    let picks_after = |edit: bool| {
        let mut sim = tower(GameMode::Modern, 15);
        shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
        shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 15);
        sim.crowd.begin_step();
        for _ in 0..100 {
            first_shaft(&mut sim, 15);
        }
        if edit {
            // Any edit moves the revision and rebuilds the graph.
            sim.tower.revision += 1;
        }
        (0..50)
            .map(|_| first_shaft(&mut sim, 15))
            .collect::<Vec<i64>>()
    };
    let kept = picks_after(true);
    assert_eq!(kept, picks_after(false));
    assert!(
        kept.windows(2).any(|w| w[0] != w[1]),
        "the lines decided nothing"
    );
}

#[test]
fn classic_ignores_the_lines_and_keeps_the_fewest_rides_route() {
    let mut sim = tower(GameMode::Classic, 15);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 15);
    sim.crowd.begin_step();
    let picks: Vec<i64> = (0..400).map(|_| first_shaft(&mut sim, 15)).collect();
    assert!(picks.iter().all(|&s| s == express));
}

#[test]
fn a_floor_or_two_goes_on_foot_but_a_tower_does_not() {
    let mut sim = tower(GameMode::Modern, 12);
    let lift = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 12);
    let mut flights = Vec::new();
    for floor in 1..12 {
        flights.push(shaft(&mut sim, Kind::Stairs, 20, floor, floor + 1));
    }
    sim.crowd.begin_step();
    let r = sim.crowd.route(&sim.tower, 1, 2, None, None).unwrap();
    assert_eq!(r.shafts, vec![flights[0]], "one floor up takes the stairs");
    let r = sim.crowd.route(&sim.tower, 1, 12, None, None).unwrap();
    assert_eq!(r.shafts, vec![lift], "eleven floors up takes the elevator");
    assert_eq!(r.floors, vec![1, 12]);
}

#[test]
fn a_transfer_route_names_each_floor_it_changes_at() {
    let mut sim = tower(GameMode::Modern, 25);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let upper = shaft(&mut sim, Kind::ElevatorStandard, 20, 15, 25);
    sim.crowd.begin_step();
    let r = sim.crowd.route(&sim.tower, 1, 22, None, None).unwrap();
    assert_eq!(r.floors, vec![1, 15, 22]);
    assert_eq!(r.shafts, vec![express, upper]);
    let back = sim.crowd.route(&sim.tower, 22, 1, None, None).unwrap();
    assert_eq!(back.floors, vec![22, 15, 1]);
    assert_eq!(back.shafts, vec![upper, express]);
}

#[test]
fn the_router_follows_the_tower_when_a_shaft_goes() {
    let mut sim = tower(GameMode::Modern, 15);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 15);
    sim.crowd.begin_step();
    assert_eq!(first_shaft(&mut sim, 15), express);
    assert!(sim.tower.remove_transport(express).is_some());
    assert_eq!(first_shaft(&mut sim, 15), local);
    assert!(sim.tower.remove_transport(local).is_some());
    assert!(sim.crowd.route(&sim.tower, 1, 15, None, None).is_none());
}

#[test]
fn the_bound_never_exceeds_the_cheapest_link_per_floor() {
    // Every link costs at least a car's ride per floor it covers, which is
    // what keeps the A* bound from overestimating.
    let per_floor = floors_bound(0, 1);
    assert!(tenths(STAIRS_FLIGHT_SECONDS) >= per_floor);
    assert!(tenths(ESCALATOR_FLIGHT_SECONDS) >= per_floor);
    assert_eq!(per_floor, tenths(RIDE_SECONDS_PER_FLOOR));
    // Boarding gives back a share of a dwell, but never more than it costs:
    // a negative link would let the search undercount a route.
    let dwell = DWELL_MINUTES * CROWD_SECONDS_PER_MINUTE;
    assert!(tenths(BOARDING_SECONDS - STOPS_MADE * dwell) >= 0);
}

#[test]
fn a_wide_car_over_a_gap_is_not_a_footbridge() {
    let mut sim = Simulation::new(1, GameMode::Modern, CalendarKind::RealWorld, false);
    // The top floor has a two-tile gap the car's four tiles span.
    for floor in 1..=5 {
        let kind = if floor == 1 { Kind::Lobby } else { Kind::Floor };
        for x in (0..WIDTH).filter(|&x| floor != 5 || !(5..7).contains(&x)) {
            assert!(sim.tower.place(kind, floor, x).ok, "{kind:?} {floor} {x}");
        }
    }
    let lift = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 5);
    assert_ne!(
        sim.tower.seg_at(5, Some(1.0)),
        sim.tower.seg_at(5, Some(30.0))
    );
    sim.crowd.begin_step();
    let r = sim
        .crowd
        .route(&sim.tower, 5, 5, Some(1.0), Some(30.0))
        .expect("a way across by riding");
    // Nobody steps on and off at the same stop to cross the gap: each leg
    // goes somewhere.
    assert!(r.floors.windows(2).all(|w| w[0] != w[1]), "{:?}", r.floors);
    assert!(r.shafts.iter().all(|&s| s == lift));
}

#[test]
fn cars_the_schedule_stands_down_lengthen_the_wait() {
    let mut sim = tower(GameMode::Modern, 15);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 15);
    assert!(sim.tower.set_cars(express, 8));
    assert!(sim.tower.set_cars(local, 8));
    sim.crowd.begin_step();
    assert_eq!(first_shaft(&mut sim, 15), express);
    // Seven of the express's eight cars stood down: a car comes by an
    // eighth as often, and the local is quicker.
    sim.crowd.closed_cars = (1..8).map(|car| (express, car)).collect();
    sim.crowd.begin_step();
    assert_eq!(first_shaft(&mut sim, 15), local);
    // Back in service the next step.
    sim.crowd.closed_cars.clear();
    sim.crowd.begin_step();
    assert_eq!(first_shaft(&mut sim, 15), express);
}

#[test]
fn the_exit_bound_never_overtakes_a_link() {
    // A* finds the cheapest route only while the bound drops by no more
    // than each link costs (a consistent bound). Check every link of a
    // tower with every kind of way up, toward every goal.
    let mut sim = tower(GameMode::Modern, 20);
    shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 20);
    shaft(&mut sim, Kind::ElevatorStandard, 10, 1, 15);
    shaft(&mut sim, Kind::ElevatorStandard, 16, 15, 20);
    shaft(&mut sim, Kind::Escalator, 24, 1, 2);
    shaft(&mut sim, Kind::Stairs, 30, 15, 16);
    sim.crowd.begin_step();
    let router = fresh(&mut sim.crowd, &sim.tower);
    // Each node's floor: a segment's own, a car's from the links into it.
    let mut floor_of: Vec<Option<i64>> = router
        .nodes
        .iter()
        .map(|n| match *n {
            Node::Segment(s) => Some(floor_of_seg(s)),
            Node::Car(..) => None,
        })
        .collect();
    for l in router.links.iter().flatten() {
        floor_of[l.to as usize] = Some(l.floor);
    }
    let least = |l: &Link| match l.how {
        Move::Board { shaft, .. } => l.tenths + tenths(least_headway(&router.shafts[&shaft])),
        _ => l.tenths,
    };
    let goals = router.nodes.iter().enumerate();
    let goals: Vec<u32> = goals
        .filter(|(_, n)| matches!(n, Node::Segment(_)))
        .map(|(p, _)| p as u32)
        .collect();
    let mut checked = 0;
    let mut exits_above_zero = 0;
    for &goal in &goals {
        let to_floor = floor_of_seg(segment(router, goal));
        for (p, links) in router.links.iter().enumerate() {
            let Some(here) = floor_of[p] else { continue };
            let from = bound_to(router, (p as u32, here), (goal, to_floor));
            for l in links {
                let to = bound_to(router, (l.to, l.floor), (goal, to_floor));
                assert!(from <= least(l) + to, "node {p} to {} toward {goal}", l.to);
                checked += 1;
            }
        }
    }
    for e in &router.exit {
        exits_above_zero += usize::from(*e > 0);
    }
    assert!(checked > 1000, "only {checked} links checked");
    // The bound does add something, or this test pins nothing.
    assert!(exits_above_zero > 0);
}
