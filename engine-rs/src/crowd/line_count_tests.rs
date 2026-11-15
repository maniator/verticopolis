//! The lines the Modern router reads (`LineCount`): each line's longest
//! wait, the riders who look for another way once their line has kept them
//! an hour, a reload that counts the same lines, and the Bulletin's warning.

use super::*;
use crate::clock::{CalendarKind, GameMode};
use crate::crowd::{motion, spawn};
use crate::facilities::Kind;
use crate::rule_tests::shaft;
use crate::sim::Simulation;

/// A lobby on floor 1 and plain floors up to 15 over 40 columns, with an
/// express at column 4 and a local at column 20: (sim, express, local).
fn tower(mode: GameMode) -> (Simulation, i64, i64) {
    let mut sim = Simulation::new(1, mode, CalendarKind::RealWorld, false);
    for floor in 1..=15 {
        let kind = if floor == 1 { Kind::Lobby } else { Kind::Floor };
        for x in 0..40 {
            assert!(sim.tower.place(kind, floor, x).ok, "{kind:?} {floor} {x}");
        }
    }
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 15);
    (sim, express, local)
}

/// A rider from the lobby to floor 15 standing in the express's line,
/// having waited `wait` crowd seconds there.
fn in_line(sim: &mut Simulation, express: i64, wait: f64) -> usize {
    let i = spawn::add(&mut sim.crowd, &sim.tower, 1, 15, Some(30), None).expect("a rider");
    let p = &mut sim.crowd.people[i];
    p.state = PState::Waiting;
    p.shaft_id = Some(express);
    p.shafts = vec![express];
    p.floors = vec![1, 15];
    p.leg = 0;
    p.x = 5.0;
    p.wait = wait;
    i
}

/// Says the express's line on the lobby has kept someone `oldest` crowd
/// seconds, as the last motion pass would have counted it.
fn line_kept(sim: &mut Simulation, express: i64, oldest: f64) {
    let line = Line { riders: 1, oldest };
    sim.crowd.shaft_lines = FastMap::from_iter([((express, 1), line)]);
}

/// One short motion pass, a new step's router reading the lines.
fn moment(sim: &mut Simulation) {
    sim.crowd.begin_step();
    motion::advance(&mut sim.crowd, 0.01, &mut sim.tower);
}

#[test]
fn the_router_counts_a_lines_longest_wait() {
    let (mut sim, express, local) = tower(GameMode::Modern);
    let first = |sim: &mut Simulation| {
        let r = sim.crowd.route(&sim.tower, 1, 15, None, None);
        r.expect("a route").shafts[0]
    };
    sim.crowd.begin_step();
    assert_eq!(
        first(&mut sim),
        express,
        "with no line the express is quicker"
    );
    // One rider in it, but one who has stood there two hours: the line
    // moves slower than its length says, and the local wins.
    line_kept(&mut sim, express, 2.0 * GIVE_UP);
    sim.crowd.begin_step();
    assert_eq!(first(&mut sim), local);
}

#[test]
fn the_motion_pass_counts_the_longest_wait_in_each_line() {
    let (mut sim, express, _) = tower(GameMode::Modern);
    for wait in [3.0, 40.0, 17.0] {
        in_line(&mut sim, express, wait);
    }
    moment(&mut sim);
    let line = sim.crowd.shaft_lines.get(&(express, 1)).copied();
    let line = line.expect("the express's line");
    assert_eq!(line.riders, 3);
    assert!((40.0..40.1).contains(&line.oldest), "{}", line.oldest);
}

#[test]
fn an_hour_in_a_stuck_line_sends_a_rider_another_way() {
    let (mut sim, express, local) = tower(GameMode::Modern);
    let i = in_line(&mut sim, express, GIVE_UP - 0.005);
    line_kept(&mut sim, express, 20.0 * GIVE_UP);
    moment(&mut sim);
    let p = &sim.crowd.people[i];
    assert_eq!(p.shaft_id, Some(local), "they leave the stuck line");
    assert_eq!(p.state, PState::ToShaft);
    assert_eq!(p.wait, 0.0, "a new line, a new wait");
    assert!(
        p.trip_wait >= GIVE_UP,
        "the hour they stood counts in the trip"
    );
    // They walk to the local: no one vanishes or appears elsewhere.
    assert_eq!(p.floor, 1);
}

#[test]
fn a_rider_keeps_their_place_while_their_line_is_still_the_quickest() {
    let (mut sim, express, _) = tower(GameMode::Modern);
    let i = in_line(&mut sim, express, GIVE_UP - 0.005);
    moment(&mut sim);
    let p = &sim.crowd.people[i];
    assert_eq!(p.shaft_id, Some(express));
    assert_eq!(p.state, PState::Waiting);
    assert!(p.wait >= GIVE_UP, "their wait goes on");
}

#[test]
fn a_rider_weighs_another_way_once_per_line() {
    let (mut sim, express, _) = tower(GameMode::Modern);
    // A second hour passing in the same line sends nobody anywhere.
    let i = in_line(&mut sim, express, 2.0 * GIVE_UP - 0.005);
    line_kept(&mut sim, express, 20.0 * GIVE_UP);
    moment(&mut sim);
    assert_eq!(sim.crowd.people[i].shaft_id, Some(express));
}

#[test]
fn classic_riders_and_housekeepers_keep_their_line() {
    let (mut sim, express, _) = tower(GameMode::Classic);
    let i = in_line(&mut sim, express, GIVE_UP - 0.005);
    line_kept(&mut sim, express, 20.0 * GIVE_UP);
    moment(&mut sim);
    assert_eq!(sim.crowd.people[i].shaft_id, Some(express), "Classic");
    let (mut sim, express, _) = tower(GameMode::Modern);
    let i = in_line(&mut sim, express, GIVE_UP - 0.005);
    sim.crowd.people[i].staff = true;
    line_kept(&mut sim, express, 20.0 * GIVE_UP);
    moment(&mut sim);
    assert_eq!(sim.crowd.people[i].shaft_id, Some(express), "staff");
}

#[test]
fn weighing_another_way_and_staying_joins_no_line_twice() {
    let (mut sim, express, _) = tower(GameMode::Modern);
    in_line(&mut sim, express, GIVE_UP - 0.005);
    // The line as last counted: the one rider, not kept long.
    line_kept(&mut sim, express, 1.0);
    moment(&mut sim);
    // The step's router, which the rider's second look started, still
    // counts them once.
    let lines = super::super::expected_time::router_lines(&sim.crowd).expect("a router");
    assert_eq!(lines.get(&(express, 1)).map(|l| l.riders), Some(1));
}

#[test]
fn a_reload_counts_the_same_lines() {
    let (mut sim, express, local) = tower(GameMode::Modern);
    for wait in [3.0, 95.0, 17.0] {
        in_line(&mut sim, express, wait);
    }
    let i = in_line(&mut sim, express, 60.0);
    sim.crowd.people[i].shaft_id = Some(local);
    sim.crowd.people[i].shafts = vec![local];
    moment(&mut sim);
    let loaded = crate::load_stream::load_save_text(sim.save_text().as_bytes()).unwrap();
    let lines = |sim: &Simulation| {
        let sorted = sim.crowd.shaft_lines.sorted();
        sorted
            .into_iter()
            .map(|(k, v)| (*k, *v))
            .collect::<Vec<_>>()
    };
    assert_eq!(lines(&sim).len(), 2);
    assert_eq!(lines(&loaded), lines(&sim));
}

/// The Bulletin lines that name a long wait.
fn warnings(sim: &Simulation) -> Vec<String> {
    let long = sim
        .log
        .iter()
        .filter(|e| e.text.contains("waited over an hour"));
    long.map(|e| e.text.clone()).collect()
}

#[test]
fn a_line_past_an_hour_makes_the_bulletin_once() {
    let (mut sim, express, _) = tower(GameMode::Modern);
    let i = in_line(&mut sim, express, GIVE_UP + 10.0);
    sim.on_hour();
    let said = warnings(&sim);
    assert_eq!(said.len(), 1, "{said:?}");
    assert!(said[0].contains("floor 1"), "{}", said[0]);
    assert!(said[0].contains("Express"), "{}", said[0]);
    // An hour on, the same rider is old news.
    sim.crowd.people[i].wait += 60.0 * crate::crowd::CROWD_SECONDS_PER_MINUTE;
    sim.on_hour();
    assert_eq!(warnings(&sim).len(), 1);
}

#[test]
fn classic_makes_no_line_bulletin() {
    let (mut sim, express, _) = tower(GameMode::Classic);
    in_line(&mut sim, express, GIVE_UP + 10.0);
    sim.on_hour();
    assert!(warnings(&sim).is_empty());
}
