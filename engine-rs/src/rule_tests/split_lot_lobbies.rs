//! A lot with several towers whose ground lobbies do not touch, joined only
//! by a basement floor (the r/tycoon report on 3.12.0): green space between
//! the lobbies, one shared B1. A trip that starts or ends "at the lobby"
//! without naming a spot uses the lobby under its own tower, never the
//! lot's leftmost one by a ride down to the basement and across
//! (`crowd::doors`).
use crate::clock::{CalendarKind, GameMode};
use crate::crowd::spawn::{add, pick_x};
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft};

/// The left edges of the three towers' lobbies, each `WIDTH` tiles wide.
const TOWERS: [i64; 3] = [20, 120, 220];
const WIDTH: i64 = 40;
const TOP: i64 = 6;

/// Three towers on separate ground lobbies with floors 2 to `TOP`, one
/// basement floor under all of them, and in each tower a standard elevator
/// from B1 to the top. Returns the sim and the elevators, left to right.
fn three_towers(mode: GameMode) -> (Simulation, Vec<i64>) {
    let mut sim = Simulation::new(9, mode, CalendarKind::RealWorld, false);
    sim.money = 1e12;
    sim.star = 3;
    // The basement goes in first so each lobby has something to join.
    assert!(sim.tower.place(Kind::Lobby, 1, TOWERS[0]).ok);
    for x in TOWERS[0]..TOWERS[2] + WIDTH {
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
    assert_eq!(sim.tower.segments_of(1).len(), 3, "three separate lobbies");
    let lifts = TOWERS
        .iter()
        .map(|&left| shaft(&mut sim, Kind::ElevatorStandard, left + 10, 0, TOP))
        .collect();
    (sim, lifts)
}

fn tower_of(x: f64) -> usize {
    TOWERS
        .iter()
        .position(|&left| x >= left as f64 && x < (left + WIDTH) as f64)
        .unwrap_or_else(|| panic!("x {x} is in no tower"))
}

/// Person `i`'s trip: its floors and shafts, and where it starts and ends.
fn trip(sim: &Simulation, i: usize) -> (Vec<i64>, Vec<i64>, f64, f64) {
    let p = &sim.crowd.people[i];
    (p.floors.clone(), p.shafts.clone(), p.start_x, p.dest_x)
}

#[test]
fn a_trip_down_to_the_lobby_ends_under_its_own_tower() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, lifts) = three_towers(mode);
        for (k, &left) in TOWERS.iter().enumerate() {
            for x in [left + 2, left + 25] {
                let Simulation {
                    ref mut crowd,
                    ref tower,
                    ..
                } = sim;
                let i = add(crowd, tower, 4, 1, Some(x), None).expect("a way down");
                let (floors, shafts, _, dest_x) = trip(&sim, i);
                assert_eq!(floors, vec![4, 1], "{mode:?}: straight down in tower {k}");
                assert_eq!(shafts, vec![lifts[k]], "{mode:?}");
                assert_eq!(tower_of(dest_x), k, "{mode:?}: out of tower {k}'s lobby");
            }
        }
    }
}

#[test]
fn a_trip_up_from_the_lobby_starts_under_its_own_tower() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, lifts) = three_towers(mode);
        for (k, &left) in TOWERS.iter().enumerate() {
            let Simulation {
                ref mut crowd,
                ref tower,
                ..
            } = sim;
            let i = add(crowd, tower, 1, 5, None, Some(left + 30)).expect("a way up");
            let (floors, shafts, start_x, _) = trip(&sim, i);
            assert_eq!(floors, vec![1, 5], "{mode:?}: no basement detour");
            assert_eq!(shafts, vec![lifts[k]], "{mode:?}");
            assert_eq!(tower_of(start_x), k, "{mode:?}: in by tower {k}'s lobby");
        }
    }
}

/// A lobby no transport reaches is passed over for the next nearest one
/// that a route does reach, here by the basement.
#[test]
fn a_lobby_cut_off_from_the_trip_gives_way_to_the_next_nearest() {
    let (mut sim, lifts) = three_towers(GameMode::Modern);
    // The right tower's elevator stops passing its lobby.
    assert!(sim.tower.set_stop(lifts[2], 1, false));
    let Simulation {
        ref mut crowd,
        ref tower,
        ..
    } = sim;
    let i = add(crowd, tower, 4, 1, Some(TOWERS[2] + 20), None).expect("a way down");
    let (floors, shafts, _, dest_x) = trip(&sim, i);
    assert_eq!(floors, vec![4, 0, 1]);
    assert_eq!(shafts, vec![lifts[2], lifts[1]]);
    assert_eq!(tower_of(dest_x), 1, "out by the middle tower, the nearest");
}

/// One lobby run answers exactly as before: the seed's tile anywhere on it.
#[test]
fn a_single_lobby_picks_the_same_tile_as_before() {
    let mut sim = super::strip_tower(4, GameMode::Classic, 60, TOP);
    shaft(&mut sim, Kind::ElevatorStandard, 30, 1, TOP);
    for _ in 0..20 {
        let seed = crate::crowd::spawn::seed_for(sim.crowd.next_id);
        let Simulation {
            ref mut crowd,
            ref tower,
            ..
        } = sim;
        let i = add(crowd, tower, 1, 4, None, Some(10)).expect("a way up");
        assert_eq!(
            sim.crowd.people[i].start_x,
            pick_x(&sim.tower, 1, seed) as f64
        );
    }
}

/// The reported case end to end: shoppers for a shop in the right tower
/// come in and go out by the right tower's lobby, and none rides through
/// the basement.
#[test]
fn shoppers_use_the_lobby_under_their_shop() {
    // Walk-ins are off in play (`WALK_INS_ON`); this covers them on.
    crate::facilities::set_walk_ins_for_test(true);
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, _) = three_towers(mode);
        let c = TOWERS[2];
        let staff = Kind::Office.facility().population;
        for floor in 2..=4 {
            for x in [c, c + 9, c + 18, c + 27] {
                place_seated(&mut sim, Kind::Office, floor, x, UnitState::Occupied, staff);
            }
        }
        place_seated(&mut sim, Kind::Shop, 5, c + 20, UnitState::Occupied, 0);
        at_time(&mut sim, 0, 10);
        let (mut seen, mut left) = (std::collections::HashSet::new(), 0);
        for _ in 0..(3 * 60) {
            sim.tick(1.0);
            for p in sim.crowd.people.iter().filter(|p| p.walk_in) {
                assert!(!p.floors.contains(&0), "{mode:?}: no basement detour");
                if seen.insert(p.id) {
                    assert_eq!(tower_of(p.start_x), 2, "{mode:?}: in by the right tower");
                }
                if p.returning && p.state == PState::ToDest && p.floor == 1 {
                    assert_eq!(tower_of(p.dest_x), 2, "{mode:?}: out by the right tower");
                    left += 1;
                }
            }
        }
        assert!(
            !seen.is_empty() && left > 0,
            "{mode:?}: shoppers came and went"
        );
    }
}
