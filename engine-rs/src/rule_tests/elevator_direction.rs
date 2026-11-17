//! A rider gets on only a car leaving their way, in both modes.
//!
//! In 4.7.0 a person on floor 45 bound for 47 boarded a car that had stopped
//! there on its way down, rode it to the bottom of the shaft and back up. The
//! calls carry no direction and anyone waiting at a stop boarded any open
//! car. Now each open car shows which way it leaves (`dispatch::Leaving`): on
//! along its sweep while a stop it answers lies ahead, back when every one
//! lies behind, and either way when it has none. A rider boards only a car
//! leaving their way, as the SimTower wiki's riders do, and the car then
//! sweeps that way first.
use crate::clock::GameMode;
use crate::crowd::fasthash::FastMap;
use crate::crowd::motion::advance;
use crate::crowd::spawn::make_person;
use crate::crowd::{ElevatorCalls, HallCall, PState, Route, CROWD_SECONDS_PER_MINUTE};
use crate::dispatch::{ElevatorDispatch, Leaving};
use crate::facilities::Kind;
use crate::sim::Simulation;
use std::collections::BTreeSet;

use super::{shaft, strip_tower};

const TOP: i64 = 10;
const HOUR: i64 = 9;
const WEEKDAY: bool = false;
/// The floor both riders wait on, and where the up rider is bound.
const FLOOR: i64 = 5;
const UP_TO: i64 = 7;
const DOWN_TO: i64 = 1;

/// A tower to floor `TOP` with one standard elevator (one car) from the
/// lobby to the top. Returns the simulation and the shaft id.
fn tower(mode: GameMode) -> (Simulation, i64) {
    let mut sim = strip_tower(7, mode, 40, TOP);
    let id = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, TOP);
    sim.tower.set_cars(id, 1);
    (sim, id)
}

/// A person on `from` bound for `to` on shaft `id`, already waiting at it.
fn waiting(sim: &mut Simulation, id: i64, from: i64, to: i64) -> usize {
    let route = Route {
        floors: vec![from, to],
        shafts: vec![id],
    };
    let i = make_person(&mut sim.crowd, &sim.tower, route, 30.0, None);
    let p = &mut sim.crowd.people[i];
    (p.state, p.floor, p.fy, p.x) = (PState::Waiting, from, from as f64, 6.0);
    i
}

fn place_car(sim: &mut Simulation, id: i64, pos: f64, dir: i64) {
    let t = sim.tower.get_transport_mut(id).unwrap();
    (t.car_positions[0], t.car_dir[0]) = (pos, dir);
}

#[test]
fn a_rider_boards_only_a_car_leaving_their_way() {
    for (leaving, up_boards, down_boards) in [
        (Leaving::Up, true, false),
        (Leaving::Down, false, true),
        // The first aboard (the up rider, listed first) sets its way.
        (Leaving::Either, true, false),
    ] {
        let (mut sim, id) = tower(GameMode::Classic);
        let up = waiting(&mut sim, id, FLOOR, UP_TO);
        let down = waiting(&mut sim, id, FLOOR, DOWN_TO);
        place_car(&mut sim, id, FLOOR as f64, -1);
        sim.crowd.open_cars = vec![(id, 0, FLOOR, leaving)];
        advance(&mut sim.crowd, 0.1, &mut sim.tower);
        let riding = |i: usize| sim.crowd.people[i].state == PState::Riding;
        assert_eq!(riding(up), up_boards, "up rider, car leaving {leaving:?}");
        assert_eq!(
            riding(down),
            down_boards,
            "down rider, car leaving {leaving:?}"
        );
    }
}

/// Car 0 of shaft `id` heading down from the top, stepped until it opens
/// at `FLOOR`. Returns the way it says it leaves.
fn leaving_at_floor(sim: &mut Simulation, id: i64, calls: &ElevatorCalls) -> Leaving {
    let mut d = ElevatorDispatch::new();
    place_car(sim, id, TOP as f64, -1);
    for _ in 0..100 {
        d.move_cars(&mut sim.tower, 0.25, calls, HOUR, WEEKDAY);
        if let Some(&(_, _, _, way)) = d.open_cars().iter().find(|o| o.2 == FLOOR) {
            return way;
        }
    }
    panic!("the car never opened at {FLOOR}");
}

#[test]
fn a_car_stopping_on_its_way_down_leaves_down_while_a_stop_lies_below() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, id) = tower(mode);
        // A rider waits at FLOOR and another at the lobby.
        let mut calls = ElevatorCalls::default();
        calls.hall.insert(
            id,
            [(FLOOR, 1.0.into()), (1, 1.0.into())].into_iter().collect(),
        );
        assert_eq!(
            leaving_at_floor(&mut sim, id, &calls),
            Leaving::Down,
            "{mode:?}"
        );
    }
}

#[test]
fn a_car_with_nothing_else_to_do_takes_either_way() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, id) = tower(mode);
        let mut calls = ElevatorCalls::default();
        calls
            .hall
            .insert(id, [(FLOOR, 1.0.into())].into_iter().collect());
        assert_eq!(
            leaving_at_floor(&mut sim, id, &calls),
            Leaving::Either,
            "{mode:?}"
        );
    }
}

#[test]
fn a_car_whose_only_stop_lies_behind_it_turns_and_says_so() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, id) = tower(mode);
        // It came down for FLOOR with a call above it and nothing below.
        let mut calls = ElevatorCalls::default();
        calls
            .hall
            .insert(id, [(FLOOR, 1.0.into())].into_iter().collect());
        let mut d = ElevatorDispatch::new();
        place_car(&mut sim, id, FLOOR as f64 + 1.0, -1);
        d.move_cars(&mut sim.tower, 2.0, &calls, HOUR, WEEKDAY);
        assert_eq!(d.open_cars().len(), 1);
        calls.hall.get_mut(&id).unwrap().insert(TOP, 1.0.into());
        d.move_cars(&mut sim.tower, 0.1, &calls, HOUR, WEEKDAY);
        assert_eq!(d.open_cars(), [(id, 0, FLOOR, Leaving::Up)], "{mode:?}");
        let t = sim.tower.get_transport(id).unwrap();
        assert_eq!(t.car_dir[0], 1, "{mode:?}: it sweeps up next");
    }
}

/// The 4.7.0 report, played through the dispatch and the crowd together as
/// a step does: a car coming down stops for two riders at `FLOOR`, one bound
/// up and one bound down, whichever reached the shaft first. Neither rides
/// away from their floor: the second waits for the car to come back, and
/// both get there.
#[test]
fn nobody_rides_a_car_the_wrong_way_first() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        for up_first in [true, false] {
            let (mut sim, id) = tower(mode);
            let order = if up_first {
                [UP_TO, DOWN_TO]
            } else {
                [DOWN_TO, UP_TO]
            };
            // (person id, bound for, arrived, farthest the wrong way)
            let mut riders: Vec<(i64, i64, bool, f64)> = order
                .iter()
                .map(|&to| {
                    let i = waiting(&mut sim, id, FLOOR, to);
                    (sim.crowd.people[i].id, to, false, 0.0)
                })
                .collect();
            place_car(&mut sim, id, TOP as f64, -1);
            let chunk = 0.25;
            for _ in 0..400 {
                let calls = sim.crowd.elevator_calls(&sim.tower);
                sim.elevators
                    .move_cars(&mut sim.tower, chunk, &calls, HOUR, WEEKDAY);
                sim.elevators.swap_closed_cars(&mut sim.crowd.closed_cars);
                sim.elevators.swap_open_cars(&mut sim.crowd.open_cars);
                let seconds = chunk * CROWD_SECONDS_PER_MINUTE;
                advance(&mut sim.crowd, seconds, &mut sim.tower);
                for (pid, to, arrived, wrong) in &mut riders {
                    // Someone who has finished their visit has left the crowd.
                    let Some(p) = sim.crowd.people.iter().find(|p| p.id == *pid) else {
                        continue;
                    };
                    let away = (p.fy - FLOOR as f64) * (FLOOR - *to).signum() as f64;
                    *wrong = wrong.max(away);
                    *arrived |= p.state == PState::ToDest && p.floor == *to;
                }
                if riders.iter().all(|r| r.2) {
                    break;
                }
            }
            for (_, to, arrived, wrong) in riders {
                let case = format!("{mode:?}, up first {up_first}, bound for {to}");
                assert!(arrived, "{case}: arrived");
                assert_eq!(wrong, 0.0, "{case}: rode the wrong way");
            }
        }
    }
}

/// Hall callers at `floors` on shaft `id`, every one bound `to`.
fn bound_calls(id: i64, floors: &[i64], to: i64) -> ElevatorCalls {
    let mut calls = ElevatorCalls::default();
    let one = |fl: i64| HallCall {
        callers: 1.0,
        up: u32::from(to > fl),
        down: u32::from(to < fl),
    };
    calls
        .hall
        .insert(id, floors.iter().map(|&f| (f, one(f))).collect());
    calls
}

/// The floors car 0 of shaft `id` opens at, in order, over `steps` steps.
fn stops_made(sim: &mut Simulation, calls: &ElevatorCalls, steps: usize) -> Vec<i64> {
    let mut d = ElevatorDispatch::new();
    let mut made: Vec<i64> = Vec::new();
    for _ in 0..steps {
        d.move_cars(&mut sim.tower, 0.25, calls, HOUR, WEEKDAY);
        if let Some(&(_, _, f, _)) = d.open_cars().first() {
            if made.last() != Some(&f) {
                made.push(f);
            }
        }
    }
    made
}

#[test]
fn a_car_passes_a_floor_where_everyone_waits_to_go_the_other_way() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, id) = tower(mode);
        // Climbing from the lobby with a rider for 9, past a caller at 5
        // bound for the lobby: it stops at 9 first, then at 5 coming down.
        place_car(&mut sim, id, 1.0, 1);
        let mut calls = bound_calls(id, &[FLOOR], DOWN_TO);
        calls
            .cab
            .insert(id, FastMap::from_iter([(0, BTreeSet::from([9]))]));
        let made = stops_made(&mut sim, &calls, 300);
        assert_eq!(made[..2], [9, FLOOR], "{mode:?}");
    }
}

#[test]
fn a_car_turns_at_the_farthest_floor_bound_the_other_way() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, id) = tower(mode);
        // Only callers bound down, at 5 and 8: up to 8, then down to 5.
        place_car(&mut sim, id, 1.0, 1);
        let calls = bound_calls(id, &[FLOOR, 8], DOWN_TO);
        let made = stops_made(&mut sim, &calls, 300);
        assert_eq!(made[..2], [8, FLOOR], "{mode:?}");
    }
}

#[test]
fn a_parked_car_takes_its_rider_down_before_a_call_above() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, id) = tower(mode);
        // Parked at 5 with a rider for 2 aboard and a call at 9.
        place_car(&mut sim, id, FLOOR as f64, 0);
        let mut calls = ElevatorCalls::default();
        calls
            .hall
            .insert(id, [(9, 1.0.into())].into_iter().collect());
        calls
            .cab
            .insert(id, FastMap::from_iter([(0, BTreeSet::from([2]))]));
        let made = stops_made(&mut sim, &calls, 300);
        assert_eq!(made[..2], [2, 9], "{mode:?}");
    }
}

#[test]
fn newcomers_bound_the_other_way_do_not_hold_the_doors() {
    // Standard Floor Departure starts the wait over for a newcomer the car
    // takes, never for one bound the other way.
    let leaves_by = |newcomer_to: i64| {
        let (mut sim, id) = tower(GameMode::Classic);
        place_car(&mut sim, id, FLOOR as f64 + 0.1, -1);
        let mut d = ElevatorDispatch::new();
        // Arrive at 5 for a caller bound down, with a call at the lobby.
        let mut calls = bound_calls(id, &[FLOOR, 1], DOWN_TO);
        d.move_cars(&mut sim.tower, 0.25, &calls, HOUR, WEEKDAY);
        assert_eq!(d.open_cars(), [(id, 0, FLOOR, Leaving::Down)]);
        // Half a dwell later a newcomer arrives at 5.
        d.move_cars(&mut sim.tower, 0.4, &calls, HOUR, WEEKDAY);
        let (up, down) = if newcomer_to > FLOOR { (1, 1) } else { (0, 2) };
        let both = HallCall {
            callers: 2.0,
            up,
            down,
        };
        calls.hall.get_mut(&id).unwrap().insert(FLOOR, both);
        d.move_cars(&mut sim.tower, 0.25, &calls, HOUR, WEEKDAY);
        d.move_cars(&mut sim.tower, 0.25, &calls, HOUR, WEEKDAY);
        sim.tower.get_transport(id).unwrap().car_positions[0] < FLOOR as f64
    };
    assert!(leaves_by(UP_TO), "a newcomer bound up does not hold it");
    assert!(
        !leaves_by(DOWN_TO),
        "a newcomer bound down boards and holds it"
    );
}

/// Owner, 2026-11-16: once a car is done going one way, it goes the other.
/// A car leaving the lobby takes its riders up; the people bound down above
/// and below them wait for it to turn, it comes back for every one, and it
/// never stands idle while anyone still waits.
#[test]
fn a_car_done_going_one_way_turns_back_for_the_other() {
    // (from, to): two bound up, three bound down, one of them above the
    // highest up rider's floor and two below it.
    let trips = [(2, TOP), (6, 9), (8, 3), (4, 1), (9, 2)];
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, id) = tower(mode);
        let mut riders: Vec<(i64, i64, i64, bool, f64)> = trips
            .iter()
            .map(|&(from, to)| {
                let i = waiting(&mut sim, id, from, to);
                (sim.crowd.people[i].id, from, to, false, 0.0)
            })
            .collect();
        place_car(&mut sim, id, 1.0, 1);
        let (chunk, mut idle_while_waiting) = (0.25, 0);
        for _ in 0..1200 {
            let calls = sim.crowd.elevator_calls(&sim.tower);
            sim.elevators
                .move_cars(&mut sim.tower, chunk, &calls, HOUR, WEEKDAY);
            sim.elevators.swap_closed_cars(&mut sim.crowd.closed_cars);
            sim.elevators.swap_open_cars(&mut sim.crowd.open_cars);
            advance(
                &mut sim.crowd,
                chunk * CROWD_SECONDS_PER_MINUTE,
                &mut sim.tower,
            );
            for (pid, from, to, arrived, wrong) in &mut riders {
                let Some(p) = sim.crowd.people.iter().find(|p| p.id == *pid) else {
                    continue;
                };
                let away = (p.fy - *from as f64) * (*from - *to).signum() as f64;
                *wrong = wrong.max(away);
                *arrived |= p.state == PState::ToDest && p.floor == *to;
            }
            let someone_waits = sim
                .crowd
                .people
                .iter()
                .any(|p| p.shaft_id == Some(id) && p.state == PState::Waiting);
            let parked = sim.tower.get_transport(id).unwrap().car_dir[0] == 0;
            idle_while_waiting += usize::from(someone_waits && parked);
            if riders.iter().all(|r| r.3) {
                break;
            }
        }
        for (_, from, to, arrived, wrong) in riders {
            let case = format!("{mode:?}, {from} to {to}");
            assert!(arrived, "{case}: arrived");
            assert_eq!(wrong, 0.0, "{case}: rode the wrong way");
        }
        assert_eq!(
            idle_while_waiting, 0,
            "{mode:?}: parked while someone waited"
        );
    }
}
