//! Two towers on one lot whose ground lobbies do not touch, with open
//! ground between them and nothing else joining them (`crowd::street`). In
//! Modern a trip from one tower to the other walks out of one lobby, along
//! the street and in by the other: the open ground is crossed only there,
//! on foot, and nobody turns up in the other tower without walking over.
//! Classic keeps to the tower, as the 1994 game does: no way across.
use std::collections::HashMap;

use crate::clock::{CalendarKind, GameMode};
use crate::crowd::spawn::add;
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft};

/// The left edges of the two towers' lobbies, each `WIDTH` tiles wide.
const TOWERS: [i64; 2] = [40, 200];
const WIDTH: i64 = 72;
const TOP: i64 = 5;
/// Rooms start this far in from a tower's left edge, past its elevator.
const ROOMS_FROM: i64 = 8;

/// The tower whose tiles hold `x`, or `None` out on the open ground.
fn tower_of(x: f64) -> Option<usize> {
    TOWERS
        .iter()
        .position(|&left| x >= left as f64 && x < (left + WIDTH) as f64)
}

/// Lays `kind` side by side along `floor` of the tower at `left`, each in
/// `state` with `occupants` people.
fn row(
    sim: &mut Simulation,
    left: i64,
    (kind, floor, state, occupants): (Kind, i64, UnitState, i64),
) {
    let width = kind.facility().width;
    let mut x = left + ROOMS_FROM;
    while x + width <= left + WIDTH {
        place_seated(sim, kind, floor, x, state, occupants);
        x += width;
    }
}

/// Two towers on separate ground lobbies with floors 2 to `TOP`, a standard
/// elevator in each from its lobby to the top, offices and condos in the
/// left one and the only places to eat in the right one. The lobbies are
/// laid over a basement, which holds them up and which no transport
/// reaches. Answers the sim and the elevators, left to right.
fn two_towers(mode: GameMode) -> (Simulation, Vec<i64>) {
    let mut sim = Simulation::new(13, mode, CalendarKind::RealWorld, false);
    sim.money = 1e12;
    sim.star = 3;
    assert!(sim.tower.place(Kind::Lobby, 1, TOWERS[0]).ok);
    for x in TOWERS[0]..TOWERS[1] + WIDTH {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok, "B1 at {x}");
    }
    for &left in &TOWERS {
        for x in left..left + WIDTH {
            if sim.tower.unit_at(1, x).is_none() {
                assert!(sim.tower.place(Kind::Lobby, 1, x).ok, "lobby at {x}");
            }
            for floor in 2..=TOP {
                assert!(sim.tower.place(Kind::Floor, floor, x).ok);
            }
        }
    }
    assert_eq!(sim.tower.segments_of(1).len(), 2, "two separate lobbies");
    let lifts = TOWERS
        .iter()
        .map(|&left| shaft(&mut sim, Kind::ElevatorStandard, left, 1, TOP))
        .collect();
    let staff = Kind::Office.facility().population;
    for spec in [
        (Kind::Office, 2, UnitState::Occupied, staff),
        (Kind::Office, 3, UnitState::Occupied, staff),
        (Kind::Condo, 4, UnitState::Occupied, 3),
    ] {
        row(&mut sim, TOWERS[0], spec);
    }
    for floor in 2..=3 {
        row(
            &mut sim,
            TOWERS[1],
            (Kind::FastFood, floor, UnitState::Occupied, 0),
        );
    }
    (sim, lifts)
}

#[test]
fn a_trip_to_the_other_tower_walks_the_street() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, lifts) = two_towers(mode);
        let Simulation {
            ref mut crowd,
            ref tower,
            ..
        } = sim;
        let (from, to) = (TOWERS[0] + ROOMS_FROM, TOWERS[1] + ROOMS_FROM);
        let i = add(crowd, tower, 3, 2, Some(from), Some(to));
        if !mode.walks_the_street() {
            assert!(i.is_none(), "{mode:?}: no way across");
            continue;
        }
        let p = &crowd.people[i.expect("a way across")];
        assert_eq!(
            p.floors,
            vec![3, 1, 2],
            "{mode:?}: down, along the street, up"
        );
        assert_eq!(p.shafts, lifts, "{mode:?}");
    }
}

/// Where a person was last seen: in a tower, or out on the street.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Seen {
    Tower(usize),
    Street,
}

#[test]
fn lunch_in_the_other_tower_walks_the_street_and_back() {
    let (mut sim, lifts) = two_towers(GameMode::Modern);
    at_time(&mut sim, 0, 6);
    let mut seen: HashMap<i64, Seen> = HashMap::new();
    let mut crossed: HashMap<i64, Vec<usize>> = HashMap::new();
    for _ in 0..(16 * 60) {
        sim.tick(1.0);
        for p in &sim.crowd.people {
            let here = match tower_of(p.x) {
                Some(k) => Seen::Tower(k),
                None => {
                    assert_eq!(
                        p.floor, 1,
                        "person {} over the open ground off the street",
                        p.id
                    );
                    assert!(
                        matches!(p.state, PState::ToShaft | PState::ToDest),
                        "person {} on the street, {:?}",
                        p.id,
                        p.state
                    );
                    Seen::Street
                }
            };
            let was = seen.insert(p.id, here).unwrap_or(here);
            if let (Seen::Tower(a), Seen::Tower(b)) = (was, here) {
                assert_eq!(
                    a, b,
                    "person {} turned up in the other tower without walking over",
                    p.id
                );
            }
            if let (Seen::Street, Seen::Tower(k)) = (was, here) {
                crossed.entry(p.id).or_default().push(k);
            }
            if p.state == PState::Riding {
                let k = tower_of(p.x).expect("a car rides inside a tower");
                assert_eq!(
                    p.shaft_id,
                    Some(lifts[k]),
                    "person {} rides its own tower's car",
                    p.id
                );
            }
        }
    }
    let over = crossed.values().filter(|ks| ks.contains(&1)).count();
    let back = crossed
        .values()
        .filter(|ks| ks.contains(&1) && ks.contains(&0))
        .count();
    assert!(over > 0, "someone walked over to eat in the right tower");
    assert!(back > 0, "someone walked back to the left tower after");
}

#[test]
fn nobody_crosses_the_open_ground_in_classic() {
    let (mut sim, _) = two_towers(GameMode::Classic);
    at_time(&mut sim, 0, 6);
    for _ in 0..(16 * 60) {
        sim.tick(1.0);
        for p in &sim.crowd.people {
            assert!(
                tower_of(p.x).is_some(),
                "person {} at x {} on floor {} is out on the open ground",
                p.id,
                p.x,
                p.floor
            );
        }
    }
}
