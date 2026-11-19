//! A trip's patience counts only the time spent waiting for a car (#2386):
//! walking and climbing use none of it, and a long route gets no more of it
//! than a short one, in both modes.

use super::*;
use crate::clock::{CalendarKind, GameMode};
use crate::crowd::{motion, spawn};
use crate::facilities::Kind;
use crate::rule_tests::shaft;
use crate::sim::Simulation;

/// A lobby on floor 1 and plain floors up to 15 over 40 columns, a local
/// elevator at column 4 over every floor and stairs at column 30 from 1 to
/// 2: (sim, elevator, stairs).
fn tower(mode: GameMode) -> (Simulation, i64, i64) {
    let mut sim = Simulation::new(1, mode, CalendarKind::RealWorld, false);
    for floor in 1..=15 {
        let kind = if floor == 1 { Kind::Lobby } else { Kind::Floor };
        for x in 0..40 {
            assert!(sim.tower.place(kind, floor, x).ok, "{kind:?} {floor} {x}");
        }
    }
    let elevator = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 15);
    let stairs = shaft(&mut sim, Kind::Stairs, 30, 1, 2);
    (sim, elevator, stairs)
}

/// A rider from the lobby to floor `to`, waiting in the elevator's line on
/// the lobby with `age` crowd seconds of this trip's patience used.
fn waiting(sim: &mut Simulation, elevator: i64, to: i64, age: f64) -> usize {
    let i = spawn::add(&mut sim.crowd, &sim.tower, 1, to, Some(5), None).expect("a rider");
    let p = &mut sim.crowd.people[i];
    p.state = PState::Waiting;
    p.shaft_id = Some(elevator);
    p.shafts = vec![elevator];
    p.floors = vec![1, to];
    p.leg = 0;
    p.x = 5.0;
    p.age = age;
    i
}

fn moment(sim: &mut Simulation, dt: f64) {
    sim.crowd.begin_step();
    motion::advance(&mut sim.crowd, dt, &mut sim.tower);
}

#[test]
fn a_long_route_gets_no_more_patience_than_a_short_one() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, elevator, _) = tower(mode);
        // Just past the limit on a 14-floor trip and on a one-floor trip: the
        // old per-floor allowance gave the long trip 35 more seconds.
        let long = waiting(&mut sim, elevator, 15, GIVE_UP + 0.5);
        let short = waiting(&mut sim, elevator, 2, GIVE_UP + 0.5);
        moment(&mut sim, 0.01);
        for (name, i) in [("long", long), ("short", short)] {
            let p = &sim.crowd.people[i];
            assert!(
                p.gave_up && p.returning,
                "{mode:?} {name}: turns back at the same limit"
            );
        }
    }
}

#[test]
fn only_waiting_for_a_car_uses_patience() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, elevator, _) = tower(mode);
        let walker = waiting(&mut sim, elevator, 15, 10.0);
        sim.crowd.people[walker].state = PState::ToShaft;
        sim.crowd.people[walker].x = 20.0;
        let rider = waiting(&mut sim, elevator, 15, 10.0);
        moment(&mut sim, 0.5);
        assert_eq!(
            sim.crowd.people[walker].age, 10.0,
            "{mode:?}: walking to the shaft uses none"
        );
        assert_eq!(
            sim.crowd.people[rider].age, 10.5,
            "{mode:?}: waiting in line uses it"
        );
    }
}

#[test]
fn a_housekeeper_on_the_stairs_never_runs_out_of_patience() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, elevator, stairs) = tower(mode);
        let i = waiting(&mut sim, elevator, 2, 2.0 * STAFF_GIVE_UP);
        let p = &mut sim.crowd.people[i];
        p.staff = true;
        p.state = PState::Climbing;
        p.shaft_id = Some(stairs);
        p.shafts = vec![stairs];
        p.x = 30.0;
        p.fy = 1.0;
        moment(&mut sim, 0.01);
        let p = &sim.crowd.people[i];
        assert_eq!(p.state, PState::Climbing, "{mode:?}: still on the stairs");
        assert_eq!(p.age, 2.0 * STAFF_GIVE_UP, "{mode:?}: climbing uses none");
    }
}
