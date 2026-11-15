//! Two Modern towers on one lot, each on its own ground lobby with open
//! ground between them and nothing else joining them, built the way a
//! player builds them: bridging off, the second lobby laid apart from the
//! first (`GameMode::lays_ground_lobbies_apart`, owner 2026-11-14). Both
//! towers fill and run, each tower's housekeepers and diners use it, the
//! open ground is crossed only on foot along the street (`crowd::street`),
//! nobody turns up in the other tower without walking over, and a trip
//! from one tower to the other finds its way with or without a basement.
use std::collections::{HashMap, HashSet};

use crate::clock::{CalendarKind, GameMode};
use crate::crowd::spawn::add;
use crate::crowd::PState;
use crate::crowd::Person;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft};

/// The left edges of the two towers, each `WIDTH` tiles wide.
const TOWERS: [i64; 2] = [40, 200];
const WIDTH: i64 = 72;
const TOP: i64 = 7;
/// Rooms start this far in from a tower's left edge, past its elevator.
const ROOMS_FROM: i64 = 8;

/// The tower whose tiles hold `x`, or `None` over the open ground.
fn tower_of(x: f64) -> Option<usize> {
    TOWERS
        .iter()
        .position(|&left| x >= left as f64 && x < (left + WIDTH) as f64)
}

/// Lays `kind` side by side along `floor` of the tower at `left`, each in
/// `state` with `occupants` people, and answers their ids.
fn row(
    sim: &mut Simulation,
    left: i64,
    (kind, floor, state, occupants): (Kind, i64, UnitState, i64),
) -> Vec<i64> {
    let width = kind.facility().width;
    let mut ids = Vec::new();
    let mut x = left + ROOMS_FROM;
    while x + width <= left + WIDTH {
        ids.push(place_seated(sim, kind, floor, x, state, occupants));
        x += width;
    }
    ids
}

/// What each tower holds, floor by floor.
fn rooms() -> [(Kind, i64, UnitState, i64); 6] {
    let staff = Kind::Office.facility().population;
    [
        (Kind::Office, 2, UnitState::Occupied, staff),
        (Kind::FastFood, 3, UnitState::Occupied, 0),
        (Kind::Condo, 4, UnitState::Occupied, 3),
        (Kind::HotelSingle, 5, UnitState::Asleep, 1),
        (Kind::HotelSingle, 6, UnitState::Asleep, 1),
        (Kind::Housekeeping, 7, UnitState::Occupied, 0),
    ]
}

/// Two towers built through the build commands, as a player lays them,
/// each with a standard elevator from its lobby to the top. Answers the
/// sim and the elevators, left to right.
fn two_towers() -> (Simulation, Vec<i64>) {
    let mut sim = Simulation::new(11, GameMode::Modern, CalendarKind::RealWorld, false);
    sim.money = 1e12;
    sim.star = 5;
    if sim.auto_bridge {
        sim.toggle_auto_bridge();
    }
    for &left in &TOWERS {
        for x in left..left + WIDTH {
            let r = sim.build(Kind::Lobby, 1, x);
            assert!(r.ok, "lobby at {x}: {:?}", r.reason);
        }
        for floor in 2..=TOP {
            for x in left..left + WIDTH {
                assert!(sim.build(Kind::Floor, floor, x).ok, "floor {floor} at {x}");
            }
        }
    }
    let lifts: Vec<i64> = TOWERS
        .iter()
        .map(|&left| {
            let r = sim.build_transport(Kind::ElevatorStandard, left, 1, TOP);
            assert!(r.ok, "{:?}", r.reason);
            sim.tower.transports.last().unwrap().id
        })
        .collect();
    let ground = sim.tower.segments_of(1);
    assert_eq!(ground.len(), 2, "two ground lobbies");
    let gap = TOWERS[0] + WIDTH..TOWERS[1];
    assert!(
        gap.clone().all(|x| !sim.tower.has_structure(1, x)),
        "open ground"
    );
    for &left in &TOWERS {
        for spec in rooms() {
            assert!(!row(&mut sim, left, spec).is_empty(), "{spec:?}");
        }
    }
    (sim, lifts)
}

/// Where a person was last seen: in a tower, or out on the street.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Seen {
    Tower(usize),
    Street,
}

/// Where `p` is, after checking that anyone over the open ground is on the
/// ground floor and on foot.
fn where_is(p: &Person) -> Seen {
    match tower_of(p.x) {
        Some(k) => Seen::Tower(k),
        None => {
            assert_eq!(
                p.floor, 1,
                "person {} over the open ground off the street",
                p.id
            );
            assert!(
                matches!(p.state, PState::ToShaft | PState::ToDest),
                "person {} on the open ground, {:?}",
                p.id,
                p.state
            );
            Seen::Street
        }
    }
}

#[test]
fn nobody_warps_between_towers_over_open_ground() {
    let (mut sim, _) = two_towers();
    at_time(&mut sim, 0, 6);
    let mut seen: HashMap<i64, Seen> = HashMap::new();
    let mut went_up = [false, false];
    for _ in 0..(16 * 60) {
        sim.tick(1.0);
        for p in &sim.crowd.people {
            let here = where_is(p);
            let was = seen.insert(p.id, here).unwrap_or(here);
            if let (Seen::Tower(a), Seen::Tower(b)) = (was, here) {
                assert_eq!(
                    a, b,
                    "person {} turned up in the other tower without walking over",
                    p.id
                );
            }
            if let Seen::Tower(k) = here {
                went_up[k] |= p.floor > 1 && p.state != PState::Riding;
            }
        }
    }
    for (k, up) in went_up.iter().enumerate() {
        assert!(up, "tower {k}: people reached its upper floors");
    }
}

#[test]
fn each_tower_has_its_own_housekeepers_and_diners() {
    let (mut sim, lifts) = two_towers();
    at_time(&mut sim, 0, 6);
    let mut staff = [HashSet::new(), HashSet::new()];
    let mut diners = [HashSet::new(), HashSet::new()];
    for _ in 0..(16 * 60) {
        sim.tick(1.0);
        for p in &sim.crowd.people {
            let Seen::Tower(k) = where_is(p) else {
                continue;
            };
            if p.state == PState::Riding {
                assert_eq!(
                    p.shaft_id,
                    Some(lifts[k]),
                    "person {} rides a car outside its tower",
                    p.id
                );
            }
            if p.staff {
                // A housekeeper keeps to the staff network of their own
                // tower, which the street does not join.
                for &s in &p.shafts {
                    assert_eq!(s, lifts[k], "housekeeper {} in the other tower", p.id);
                }
                staff[k].insert(p.id);
            }
            if p.meal_venue_id.is_some() {
                diners[k].insert(p.id);
            }
        }
    }
    for k in 0..TOWERS.len() {
        assert!(
            !staff[k].is_empty(),
            "tower {k}: housekeepers came in by its lobby"
        );
        assert!(
            !diners[k].is_empty(),
            "tower {k}: people went out to eat in it"
        );
    }
}

#[test]
fn a_trip_between_the_towers_walks_the_street_or_rides_a_basement() {
    let (mut sim, lifts) = two_towers();
    let from = (4, TOWERS[0] + ROOMS_FROM);
    let to = (3, TOWERS[1] + ROOMS_FROM);
    // Over open ground: down, out along the street, in and up.
    {
        let Simulation {
            ref mut crowd,
            ref tower,
            ..
        } = sim;
        let i = add(crowd, tower, from.0, to.0, Some(from.1), Some(to.1)).expect("a way across");
        let p = &crowd.people[i];
        assert_eq!(p.floors, vec![4, 1, 3], "down, along the street, up");
        assert_eq!(p.shafts, lifts);
    }
    // A basement under both towers and the open ground between, and an
    // elevator in each tower down to it: the trip takes whichever way is
    // quicker, and either way stays on transport and on foot.
    for x in TOWERS[0]..TOWERS[1] + WIDTH {
        assert!(sim.build(Kind::Floor, 0, x).ok, "B1 at {x}");
    }
    let down: Vec<i64> = TOWERS
        .iter()
        .map(|&left| shaft(&mut sim, Kind::ElevatorStandard, left + WIDTH - 4, 0, TOP))
        .collect();
    let Simulation {
        ref mut crowd,
        ref tower,
        ..
    } = sim;
    let i = add(crowd, tower, from.0, to.0, Some(from.1), Some(to.1)).expect("a way across");
    let p = &crowd.people[i];
    let by_street = p.floors == [4, 1, 3]
        && p.shafts
            .iter()
            .all(|s| lifts.contains(s) || down.contains(s));
    let by_basement = p.floors == [4, 0, 3] && p.shafts == down;
    assert!(by_street || by_basement, "{:?} by {:?}", p.floors, p.shafts);
}
