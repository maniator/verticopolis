//! Walkway willingness (#384): the Classic walk budget on stairs and
//! escalators, outside the elevator rides. The budgets themselves are
//! pinned by `crowd::graph::tests::{the_classic_walk_budget_bounds_the_reach,
//! a_walk_keeps_the_lowest_budget_it_has_met, a_ride_starts_a_new_walk}`:
//! stairs reach four flights and refuse the fifth, escalators reach seven and
//! refuse the eighth, a run that meets a stair keeps the stairs' four, and an
//! elevator ride starts a new walk. This file holds the two rules those leave
//! out: a stair after two elevator rides is a walk and not a third ride, and
//! Modern applies no walk budget however long the climb.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

use super::{LEFT, RIGHT};

/// A lobby on floor 1 and floor slabs up to `top`, with no transport.
fn bare(mode: GameMode, top: i64) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e12;
    for x in LEFT..RIGHT {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=top {
        for x in LEFT..RIGHT {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    sim
}

fn shaft(sim: &mut Simulation, kind: Kind, x: i64, bottom: i64, top: i64) {
    let r = sim.tower.place_transport(kind, x, bottom, top);
    assert!(r.ok, "{kind:?} at {x}, {bottom}..{top}: {:?}", r.reason);
}

/// One stair flight per floor from the lobby up to `top`.
fn stair_column(mode: GameMode, top: i64) -> Simulation {
    let mut sim = bare(mode, top);
    for floor in 1..top {
        shaft(&mut sim, Kind::Stairs, LEFT + 2, floor, floor + 1);
    }
    sim
}

#[test]
fn a_stair_after_two_elevator_rides_is_a_walk_and_not_a_third_ride() {
    let mut sim = bare(GameMode::Classic, 10);
    shaft(&mut sim, Kind::ElevatorStandard, LEFT + 12, 1, 5);
    shaft(&mut sim, Kind::ElevatorStandard, LEFT + 20, 5, 9);
    assert!(!sim.floor_reachable(10), "nothing climbs to floor 10 yet");
    shaft(&mut sim, Kind::Stairs, LEFT + 2, 9, 10);
    assert!(sim.floor_reachable(10));
}

#[test]
fn modern_applies_no_walk_budget_to_a_long_stair_climb() {
    let mut modern = stair_column(GameMode::Modern, 12);
    assert!(modern.floor_reachable(5), "four flights");
    assert!(modern.floor_reachable(11), "ten flights");
    let mut classic = stair_column(GameMode::Classic, 12);
    assert!(classic.floor_reachable(5), "four flights");
    assert!(
        !classic.floor_reachable(6),
        "the fifth flight is past the budget"
    );
    assert!(!classic.floor_reachable(11), "ten flights");
}
