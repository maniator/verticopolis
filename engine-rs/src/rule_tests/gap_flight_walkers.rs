//! A flight that stands over a gap in its floor (Modern): a walker reaches it
//! from their own side of the gap. The route reached the flight there, so
//! the walker climbs from the columns on their run, and never stands still
//! finding the same way over and over (the floor 30 crowd in a player's
//! split tower, 2026-11-15).

use super::{at_time, place_seated, shaft};
use crate::clock::{CalendarKind, GameMode};
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

const LEFT: std::ops::Range<i64> = 40..76;
const RIGHT: std::ops::Range<i64> = 78..120;
/// The open columns between the two runs of floor 2.
const GAP: std::ops::Range<i64> = 76..78;
/// An escalator eight columns wide, from 74 to 81: over the gap, with two
/// columns on the left run and its middle (78) on the right one.
const ESCALATOR_X: i64 = 74;
const FLOOR: i64 = 2;

/// A lobby, floor 2 in two runs with the escalator over the gap between
/// them, and a full floor 3 of offices the escalator alone reaches. The
/// elevator from the lobby lands on the left run, so every commuter walks to
/// the escalator from the left of the gap.
fn split_floor() -> (Simulation, i64) {
    let mut sim = Simulation::new(7, GameMode::Modern, CalendarKind::RealWorld, false);
    sim.money = 1e12;
    for x in LEFT.start..RIGHT.end {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for x in LEFT.start..RIGHT.end {
        assert!(sim.tower.place(Kind::Floor, FLOOR, x).ok);
        assert!(sim.tower.place(Kind::Floor, FLOOR + 1, x).ok);
    }
    shaft(&mut sim, Kind::ElevatorStandard, LEFT.start + 2, 1, FLOOR);
    let escalator = shaft(&mut sim, Kind::Escalator, ESCALATOR_X, FLOOR, FLOOR + 1);
    // The gap opens under the escalator after it is built, as a player's
    // tower holds it (the placement rules never build a flight over one).
    for x in GAP {
        let id = sim.tower.unit_at(FLOOR, x).unwrap().id;
        assert!(sim.tower.remove_unit(id).is_some());
    }
    let mut x = LEFT.start;
    while x + 9 <= RIGHT.end {
        place_seated(&mut sim, Kind::Office, FLOOR + 1, x, UnitState::Occupied, 0);
        x += 9;
    }
    assert!(GAP.clone().all(|x| !sim.tower.has_structure(FLOOR, x)));
    at_time(&mut sim, 0, 7);
    (sim, escalator)
}

#[test]
fn a_walker_reaches_a_flight_over_a_gap_from_their_own_side() {
    let (mut sim, escalator) = split_floor();
    let mut climbed = 0;
    let mut walked_to_it = false;
    for _ in 0..4 * 60 * 3 {
        sim.tick(0.25);
        for p in sim.crowd.people.iter().filter(|p| p.floor == FLOOR) {
            if p.state == PState::ToShaft && p.shaft_id == Some(escalator) {
                walked_to_it = true;
                let col = p.x.round() as i64;
                assert!(
                    sim.tower.has_structure(FLOOR, col),
                    "person {} stands on open air at {}",
                    p.id,
                    p.x
                );
                assert!(col < GAP.end, "person {} crossed the gap to {}", p.id, p.x);
            }
        }
        climbed += sim
            .crowd
            .people
            .iter()
            .filter(|p| p.state == PState::Climbing && p.shaft_id == Some(escalator))
            .count();
    }
    assert!(walked_to_it, "nobody set out for the escalator");
    assert!(climbed > 0, "nobody climbed the escalator over the gap");
    // Nobody is left on floor 2 by the end of the morning rush.
    let stuck = sim
        .crowd
        .people
        .iter()
        .filter(|p| p.floor == FLOOR && p.state == PState::ToShaft)
        .count();
    assert_eq!(stuck, 0, "{stuck} people still stand on floor 2");
}
