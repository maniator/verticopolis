//! The Modern router (`expected_time`): riders take the quickest expected
//! trip, lines included, and spread across ways up as lines grow; Classic
//! keeps the fewest-rides search and ignores the lines.

use super::*;
use crate::clock::{CalendarKind, GameMode};
use crate::rule_tests::shaft;
use crate::sim::Simulation;

const WIDTH: i64 = 40;

/// Unchecks Auto on shaft `id`, which a new Modern elevator starts with,
/// so its schedule stands cars down by hand.
fn by_hand(sim: &mut Simulation, id: i64) {
    let t = sim.tower.get_transport_mut(id).expect("the shaft");
    if let Some(s) = t.schedule.as_mut() {
        s.auto_tune = false;
    }
    sim.tower.revision += 1;
}

/// A lobby on floors 1 and 15, plain floors between and up to `top`, over
/// 40 columns.
pub(super) fn tower(mode: GameMode, top: i64) -> Simulation {
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

/// Lays a basement under the lobby and past it, and a second ground lobby
/// on it at 50 to 69, apart from the first by open ground.
pub(super) fn apart(sim: &mut Simulation) {
    for x in 0..70 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok, "B1 at {x}");
    }
    for x in 50..70 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok, "lobby at {x}");
    }
}

/// The shaft a rider from floor 1 to `to` takes first, routed now.
pub(super) fn first_shaft(sim: &mut Simulation, to: i64) -> i64 {
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
    by_hand(&mut sim, a);
    by_hand(&mut sim, b);
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
        // Twin expresses: with Modern cars four times as fast, a local
        // would never win against an express's line here.
        let mut sim = tower(GameMode::Modern, 15);
        shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
        shaft(&mut sim, Kind::ElevatorExpress, 20, 1, 15);
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
fn an_escalator_is_a_ride_people_take_a_long_way() {
    // The same eleven floors as the stairs above, by escalator: a ride, so
    // it beats the elevator's wait and boarding all the way up.
    let mut sim = tower(GameMode::Modern, 12);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 12);
    let mut flights = Vec::new();
    for floor in 1..12 {
        flights.push(shaft(&mut sim, Kind::Escalator, 20, floor, floor + 1));
    }
    sim.crowd.begin_step();
    let r = sim.crowd.route(&sim.tower, 1, 12, None, None).unwrap();
    assert_eq!(r.shafts, flights, "eleven floors up rides the escalators");
}

#[test]
fn a_flight_costs_the_climb_the_motion_takes() {
    // The router's price for a floor on foot is the time the mode's
    // climbing speed takes, plus the effort of stairs or the step off an
    // escalator, so the router and the people agree.
    let mut sim = tower(GameMode::Modern, 3);
    let stairs = shaft(&mut sim, Kind::Stairs, 4, 1, 2);
    let escalator = shaft(&mut sim, Kind::Escalator, 20, 2, 3);
    let router = build(&sim.tower);
    let flight = |id: i64| {
        let costs: Vec<i64> = (router.links.iter().flatten())
            .filter(|l| matches!(l.how, Move::Flight { shaft } if shaft == id))
            .map(|l| l.tenths)
            .collect();
        assert!(!costs.is_empty(), "no flight on shaft {id}");
        assert!(costs.iter().all(|&c| c == costs[0]), "{costs:?}");
        costs[0]
    };
    let climb = |kind: Kind| 1.0 / GameMode::Modern.climb_speed(kind);
    let on_foot = climb(Kind::Stairs) + STAIRS_EFFORT_SECONDS;
    let riding = climb(Kind::Escalator) + ESCALATOR_STEP_OFF_SECONDS;
    assert_eq!(flight(stairs), tenths(on_foot));
    assert_eq!(flight(escalator), tenths(riding));
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
fn a_boarding_never_costs_less_than_nothing() {
    // The bound's search back from a goal needs every link to cost at
    // least nothing. Boarding gives back a share of a dwell, but never more than it costs:
    // a negative link would let the search undercount a route.
    let dwell = DWELL_MINUTES * CROWD_SECONDS_PER_MINUTE;
    assert!(tenths(BOARDING_SECONDS - STOPS_MADE * dwell) >= 0);
}

#[test]
fn a_ride_costs_what_the_cars_speed_makes_it() {
    // Modern cars move faster than the base speed, the express fastest; the
    // router's rides and round trips follow.
    let mut sim = tower(GameMode::Modern, 15);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 15);
    let router = build(&sim.tower);
    let dwell = DWELL_MINUTES * CROWD_SECONDS_PER_MINUTE;
    for (id, kind) in [
        (express, Kind::ElevatorExpress),
        (local, Kind::ElevatorStandard),
    ] {
        let speed = GameMode::Modern.speed_of(kind);
        assert!(speed > 1.0, "{kind:?} moves at the base speed");
        let stops = sim
            .tower
            .stops_of(sim.tower.get_transport(id).unwrap())
            .len() as f64;
        let expected = 2.0 * (14.0 * RIDE_SECONDS_PER_FLOOR / speed + stops * dwell);
        assert_eq!(
            router.shafts.get(&id).unwrap().round_trip,
            expected,
            "{kind:?}"
        );
    }
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
    // Twin expresses of eight cars each.
    let mut sim = tower(GameMode::Modern, 15);
    let a = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let b = shaft(&mut sim, Kind::ElevatorExpress, 20, 1, 15);
    assert!(sim.tower.set_cars(a, 8));
    assert!(sim.tower.set_cars(b, 8));
    by_hand(&mut sim, a);
    by_hand(&mut sim, b);
    // Seven of one shaft's eight cars stood down: a car comes by an eighth
    // as often, and its twin is quicker, whichever one it is.
    for (down, up) in [(a, b), (b, a)] {
        sim.crowd.closed_cars = (1..8).map(|car| (down, car)).collect();
        sim.crowd.begin_step();
        assert_eq!(first_shaft(&mut sim, 15), up);
    }
}

#[test]
fn an_auto_shaft_with_parked_cars_still_gets_its_share() {
    // Twin elevators on Auto, as a new Modern elevator starts.
    let mut sim = tower(GameMode::Modern, 12);
    let a = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 12);
    let b = shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 12);
    assert!(sim.tower.set_cars(a, 8));
    assert!(sim.tower.set_cars(b, 8));
    for id in [a, b] {
        let t = sim.tower.get_transport(id).expect("the shaft");
        assert!(t.schedule.as_ref().is_some_and(|s| s.auto_tune));
    }
    // Seven of the first twin's cars parked while nobody waited: they all
    // come out for the first rider in line, so the riders still split.
    sim.crowd.closed_cars = (1..8).map(|car| (a, car)).collect();
    sim.crowd.begin_step();
    let picks: Vec<i64> = (0..40).map(|_| first_shaft(&mut sim, 12)).collect();
    let to_a = picks.iter().filter(|&&s| s == a).count();
    assert!(
        (18..=22).contains(&to_a),
        "{to_a} of 40 took the parked twin"
    );
}

#[test]
fn the_street_joins_ground_lobbies_that_do_not_touch() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = tower(mode, 15);
        apart(&mut sim);
        let r = sim.crowd.route(&sim.tower, 1, 1, Some(5.0), Some(60.0));
        if mode.walks_the_street() {
            let r = r.expect("a walk along the street");
            assert_eq!(r.floors, vec![1], "{mode:?}: no ride");
            assert!(r.shafts.is_empty(), "{mode:?}");
        } else {
            assert!(r.is_none(), "{mode:?}: no way across");
        }
    }
}

#[test]
fn someone_on_the_street_finds_a_way_from_the_nearest_lobby() {
    let mut sim = tower(GameMode::Modern, 15);
    apart(&mut sim);
    for x in 50..70 {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok, "floor 2 at {x}");
    }
    let up = shaft(&mut sim, Kind::ElevatorStandard, 60, 1, 2);
    // Out on the open ground between the lobbies, nearer the right one.
    let r = sim.crowd.route(&sim.tower, 1, 2, Some(47.5), Some(60.0));
    let r = r.expect("a way on from the street");
    assert_eq!(r.floors, vec![1, 2]);
    assert_eq!(r.shafts, vec![up]);
}

/// The walk to the first shaft counts (owner, 2026-11-17): of twin shafts,
/// a rider takes the one beside them, and the older shaft no longer wins
/// every tie.
#[test]
fn riders_take_the_twin_shaft_nearer_where_they_start() {
    let mut sim = tower(GameMode::Modern, 15);
    let left = shaft(&mut sim, Kind::ElevatorExpress, 2, 1, 15);
    let right = shaft(&mut sim, Kind::ElevatorExpress, 32, 1, 15);
    sim.crowd.begin_step();
    let first = |sim: &mut Simulation, from: f64, to: f64| {
        let r = sim.crowd.route(&sim.tower, 1, 15, Some(from), Some(to));
        r.expect("a route").shafts[0]
    };
    assert_eq!(
        first(&mut sim, 36.0, 36.0),
        right,
        "the newer shaft, nearer"
    );
    assert_eq!(first(&mut sim, 1.0, 36.0), left, "the far end walks free");
}
