//! People and a floor cut in two (Modern): the bulldozer never takes a sky
//! bridge out from under someone crossing it, and nobody steps over the gap
//! a cut floor leaves. A walker headed for the far side finds another way
//! from where they stand.

use super::{at_time, place_seated, shaft};
use crate::clock::{CalendarKind, GameMode};
use crate::crowd::{PState, Person};
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::sim::Simulation;
use crate::tower::{UnitState, PEOPLE_CROSSING};

const SKY: i64 = 15;
const TOP: i64 = 22;
const LEFT: std::ops::Range<i64> = 60..100;
const RIGHT: std::ops::Range<i64> = 112..152;
const GAP: std::ops::Range<i64> = 100..112;
const MIDDLE: i64 = 106;
/// The most tiles a walker covers in a quarter-minute tick, with room to
/// spare; a jump to a shaft across the gap covers far more.
const MOST_IN_A_TICK: f64 = 6.0;

/// Two office wings with a sky lobby on floor 15, a local to it in each
/// wing, and lunch only in the right wing, so the left wing's workers cross
/// floor 15 at noon. `pillars` stands the gap's floor 15 on floors below it,
/// so it is no bridge.
fn wings(pillars: bool) -> Simulation {
    let mut sim = Simulation::new(3, GameMode::Modern, CalendarKind::RealWorld, false);
    sim.money = 1e12;
    sim.star = 5;
    for x in LEFT.start..RIGHT.end {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for wing in [LEFT, RIGHT] {
        for floor in 2..=TOP {
            let kind = if floor == SKY {
                Kind::Lobby
            } else {
                Kind::Floor
            };
            for x in wing.clone() {
                assert!(sim.tower.place(kind, floor, x).ok, "{floor} {x}");
            }
        }
        shaft(&mut sim, Kind::ElevatorStandard, wing.start + 1, 1, SKY);
        shaft(&mut sim, Kind::ElevatorStandard, wing.start + 6, SKY, TOP);
        for floor in SKY + 1..=TOP {
            let mut x = wing.start + 12;
            while x + 9 <= wing.end {
                if !(floor == SKY + 1 && wing.start == RIGHT.start) {
                    place_seated(&mut sim, Kind::Office, floor, x, UnitState::Occupied, 6);
                }
                x += 9;
            }
        }
    }
    place_seated(
        &mut sim,
        Kind::FastFood,
        SKY + 1,
        RIGHT.start + 12,
        UnitState::Occupied,
        0,
    );
    let gap: Vec<i64> = GAP.collect();
    if pillars {
        for floor in 2..SKY {
            for &x in &gap {
                assert!(sim.tower.place(Kind::Floor, floor, x).ok);
            }
        }
        for &x in &gap {
            assert!(sim.tower.place(Kind::Lobby, SKY, x).ok);
        }
    } else {
        let laid = sim.build_skybridge(SKY, gap[0]);
        assert!(laid.ok, "{:?}", laid.reason);
    }
    assert_eq!(sim.tower.is_skybridge_tile(SKY, MIDDLE), !pillars);
    at_time(&mut sim, 0, 11);
    sim
}

/// Everyone walking on floor 15: id and x.
fn on_floor_15(sim: &Simulation) -> Vec<(i64, f64)> {
    let walking = |p: &&Person| matches!(p.state, PState::ToShaft | PState::ToDest);
    let on = sim.crowd.people.iter().filter(|p| p.floor == SKY);
    on.filter(walking).map(|p| (p.id, p.x)).collect()
}

/// Play `quarters` quarter minutes and fail on anyone walking floor 15 who moves
/// farther than a walk, crosses column `cut` or stands on a tile that is
/// gone, and on anyone waiting there for a shaft across the gap.
fn play_watching(sim: &mut Simulation, quarters: usize, cut: i64) {
    let mut last = on_floor_15(sim);
    for _ in 0..quarters {
        sim.tick(0.25);
        let now = on_floor_15(sim);
        for &(id, x) in &now {
            let col = x.round() as i64;
            assert!(
                sim.tower.has_structure(SKY, col),
                "person {id} stands on open air at {x}"
            );
            if let Some(&(_, before)) = last.iter().find(|(was, _)| *was == id) {
                let side = |x: f64| x < cut as f64;
                let walked = (before - x).abs() <= MOST_IN_A_TICK;
                assert!(
                    walked && side(before) == side(x),
                    "person {id} jumped from {before} to {x}"
                );
            }
        }
        for p in sim.crowd.people.iter().filter(|p| p.floor == SKY) {
            let (PState::Waiting, Some(id)) = (p.state, p.shaft_id) else {
                continue;
            };
            let shaft = sim.tower.get_transport(id).unwrap();
            let here = sim.tower.run_at(SKY, p.x.round() as i64);
            assert_eq!(
                here,
                sim.tower.run_at(SKY, shaft.x),
                "person {} at {} waits for the shaft at {} across the gap",
                p.id,
                p.x,
                shaft.x
            );
        }
        last = now;
    }
}

/// Tick until someone walks on floor 15 between the wings.
fn until_someone_crosses(sim: &mut Simulation) {
    for _ in 0..4000 {
        let crossing = sim
            .crowd
            .people
            .iter()
            .any(|p| p.floor == SKY && GAP.contains(&(p.x.round() as i64)));
        if crossing {
            return;
        }
        sim.tick(0.25);
    }
    panic!("nobody crossed floor 15");
}

#[test]
fn nobody_steps_over_the_gap_when_a_bridge_comes_out() {
    let mut sim = wings(false);
    until_someone_crosses(&mut sim);
    let middle = sim.tower.unit_at(SKY, MIDDLE).unwrap().id;
    let r = sim.remove_facility(middle, RemovalMethod::Bulldoze);
    assert_eq!(r.reason.as_deref(), Some(PEOPLE_CROSSING));
    // Once nobody is on it, the whole bridge comes out together.
    let mut tries = 0;
    while !sim.remove_facility(middle, RemovalMethod::Bulldoze).ok {
        sim.tick(0.25);
        tries += 1;
        assert!(tries < 4000, "the bridge never cleared");
    }
    assert!(GAP.clone().all(|x| sim.tower.unit_at(SKY, x).is_none()));
    play_watching(&mut sim, 4 * 60 * 3, MIDDLE);
}

#[test]
fn nobody_steps_over_the_gap_when_a_floor_is_cut() {
    let mut sim = wings(true);
    until_someone_crosses(&mut sim);
    // Cut the floor beside the people crossing it, away from where they
    // stand.
    let ahead = (GAP.start..GAP.end)
        .find(|&x| {
            !sim.crowd
                .people
                .iter()
                .any(|p| p.floor == SKY && (p.x.round() as i64 - x).abs() < 2)
        })
        .unwrap();
    let id = sim.tower.unit_at(SKY, ahead).unwrap().id;
    let r = sim.remove_facility(id, RemovalMethod::Bulldoze);
    assert!(r.ok, "{:?}", r.reason);
    play_watching(&mut sim, 4 * 60 * 3, ahead);
}
